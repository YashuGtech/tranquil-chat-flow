// Lightweight per-minute counters for chat traffic. All writes are
// best-effort: any DB error is swallowed so a missing table never breaks
// the chat endpoint itself.
import { getUserSupabase } from "@/lib/user-supabase.server";

function currentMinute(): string {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

type Kind = "received" | "responded";

async function bumpColumn(kind: Kind) {
  try {
    const sb = getUserSupabase();
    const minute = currentMinute();
    const { data } = await sb
      .from("chat_metrics")
      .select("received,responded")
      .eq("minute_bucket", minute)
      .maybeSingle();
    const cur = (data as { received?: number; responded?: number } | null) ?? {};
    const next = {
      minute_bucket: minute,
      received: (cur.received ?? 0) + (kind === "received" ? 1 : 0),
      responded: (cur.responded ?? 0) + (kind === "responded" ? 1 : 0),
    };
    if (!data) {
      await sb.from("chat_metrics").insert(next);
    } else {
      await sb
        .from("chat_metrics")
        .update({ received: next.received, responded: next.responded })
        .eq("minute_bucket", minute);
    }
  } catch {
    /* metrics are best-effort */
  }
}

export function recordChatReceived() {
  void bumpColumn("received");
}
export function recordChatResponded() {
  void bumpColumn("responded");
}

export interface ChatMetricsSummary {
  totalReceived: number;
  totalResponded: number;
  avgPerMinute: number;
  queued: number;
  hourly: Array<{ hour: string; received: number; responded: number }>;
  perMinute: Array<{ minute: string; received: number; responded: number }>;
}

export async function readChatMetrics(): Promise<ChatMetricsSummary> {
  const empty: ChatMetricsSummary = {
    totalReceived: 0,
    totalResponded: 0,
    avgPerMinute: 0,
    queued: 0,
    hourly: [],
    perMinute: [],
  };
  try {
    const sb = getUserSupabase();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb
      .from("chat_metrics")
      .select("minute_bucket,received,responded")
      .gte("minute_bucket", since)
      .order("minute_bucket", { ascending: true });
    const rows = (data ?? []) as Array<{
      minute_bucket: string;
      received: number | null;
      responded: number | null;
    }>;
    if (rows.length === 0) return empty;

    const hourMap = new Map<string, { received: number; responded: number }>();
    let totalR = 0,
      totalA = 0;
    for (const r of rows) {
      const rec = r.received ?? 0;
      const ans = r.responded ?? 0;
      totalR += rec;
      totalA += ans;
      const hour = r.minute_bucket.slice(0, 13) + ":00:00.000Z";
      const cur = hourMap.get(hour) ?? { received: 0, responded: 0 };
      cur.received += rec;
      cur.responded += ans;
      hourMap.set(hour, cur);
    }

    // Build a continuous 24h timeline (fill gaps with zeros).
    const hourly: ChatMetricsSummary["hourly"] = [];
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i--) {
      const h = new Date(start.getTime() - i * 60 * 60 * 1000).toISOString();
      const v = hourMap.get(h) ?? { received: 0, responded: 0 };
      hourly.push({ hour: h, ...v });
    }

    // Queue ≈ received but not yet responded in the last 5 minutes.
    const fiveAgo = Date.now() - 5 * 60 * 1000;
    let qRec = 0,
      qAns = 0;
    for (const r of rows) {
      if (new Date(r.minute_bucket).getTime() >= fiveAgo) {
        qRec += r.received ?? 0;
        qAns += r.responded ?? 0;
      }
    }
    const queued = Math.max(0, qRec - qAns);

    // Average per minute over last 60 minutes of real activity.
    const sixtyAgo = Date.now() - 60 * 60 * 1000;
    const lastHour = rows.filter(
      (r) => new Date(r.minute_bucket).getTime() >= sixtyAgo,
    );
    const lastHourTotal = lastHour.reduce(
      (a, r) => a + (r.received ?? 0),
      0,
    );
    const avgPerMinute = lastHourTotal / 60;

    return {
      totalReceived: totalR,
      totalResponded: totalA,
      avgPerMinute,
      queued,
      hourly,
      perMinute: rows.slice(-60).map((r) => ({
        minute: r.minute_bucket,
        received: r.received ?? 0,
        responded: r.responded ?? 0,
      })),
    };
  } catch {
    return empty;
  }
}
