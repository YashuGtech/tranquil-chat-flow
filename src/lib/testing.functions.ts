// Admin test harness: mint synthetic verified chat sessions used by the
// "Testing" tab to load-test /api/chat with N parallel fake users.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getUserSupabase } from "@/lib/user-supabase.server";
import { isAdmin } from "@/config/user-db";

async function requireAdmin(sessionId: string) {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("chat_sessions")
    .select("telegram_username,verified")
    .eq("id", sessionId)
    .single();
  if (!data?.verified || !isAdmin(data.telegram_username as string)) return null;
  return data;
}

/** Create N verified synthetic test sessions and return their ids. */
export const adminCreateTestAccounts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      count: z.number().int().min(1).max(50),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin(data.sessionId);
    if (!admin) return { ok: false as const, error: "Admin only", accounts: [] };

    const sb = getUserSupabase();
    const stamp = Date.now();
    const rows = Array.from({ length: data.count }, (_, i) => ({
      telegram_username: `test_${stamp}_${i + 1}`,
      telegram_user_id: null,
      verified: true,
    }));
    const { data: inserted, error } = await sb
      .from("chat_sessions")
      .insert(rows)
      .select("id,telegram_username");
    if (error) return { ok: false as const, error: error.message, accounts: [] };

    // Mirror into test_accounts for cleanup/visibility.
    try {
      await sb.from("test_accounts").insert(
        (inserted ?? []).map((s) => ({
          username: s.telegram_username as string,
          session_id: s.id as string,
        })),
      );
    } catch {/* table optional */}

    return {
      ok: true as const,
      accounts: (inserted ?? []).map((s) => ({
        sessionId: s.id as string,
        username: s.telegram_username as string,
      })),
    };
  });

/** Cleanup: delete all synthetic test sessions + messages. */
export const adminClearTestAccounts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin(data.sessionId);
    if (!admin) return { ok: false as const, error: "Admin only" };
    const sb = getUserSupabase();
    // Delete sessions whose username starts with test_
    const { data: rows } = await sb
      .from("chat_sessions")
      .select("id")
      .like("telegram_username", "test_%");
    const ids = (rows ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      await sb.from("chat_messages").delete().in("session_id", ids);
      await sb.from("chat_sessions").delete().in("id", ids);
    }
    await sb.from("test_accounts").delete().gte("created_at", "1970-01-01");
    return { ok: true as const, removed: ids.length };
  });
