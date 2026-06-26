import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGetChatMetrics } from "@/lib/chat-metrics.functions";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

interface Metrics {
  totalReceived: number;
  totalResponded: number;
  avgPerMinute: number;
  queued: number;
  hourly: Array<{ hour: string; received: number; responded: number }>;
}

export function ChatMetricsUI({ sessionId }: { sessionId: string }) {
  const fn = useServerFn(adminGetChatMetrics);
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fn({ data: { sessionId } });
      if (r.ok) setM(r.metrics);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, []);

  const chartData =
    m?.hourly.map((h) => ({
      label: new Date(h.hour).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      Received: h.received,
      Responded: h.responded,
    })) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold">Chat Metrics</h2>
          <p className="text-[11px] text-muted-foreground">
            Updated every minute · last 24 hours
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Received (24h)" value={m?.totalReceived ?? 0} tone="sky" />
        <Stat label="Responded (24h)" value={m?.totalResponded ?? 0} tone="emerald" />
        <Stat
          label="Avg msgs / min"
          value={m ? Number(m.avgPerMinute.toFixed(2)) : 0}
          tone="violet"
          suffix=" msg/min"
        />
        <Stat label="In queue (5m)" value={m?.queued ?? 0} tone="amber" />
      </div>

      <div className="glass rounded-2xl p-4 border border-border">
        <h3 className="text-sm font-bold mb-3">Hourly requests</h3>
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Received" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Responded" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  sky: "border-sky-500/50 text-sky-400",
  emerald: "border-emerald-500/50 text-emerald-400",
  violet: "border-violet-500/50 text-violet-400",
  amber: "border-amber-500/50 text-amber-400",
};

function Stat({
  label,
  value,
  tone,
  suffix,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONES;
  suffix?: string;
}) {
  return (
    <div className={`glass rounded-2xl p-4 border ${TONES[tone]}`}>
      <div className="text-[10px] font-black uppercase opacity-80">{label}</div>
      <div className="text-3xl font-black mt-1 text-foreground">
        {value}
        {suffix ? <span className="text-xs font-bold opacity-70">{suffix}</span> : null}
      </div>
    </div>
  );
}
