import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListKeyStats, adminToggleKey } from "@/lib/keys.functions";
import { Button } from "@/components/ui/button";

interface KeyStat {
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

export function AIKeysUI({ sessionId }: { sessionId: string }) {
  const listFn = useServerFn(adminListKeyStats);
  const toggleFn = useServerFn(adminToggleKey);
  const [rows, setRows] = useState<KeyStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await listFn({ data: { sessionId } });
      if (r.ok) setRows(r.rows as KeyStat[]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function toggle(id: string, next: boolean) {
    setBusyId(id);
    try {
      const r = await toggleFn({ data: { sessionId, id, active: next } });
      if (!r.ok) alert(r.error);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold">AI API key usage</h2>
          <p className="text-xs text-muted-foreground">
            Live request counts per key. <b>DB</b> keys are managed in the
            <a href="/developer" className="text-primary underline mx-1">Developer panel</a>
            and can be toggled here. <b>ENV</b> keys come from
            <code className="mx-1">.env</code> (public pool) and are always on.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="glass rounded-xl p-4 text-xs text-muted-foreground">
          No keys configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((k) => (
            <div
              key={k.id}
              className="glass rounded-xl p-3 border border-border flex flex-wrap items-center gap-3"
            >
              <div className="flex-1 min-w-[180px]">
                <div className="font-bold text-sm">
                  {k.label}{" "}
                  <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                    {k.provider}
                  </span>
                  <span
                    className={`ml-1 text-[9px] px-1.5 py-0.5 rounded font-bold ${
                      k.source === "env"
                        ? "bg-sky-500/15 text-sky-600"
                        : "bg-violet-500/15 text-violet-600"
                    }`}
                  >
                    {k.source.toUpperCase()}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {k.model} · limit {k.rpm_limit}/min
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] font-mono">
                <Stat label="last min" value={k.lastMinute} max={k.rpm_limit} />
                <Stat label="last hr" value={k.lastHour} />
                <Stat label="today" value={k.today} />
              </div>
              {k.source === "db" ? (
                <Button
                  size="sm"
                  variant={k.active ? "outline" : "default"}
                  disabled={busyId === k.id}
                  onClick={() => toggle(k.id, !k.active)}
                >
                  {busyId === k.id ? "…" : k.active ? "Disable" : "Enable"}
                </Button>
              ) : null}
              <span
                className={`text-[10px] px-2 py-1 rounded font-bold ${
                  k.active
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {k.active ? "Active" : "Disabled"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, max }: { label: string; value: number; max?: number }) {
  const hot = max ? value >= max : false;
  return (
    <div className="text-center">
      <div className={`text-base font-black ${hot ? "text-destructive" : "text-foreground"}`}>
        {value}
        {max ? `/${max}` : ""}
      </div>
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}
