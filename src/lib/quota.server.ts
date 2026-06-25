// Daily message quota.
// - FREE daily allowance (10) resets every UTC day — DOES NOT roll over.
// - PAID credits live on a persistent per-user row (`user_credits`) and
//   carry over across days until used.
import { getUserSupabase } from "@/lib/user-supabase.server";

export const FREE_DAILY_ALLOWANCE = 10;

export const LIMIT_REACHED_MESSAGE =
  "Your daily message limit has been reached.\n\nPlease use the GTC Chatbot again tomorrow, or subscribe to continue chatting today.";

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export interface QuotaSnapshot {
  dailyAllowance: number; // always FREE_DAILY_ALLOWANCE
  used: number;           // free messages used today (capped at allowance)
  freeLeft: number;
  bonusLeft: number;      // persistent paid credits remaining
  totalLeft: number;
}

async function getDailyUsed(username: string): Promise<number> {
  const sb = getUserSupabase();
  const day = today();
  const { data } = await sb
    .from("message_usage")
    .select("used")
    .eq("telegram_username", username)
    .eq("day", day)
    .maybeSingle();
  if (data) return (data.used as number) ?? 0;
  await sb.from("message_usage").insert({
    telegram_username: username,
    day,
    used: 0,
    bonus_remaining: 0,
  });
  return 0;
}

async function getPaidCredits(username: string): Promise<number> {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("user_credits")
    .select("paid_credits")
    .eq("telegram_username", username)
    .maybeSingle();
  if (data) return (data.paid_credits as number) ?? 0;
  await sb
    .from("user_credits")
    .insert({ telegram_username: username, paid_credits: 0 });
  return 0;
}

function toSnapshot(used: number, paid: number): QuotaSnapshot {
  const freeLeft = Math.max(0, FREE_DAILY_ALLOWANCE - used);
  return {
    dailyAllowance: FREE_DAILY_ALLOWANCE,
    used: Math.min(used, FREE_DAILY_ALLOWANCE),
    freeLeft,
    bonusLeft: paid,
    totalLeft: freeLeft + paid,
  };
}

export async function getQuota(username: string): Promise<QuotaSnapshot> {
  const [used, paid] = await Promise.all([
    getDailyUsed(username),
    getPaidCredits(username),
  ]);
  return toSnapshot(used, paid);
}

/** Consume 1 message. Free first, then paid. */
export async function consumeQuota(
  username: string,
): Promise<{ allowed: boolean; snapshot: QuotaSnapshot }> {
  const sb = getUserSupabase();
  const day = today();
  const [used, paid] = await Promise.all([
    getDailyUsed(username),
    getPaidCredits(username),
  ]);

  if (used < FREE_DAILY_ALLOWANCE) {
    const next = used + 1;
    await sb
      .from("message_usage")
      .update({ used: next, updated_at: new Date().toISOString() })
      .eq("telegram_username", username)
      .eq("day", day);
    return { allowed: true, snapshot: toSnapshot(next, paid) };
  }
  if (paid > 0) {
    const nextPaid = paid - 1;
    await sb
      .from("user_credits")
      .update({ paid_credits: nextPaid, updated_at: new Date().toISOString() })
      .eq("telegram_username", username);
    return { allowed: true, snapshot: toSnapshot(used, nextPaid) };
  }
  return { allowed: false, snapshot: toSnapshot(used, paid) };
}

/** Add paid credits to the persistent per-user balance (no rollover concerns). */
export async function creditBonus(
  username: string,
  amount: number,
): Promise<QuotaSnapshot> {
  const sb = getUserSupabase();
  const [used, paid] = await Promise.all([
    getDailyUsed(username),
    getPaidCredits(username),
  ]);
  const nextPaid = paid + amount;
  await sb
    .from("user_credits")
    .update({ paid_credits: nextPaid, updated_at: new Date().toISOString() })
    .eq("telegram_username", username);
  return toSnapshot(used, nextPaid);
}
