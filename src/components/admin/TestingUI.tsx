import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminCreateTestAccounts, adminClearTestAccounts } from "@/lib/testing.functions";
import { Button } from "@/components/ui/button";

interface RunResult {
  username: string;
  msgIndex: number;
  ok: boolean;
  ms: number;
  reply?: string;
  error?: string;
  busy?: boolean;
}

export function TestingUI({ sessionId }: { sessionId: string }) {
  const createFn = useServerFn(adminCreateTestAccounts);
  const clearFn = useServerFn(adminClearTestAccounts);
  const [numUsers, setNumUsers] = useState(3);
  const [msgsPer, setMsgsPer] = useState(2);
  const [prompt, setPrompt] = useState("Hi, what is GTech Network?");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  async function runTest() {
    setRunning(true);
    setResults([]);
    setSummary(null);
    try {
      const r = await createFn({ data: { sessionId, count: numUsers } });
      if (!r.ok) {
        setSummary(`❌ ${r.error}`);
        return;
      }
      const all: RunResult[] = [];
      const started = Date.now();

      // Each test user runs its messages sequentially (so the conversation grows),
      // but all users run in parallel.
      await Promise.all(
        r.accounts.map(async (acc) => {
          const convo: Array<{ role: "user" | "assistant"; content: string }> = [];
          for (let i = 0; i < msgsPer; i++) {
            const text = `${prompt} (msg ${i + 1}/${msgsPer} from ${acc.username})`;
            convo.push({ role: "user", content: text });
            const t0 = performance.now();
            try {
              const resp = await fetch("/api/chat", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  sessionId: acc.sessionId,
                  messages: convo,
                }),
              });
              const ms = Math.round(performance.now() - t0);
              const j = (await resp.json().catch(() => ({}))) as {
                reply?: string;
                error?: string;
                busy?: boolean;
              };
              const row: RunResult = {
                username: acc.username,
                msgIndex: i + 1,
                ok: resp.ok && !j.error,
                ms,
                reply: j.reply,
                error: j.error,
                busy: j.busy,
              };
              all.push(row);
              setResults((prev) => [...prev, row]);
              if (j.reply) convo.push({ role: "assistant", content: j.reply });
            } catch (e) {
              const ms = Math.round(performance.now() - t0);
              const row: RunResult = {
                username: acc.username,
                msgIndex: i + 1,
                ok: false,
                ms,
                error: e instanceof Error ? e.message : "network error",
              };
              all.push(row);
              setResults((prev) => [...prev, row]);
            }
          }
        }),
      );

      const totalMs = Date.now() - started;
      const ok = all.filter((x) => x.ok).length;
      const fail = all.length - ok;
      const avg = all.reduce((a, b) => a + b.ms, 0) / Math.max(all.length, 1);
      setSummary(
        `✅ ${ok} ok · ❌ ${fail} fail · ${all.length} total in ${(totalMs / 1000).toFixed(1)}s · avg ${Math.round(avg)}ms`,
      );
    } finally {
      setRunning(false);
    }
  }

  async function clearAll() {
    if (!confirm("Delete all test_* sessions and their chat messages?")) return;
    const r = await clearFn({ data: { sessionId } });
    if (r.ok) {
      setSummary(`🧹 Removed ${r.removed} test sessions`);
      setResults([]);
    } else {
      setSummary(`❌ ${r.error}`);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold">Chat load testing</h2>
        <p className="text-xs text-muted-foreground">
          Spawns N synthetic verified accounts (<code>test_*</code>) and fires
          messages against <code>/api/chat</code> in parallel. Useful to verify
          key rotation, quota, and the <b>AI Keys</b> usage counters.
        </p>
      </div>

      <div className="glass rounded-xl p-4 space-y-3 border border-border">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Test accounts</span>
            <input
              type="number" min={1} max={50}
              value={numUsers}
              onChange={(e) => setNumUsers(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="w-full h-10 rounded-md bg-input border border-border px-3"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Messages per account</span>
            <input
              type="number" min={1} max={20}
              value={msgsPer}
              onChange={(e) => setMsgsPer(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-full h-10 rounded-md bg-input border border-border px-3"
            />
          </label>
          <div className="text-xs space-y-1 col-span-2 md:col-span-1">
            <span className="block text-muted-foreground">Total requests</span>
            <div className="h-10 grid place-items-center rounded-md bg-secondary font-mono font-bold">
              {numUsers * msgsPer}
            </div>
          </div>
        </div>

        <label className="text-xs space-y-1 block">
          <span className="block text-muted-foreground">Base prompt</span>
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button onClick={runTest} disabled={running}>
            {running ? "Running…" : `Run test (${numUsers * msgsPer} requests)`}
          </Button>
          <Button variant="outline" onClick={clearAll} disabled={running}>
            Cleanup test accounts
          </Button>
        </div>
        {summary && <div className="text-sm font-bold">{summary}</div>}
      </div>

      {results.length > 0 && (
        <div className="glass rounded-xl border border-border overflow-hidden">
          <div className="text-xs font-bold p-3 border-b border-border">
            Results ({results.length})
          </div>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {results.map((r, i) => (
              <div key={i} className="p-2 text-xs flex flex-wrap gap-2 items-start">
                <span
                  className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                    r.ok
                      ? "bg-emerald-500/15 text-emerald-600"
                      : r.busy
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {r.ok ? "OK" : r.busy ? "BUSY" : "FAIL"}
                </span>
                <span className="font-mono opacity-70">#{r.msgIndex}</span>
                <span className="font-mono opacity-70">{r.username}</span>
                <span className="font-mono opacity-70">{r.ms}ms</span>
                <span className="flex-1 min-w-[200px] text-muted-foreground line-clamp-2">
                  {r.reply ?? r.error ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
