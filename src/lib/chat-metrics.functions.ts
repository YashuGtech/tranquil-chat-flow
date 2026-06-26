// Admin-only: chat traffic stats for the Metrics panel.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getUserSupabase } from "@/lib/user-supabase.server";
import { isAdmin } from "@/config/user-db";
import { readChatMetrics } from "@/lib/chat-metrics.server";

async function getSession(sessionId: string) {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("chat_sessions")
    .select("telegram_username,verified")
    .eq("id", sessionId)
    .single();
  return data as { telegram_username: string; verified: boolean } | null;
}

export const adminGetChatMetrics = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified || !isAdmin(s.telegram_username)) {
      return { ok: false as const, error: "Admin only" };
    }
    const m = await readChatMetrics();
    return { ok: true as const, metrics: m };
  });
