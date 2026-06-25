// Subscription & quota server functions used by the chat/admin UIs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getUserSupabase } from "@/lib/user-supabase.server";
import { isAdmin, userDb } from "@/config/user-db";
import { creditBonus, getQuota } from "@/lib/quota.server";

export const PLANS = [
  { gtc: 1000, messages: 10 },
  { gtc: 5000, messages: 100 },
  { gtc: 10000, messages: 200 },
] as const;

const DUPLICATE_TXN_ERROR =
  "This transaction hash has already been submitted. Each on-chain TXN can only be used once.";

function normalizeTxnHash(hash: string) {
  return hash.trim().toLowerCase();
}

async function txnHashAlreadySubmitted(
  sb: ReturnType<typeof getUserSupabase>,
  normalizedHash: string,
  exceptId?: string,
) {
  // Do not use maybeSingle(): if legacy duplicate rows already exist,
  // Supabase returns an error instead of data and the duplicate check is
  // accidentally bypassed. Fetch a small list and normalize locally.
  const { data, error } = await sb
    .from("subscription_requests")
    .select("id,txn_hash,status,telegram_username")
    .ilike("txn_hash", normalizedHash)
    .limit(25);
  if (error) {
    console.warn("[subscription] duplicate TXN lookup failed", error.message);
    throw new Error("Could not verify this TXN hash right now. Please try again in a moment.");
  }
  return ((data ?? []) as Array<{ id?: string; txn_hash?: string | null }>).some(
    (row) => row.id !== exceptId && normalizeTxnHash(row.txn_hash ?? "") === normalizedHash,
  );
}

function isDuplicateTxnDbError(message = "") {
  return /duplicate|unique|already been submitted|subscription_txn_hash/i.test(message);
}

async function getSession(sessionId: string) {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("chat_sessions")
    .select("telegram_username,telegram_user_id,verified")
    .eq("id", sessionId)
    .single();
  return data as
    | { telegram_username: string; telegram_user_id: number | null; verified: boolean }
    | null;
}

/** Read current quota + active subscription history for the signed-in user. */
export const getMyQuota = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified) return { ok: false as const, error: "Login required" };
    const snapshot = await getQuota(s.telegram_username);
    return { ok: true as const, snapshot };
  });

/** Public deposit address (from bot_config). */
export const getDepositAddress = createServerFn({ method: "GET" }).handler(async () => {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("bot_config")
    .select("value")
    .eq("key", "gtc_deposit_address")
    .maybeSingle();
  return {
    address: (data?.value as string) || "0xe724D2800Cf0Af62aB7f3e08f2f6AD32900c1491",
  };
});

/** User submits a subscription request after paying. */
export const submitSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        planGtc: z.number().int().positive(),
        txnHash: z.string().min(4).max(200),
        feeGtc: z.number().int().min(1).max(10).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified) return { ok: false as const, error: "Login required" };
    const plan = PLANS.find((p) => p.gtc === data.planGtc);
    if (!plan) return { ok: false as const, error: "Invalid plan" };

    const sb = getUserSupabase();
    // Block if this user already has a pending request — they must wait
    // until the previous one is approved or rejected before submitting again.
    const { data: pendingForUser } = await sb
      .from("subscription_requests")
      .select("id")
      .eq("telegram_username", s.telegram_username)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (pendingForUser) {
      return {
        ok: false as const,
        error:
          "You already have a deposit request pending review. Please wait until it is approved or rejected before submitting another.",
      };
    }
    // Global duplicate-hash block: same TXN cannot be submitted twice by
    // ANY user, regardless of status. Prevents replaying the same on-chain
    // transaction.
    const txnHash = data.txnHash.trim();
    const normalizedHash = normalizeTxnHash(txnHash);
    let duplicateHash = false;
    try {
      duplicateHash = await txnHashAlreadySubmitted(sb, normalizedHash);
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Could not verify this TXN hash." };
    }
    if (duplicateHash) {
      return {
        ok: false as const,
        error: DUPLICATE_TXN_ERROR,
      };
    }

    // Random 1-10 GTC network fee, recorded with every deposit so admins
    // can reconcile the on-chain amount. Fall back to a fresh random if
    // the client did not pre-display one.
    const feeGtc =
      typeof data.feeGtc === "number"
        ? Math.max(1, Math.min(10, Math.round(data.feeGtc)))
        : 1 + Math.floor(Math.random() * 10);

    const { data: row, error } = await sb
      .from("subscription_requests")
      .insert({
        telegram_username: s.telegram_username,
        telegram_user_id: s.telegram_user_id,
        plan_gtc: plan.gtc,
        plan_messages: plan.messages,
        txn_hash: txnHash,
        fee_gtc: feeGtc,
        status: "pending",
      })
      .select("id,fee_gtc")
      .single();
    if (error) {
      // Race-safe fallback: if a parallel insert created the same hash
      // between our SELECT and INSERT, the DB registry/trigger trips here.
      if (isDuplicateTxnDbError(error.message)) {
        return {
          ok: false as const,
          error: DUPLICATE_TXN_ERROR,
        };
      }
      return { ok: false as const, error: error.message };
    }
    return {
      ok: true as const,
      id: row.id as string,
      feeGtc: (row.fee_gtc as number) ?? feeGtc,
    };
  });


/** User: list their own subscription history. */
export const listMySubscriptions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified) return { ok: false as const, error: "Login required", rows: [] };
    const sb = getUserSupabase();
    const { data: rows } = await sb
      .from("subscription_requests")
      .select("*")
      .eq("telegram_username", s.telegram_username)
      .order("created_at", { ascending: false })
      .limit(50);
    return { ok: true as const, rows: rows ?? [] };
  });

/** Admin: list all subscription requests (with deposit cross-check). */
export const adminListSubscriptions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified || !isAdmin(s.telegram_username)) {
      return { ok: false as const, error: "Admin only", rows: [] };
    }
    const sb = getUserSupabase();
    const { data: rows } = await sb
      .from("subscription_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    // Best-effort: also fetch matching deposit so admin sees verified status
    const dep = userDb.deposits;
    type AnyRow = { [k: string]: string | number | boolean | null | AnyRow | AnyRow[] };
    const enriched: AnyRow[] = await Promise.all(
      ((rows ?? []) as AnyRow[]).map(async (r) => {
        let matched: AnyRow | null = null;
        const hash = r.txn_hash as string | null;
        if (hash) {
          const { data: d } = await sb
            .from(dep.table)
            .select("*")
            .eq(dep.txnHash, hash)
            .maybeSingle();
          matched = (d as AnyRow) ?? null;
        }
        return { ...r, deposit_match: matched } as AnyRow;
      }),
    );
    return { ok: true as const, rows: enriched };
  });

/** Admin: approve a request → credits bonus to today's row + notifies user. */
export const adminApproveSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified || !isAdmin(s.telegram_username)) {
      return { ok: false as const, error: "Admin only" };
    }
    const sb = getUserSupabase();
    const { data: req } = await sb
      .from("subscription_requests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!req) return { ok: false as const, error: "Not found" };
    if (req.status !== "pending") {
      return { ok: false as const, error: `Already ${req.status}` };
    }

    const reqHash = normalizeTxnHash(String(req.txn_hash ?? ""));
    let duplicateHash = false;
    try {
      duplicateHash = !!reqHash && (await txnHashAlreadySubmitted(sb, reqHash, data.id));
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Could not verify this TXN hash." };
    }
    if (duplicateHash) {
      return {
        ok: false as const,
        error:
          "This TXN hash is already attached to another deposit request. Reject the duplicate instead of approving it.",
      };
    }

    // Atomically flip pending → approved FIRST. Only credit if this call won
    // the race (rows affected > 0). Prevents double-credit on parallel clicks
    // and prevents credits being added before the row is actually approved.
    const { data: updated, error } = await sb
      .from("subscription_requests")
      .update({
        status: "approved",
        decided_by: s.telegram_username,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id");
    if (error) return { ok: false as const, error: error.message };
    if (!updated || updated.length === 0) {
      return { ok: false as const, error: "Already decided" };
    }

    const snapshot = await creditBonus(
      req.telegram_username as string,
      (req.plan_messages as number) ?? 0,
    );
    return { ok: true as const, snapshot };
  });

/** Admin: reject (with reason). */
export const adminRejectSubscription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        id: z.string().uuid(),
        reason: z.string().min(2).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await getSession(data.sessionId);
    if (!s?.verified || !isAdmin(s.telegram_username)) {
      return { ok: false as const, error: "Admin only" };
    }
    const sb = getUserSupabase();
    const { error } = await sb
      .from("subscription_requests")
      .update({
        status: "rejected",
        reject_reason: data.reason.trim(),
        decided_by: s.telegram_username,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "pending");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
