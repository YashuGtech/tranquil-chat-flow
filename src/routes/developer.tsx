import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  devListKeys,
  devAddKey,
  devToggleKey,
  devDeleteKey,
} from "@/lib/keys.functions";
import { requestOtp, verifyOtp } from "@/lib/bot.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/developer")({
  head: () => ({
    meta: [
      { title: "GTech Developer Panel" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DeveloperPage,
});

interface Session {
  id: string;
  username: string;
  isTrainer: boolean;
}

interface KeyStat {
  id: string;
  provider: "gemini" | "nvidia";
  label: string;
  model: string;
  rpm_limit: number;
  active: boolean;
  lastMinute: number;
  lastHour: number;
  today: number;
}

function Gate({ onAuth }: { onAuth: (s: Session) => void }) {
  const req = useServerFn(requestOtp);
  const ver = useServerFn(verifyOtp);
  const [step, setStep] = useState<"u" | "c">("u");
  const [u, setU] = useState("");
  const [c, setC] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setErr(null);
    setBusy(true);
    try {
      const r = await req({ data: { identifier: u, mode: "username" } });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setStep("c");
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setErr(null);
    setBusy(true);
    try {
      const r = await ver({ data: { identifier: u, code: c, mode: "username" } });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (!r.isTrainer) {
        setErr("Developer access required (@Yashu_Gtech).");
        return;
      }
      onAuth({ id: r.sessionId, username: r.username, isTrainer: !!r.isTrainer });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="glass max-w-md w-full p-8 text-center space-y-4 rounded-2xl">
        <h1 className="text-2xl font-bold blue-text">Developer Panel</h1>
        <p className="text-sm text-muted-foreground">
          Restricted. Verify via Telegram OTP.
        </p>
        {step === "u" ? (
          <div className="space-y-3">
            <input
              value={u}
              onChange={(e) => setU(e.target.value)}
              placeholder="telegram username"
              autoCapitalize="none"
              className="w-full h-11 rounded-md bg-input border border-border px-3"
            />
            <Button onClick={send} disabled={busy || !u.trim()} className="w-full">
              {busy ? "Sending…" : "Send OTP"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={c}
              onChange={(e) => setC(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="4-digit code"
              className="w-full h-12 text-center text-2xl font-bold tracking-[0.5em] rounded-md bg-input border border-border"
            />
            <Button onClick={verify} disabled={busy || c.length !== 4} className="w-full">
              {busy ? "Verifying…" : "Verify"}
            </Button>
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </div>
  );
}

function DeveloperPage() {
  const [s, setS] = useState<Session | null>(null);
  const [rows, setRows] = useState<KeyStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    provider: "gemini" as "gemini" | "nvidia",
    label: "",
    api_key: "",
    model: "",
    rpm_limit: 15,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const listFn = useServerFn(devListKeys);
  const addFn = useServerFn(devAddKey);
  const toggleFn = useServerFn(devToggleKey);
  const delFn = useServerFn(devDeleteKey);

  async function load() {
    if (!s) return;
    setLoading(true);
    try {
      const r = await listFn({ data: { sessionId: s.id } });
      if (r.ok) setRows(r.rows as KeyStat[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (s) load();
    const t = setInterval(() => s && load(), 15_000);
    return () => clearInterval(t);
  }, [s]);

  async function add() {
    if (!s) return;
    if (!form.label.trim() || !form.api_key.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await addFn({
        data: {
          sessionId: s.id,
          provider: form.provider,
          label: form.label.trim(),
          api_key: form.api_key.trim(),
          model: form.model.trim() || undefined,
          rpm_limit: form.rpm_limit,
        },
      });
      if (r.ok) {
        setMsg("✅ Key added");
        setForm({ ...form, label: "", api_key: "", model: "" });
        load();
      } else {
        setMsg(`❌ ${r.error}`);
      }
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    if (!s) return;
    await toggleFn({ data: { sessionId: s.id, id, active } });
    load();
  }
  async function remove(id: string) {
    if (!s) return;
    if (!confirm("Delete this API key?")) return;
    await delFn({ data: { sessionId: s.id, id } });
    load();
  }

  if (!s) return <Gate onAuth={setS} />;

  const gemini = rows.filter((r) => r.provider === "gemini");
  const nvidia = rows.filter((r) => r.provider === "nvidia");

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black blue-text">Developer Panel</h1>
            <p className="text-xs text-muted-foreground">
              AI key pool · @{s.username}
            </p>
          </div>
          <a href="/" className="text-xs px-3 py-2 rounded bg-secondary">
            ← Chat
          </a>
        </header>

        <div className="glass rounded-2xl p-4 mb-6 border border-amber-400/30 bg-amber-500/5">
          <p className="text-sm">
            <b>Reminder:</b> Free Google Gemini/Gemma keys are limited to{" "}
            <b>15 requests/minute</b> each. The chat router will load-balance
            across all active keys; when all Gemma keys are full it falls back to
            NVIDIA Nemotron, and finally waits briefly before responding with
            "busier than usual".
          </p>
        </div>

        {/* Add form */}
        <div className="glass rounded-2xl p-5 mb-6 border border-border space-y-3">
          <h2 className="font-bold">Add new API key</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => {
                  const provider = e.target.value as "gemini" | "nvidia";
                  setForm({
                    ...form,
                    provider,
                    rpm_limit: provider === "gemini" ? 15 : 1000,
                  });
                }}
                className="mt-1 w-full h-11 rounded-md bg-input border border-border px-3 text-sm"
              >
                <option value="gemini">Gemini / Gemma (Google AI Studio)</option>
                <option value="nvidia">NVIDIA Nemotron Nano 3</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Label</label>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Gemma key #1"
                className="mt-1 w-full h-11 rounded-md bg-input border border-border px-3 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-bold text-muted-foreground">API key</label>
              <input
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                type="password"
                placeholder="paste the API key"
                className="mt-1 w-full h-11 rounded-md bg-input border border-border px-3 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">
                Model (optional)
              </label>
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder={
                  form.provider === "gemini"
                    ? "gemma-3-27b-it"
                    : "nvidia/nemotron-nano-3-8b-v1"
                }
                className="mt-1 w-full h-11 rounded-md bg-input border border-border px-3 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">RPM limit</label>
              <input
                type="number"
                value={form.rpm_limit}
                onChange={(e) =>
                  setForm({ ...form, rpm_limit: Number(e.target.value) || 0 })
                }
                className="mt-1 w-full h-11 rounded-md bg-input border border-border px-3 text-sm"
              />
            </div>
          </div>
          {msg && (
            <div
              className={`p-2 rounded text-sm font-bold text-center ${
                msg.startsWith("✅")
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {msg}
            </div>
          )}
          <Button
            onClick={add}
            disabled={saving || !form.label.trim() || !form.api_key.trim()}
            className="w-full"
          >
            {saving ? "Saving…" : "Add key"}
          </Button>
        </div>

        {/* Lists */}
        {([
          ["Gemini / Gemma keys", gemini],
          ["NVIDIA Nemotron keys", nvidia],
        ] as const).map(([title, list]) => (
          <section key={title} className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">
                {title}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  ({list.length})
                </span>
              </h2>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                {loading ? "…" : "Refresh"}
              </Button>
            </div>
            {list.length === 0 ? (
              <div className="glass rounded-xl p-4 text-xs text-muted-foreground">
                No keys configured.
              </div>
            ) : (
              <div className="space-y-2">
                {list.map((k) => (
                  <div
                    key={k.id}
                    className="glass rounded-xl p-3 border border-border flex items-center gap-3 flex-wrap"
                  >
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-bold text-sm">{k.label}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {k.model} · limit {k.rpm_limit} rpm
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] font-mono">
                      <Stat label="last min" value={k.lastMinute} max={k.rpm_limit} />
                      <Stat label="last hr" value={k.lastHour} />
                      <Stat label="today" value={k.today} />
                    </div>
                    <button
                      onClick={() => toggle(k.id, !k.active)}
                      className={`text-[11px] px-2 py-1 rounded font-bold ${
                        k.active
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {k.active ? "Active" : "Disabled"}
                    </button>
                    <button
                      onClick={() => remove(k.id)}
                      className="text-[11px] px-2 py-1 rounded bg-destructive/15 text-destructive font-bold"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
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
