// AI key pool: load-balances across multiple Gemini (Gemma) and NVIDIA
// Nemotron API keys, enforces per-key RPM, logs usage for stats.
//
// Strategy on each request:
//   1. Try Gemini/Gemma keys first (prefer them — usually free).
//   2. If all Gemini keys are over RPM, fall back to NVIDIA keys.
//   3. If everything is saturated, wait/poll up to MAX_WAIT_MS for a key
//      to free up, then proceed.
//   4. If still nothing, the caller surfaces a "busier than usual" message.
import { getUserSupabase } from "@/lib/user-supabase.server";

export type AiProvider = "gemini" | "nvidia";

export interface AiKey {
  id: string;
  provider: AiProvider;
  label: string;
  api_key: string;
  model: string | null;
  rpm_limit: number;
  active: boolean;
}

export interface PickedKey {
  key: AiKey;
  endpoint: string;
  model: string;
}

const MAX_WAIT_MS = 20_000;
const POLL_MS = 1500;

// Round-robin pointers (in-memory; per worker — best-effort, not exact).
const rrIndex: Record<AiProvider, number> = { gemini: 0, nvidia: 0 };

function defaultModel(provider: AiProvider): string {
  return provider === "gemini" ? "gemma-3-27b-it" : "nvidia/nemotron-nano-3-8b-v1";
}

function endpointFor(provider: AiProvider): string {
  if (provider === "gemini") {
    return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  }
  return "https://integrate.api.nvidia.com/v1/chat/completions";
}

function currentMinute(): string {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

async function loadActiveKeys(provider: AiProvider): Promise<AiKey[]> {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("ai_api_keys")
    .select("*")
    .eq("provider", provider)
    .eq("active", true)
    .order("created_at", { ascending: true });
  return (data ?? []) as AiKey[];
}

async function countUsage(keyId: string, minute: string): Promise<number> {
  const sb = getUserSupabase();
  const { data } = await sb
    .from("ai_api_usage")
    .select("requests")
    .eq("key_id", keyId)
    .eq("minute_bucket", minute)
    .maybeSingle();
  return (data?.requests as number) ?? 0;
}

async function tryPickFromProvider(
  provider: AiProvider,
): Promise<PickedKey | null> {
  const keys = await loadActiveKeys(provider);
  if (keys.length === 0) return null;

  const minute = currentMinute();
  // round-robin starting point
  const start = rrIndex[provider] % keys.length;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[(start + i) % keys.length];
    const used = await countUsage(k.id, minute);
    if (used < k.rpm_limit) {
      rrIndex[provider] = (start + i + 1) % keys.length;
      return {
        key: k,
        endpoint: endpointFor(provider),
        model: k.model || defaultModel(provider),
      };
    }
  }
  return null;
}

/**
 * Pick an available key, preferring Gemini, then NVIDIA. Waits up to
 * MAX_WAIT_MS for a slot if everything is saturated.
 * Returns null only when there are zero configured keys for either provider.
 */
export async function pickAvailableKey(): Promise<{
  picked: PickedKey | null;
  hadKeys: boolean;
  waited: boolean;
}> {
  const geminiKeys = await loadActiveKeys("gemini");
  const nvidiaKeys = await loadActiveKeys("nvidia");
  const hadKeys = geminiKeys.length + nvidiaKeys.length > 0;
  if (!hadKeys) return { picked: null, hadKeys, waited: false };

  // 1. Try gemini, then nvidia
  let picked = (await tryPickFromProvider("gemini")) ?? (await tryPickFromProvider("nvidia"));
  if (picked) return { picked, hadKeys, waited: false };

  // 2. All saturated — wait/poll
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    picked = (await tryPickFromProvider("gemini")) ?? (await tryPickFromProvider("nvidia"));
    if (picked) return { picked, hadKeys, waited: true };
  }
  return { picked: null, hadKeys, waited: true };
}

/** Atomically (best-effort) increment the per-minute counter for a key. */
export async function recordUsage(keyId: string): Promise<void> {
  const sb = getUserSupabase();
  const minute = currentMinute();
  const cur = await countUsage(keyId, minute);
  if (cur === 0) {
    await sb.from("ai_api_usage").insert({
      key_id: keyId,
      minute_bucket: minute,
      requests: 1,
    });
  } else {
    await sb
      .from("ai_api_usage")
      .update({ requests: cur + 1 })
      .eq("key_id", keyId)
      .eq("minute_bucket", minute);
  }
}

/** Record a hit against an env-pool candidate (Gemma #1, Nvidia #2, …). */
export async function recordEnvUsage(label: string): Promise<void> {
  const sb = getUserSupabase();
  const minute = currentMinute();
  const { data } = await sb
    .from("ai_pool_usage")
    .select("requests")
    .eq("label", label)
    .eq("minute_bucket", minute)
    .maybeSingle();
  const cur = (data?.requests as number) ?? 0;
  if (cur === 0) {
    await sb.from("ai_pool_usage").insert({
      label,
      minute_bucket: minute,
      requests: 1,
    });
  } else {
    await sb
      .from("ai_pool_usage")
      .update({ requests: cur + 1 })
      .eq("label", label)
      .eq("minute_bucket", minute);
  }
}

export interface KeyUsageStats {
  id: string;
  provider: string;
  label: string;
  model: string;
  rpm_limit: number;
  active: boolean;
  source: "db" | "env";
  lastMinute: number;
  lastHour: number;
  today: number;
}

export async function listKeysWithStats(): Promise<KeyUsageStats[]> {
  const sb = getUserSupabase();
  const now = new Date();
  const minute = currentMinute();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  // ---- DB-managed keys --------------------------------------------------
  const { data: keys } = await sb
    .from("ai_api_keys")
    .select("*")
    .order("provider", { ascending: true })
    .order("created_at", { ascending: true });

  const stats: KeyUsageStats[] = [];
  for (const k of (keys ?? []) as AiKey[]) {
    const [m, h, d] = await Promise.all([
      sb.from("ai_api_usage").select("requests").eq("key_id", k.id).eq("minute_bucket", minute).maybeSingle(),
      sb.from("ai_api_usage").select("requests").eq("key_id", k.id).gte("minute_bucket", hourAgo),
      sb.from("ai_api_usage").select("requests").eq("key_id", k.id).gte("minute_bucket", dayStartIso),
    ]);
    const sumH = (h.data ?? []).reduce((a: number, r: { requests?: number | null }) => a + ((r.requests as number) ?? 0), 0);
    const sumD = (d.data ?? []).reduce((a: number, r: { requests?: number | null }) => a + ((r.requests as number) ?? 0), 0);
    stats.push({
      id: k.id,
      provider: k.provider,
      label: k.label,
      model: k.model || defaultModel(k.provider),
      rpm_limit: k.rpm_limit,
      active: k.active,
      source: "db",
      lastMinute: ((m.data?.requests as number) ?? 0),
      lastHour: sumH,
      today: sumD,
    });
  }

  // ---- Env-pool keys (from .env) ---------------------------------------
  const { buildAiCandidatePool } = await import("@/lib/ai-pool");
  const envCandidates = buildAiCandidatePool();
  for (const c of envCandidates) {
    const [m, h, d] = await Promise.all([
      sb.from("ai_pool_usage").select("requests").eq("label", c.label).eq("minute_bucket", minute).maybeSingle(),
      sb.from("ai_pool_usage").select("requests").eq("label", c.label).gte("minute_bucket", hourAgo),
      sb.from("ai_pool_usage").select("requests").eq("label", c.label).gte("minute_bucket", dayStartIso),
    ]);
    const sumH = (h.data ?? []).reduce((a: number, r: { requests?: number | null }) => a + ((r.requests as number) ?? 0), 0);
    const sumD = (d.data ?? []).reduce((a: number, r: { requests?: number | null }) => a + ((r.requests as number) ?? 0), 0);
    const rpm = c.kind === "gemma" ? 15 : c.kind === "nvidia" ? 40 : 60;
    stats.push({
      id: `env:${c.label}`,
      provider: c.kind,
      label: c.label,
      model: c.model,
      rpm_limit: rpm,
      active: true,
      source: "env",
      lastMinute: ((m.data?.requests as number) ?? 0),
      lastHour: sumH,
      today: sumD,
    });
  }

  return stats;
}

