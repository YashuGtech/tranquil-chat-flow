import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  requestOtp,
  verifyOtp,
  listTrainingDocs,
  upsertTrainingDoc,
  deleteTrainingDoc,
} from "@/lib/bot.functions";

export const Route = createFileRoute("/training")({
  head: () => ({
    meta: [
      { title: "GTech Bot — Training Console" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TrainingPage,
});

interface Sess { id: string; username: string; isTrainer?: boolean }
interface Doc {
  id: string;
  title: string;
  content: string;
  tags: string[] | null;
  active: boolean;
  updated_at: string;
}

function Gate({ onAuth }: { onAuth: (s: Sess) => void }) {
  const req = useServerFn(requestOtp);
  const ver = useServerFn(verifyOtp);
  const [step, setStep] = useState<"u" | "c">("u");
  const [u, setU] = useState("");
  const [c, setC] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setErr(null); setBusy(true);
    try {
      const r = await req({ data: { identifier: u } });
      if (!r.ok) { setErr(r.error); return; }
      setStep("c");
    } finally { setBusy(false); }
  }
  async function verify() {
    setErr(null); setBusy(true);
    try {
      const r = await ver({ data: { identifier: u, code: c } });
      if (!r.ok) { setErr(r.error); return; }
      if (!r.isTrainer) { setErr("Forbidden — trainer access is limited to @Yashu_Gtech."); return; }
      onAuth({ id: r.sessionId, username: r.username, isTrainer: true });
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-md mx-auto mt-16 glass p-7 rounded-3xl">
      <h1 className="text-xl font-black blue-text mb-2">Training Console</h1>
      <p className="text-xs text-muted-foreground mb-5">
        Restricted to <b>@Yashu_Gtech</b>. Verify via OTP sent on @GtechAI_Bot.
      </p>
      {step === "u" ? (
        <div className="space-y-3">
          <input value={u} onChange={(e) => setU(e.target.value)} placeholder="Telegram username"
            className="w-full h-11 px-3 rounded-md bg-input border border-border" />
          <button onClick={send} disabled={busy || !u.trim()}
            className="w-full h-11 rounded-xl text-primary-foreground font-bold disabled:opacity-60"
            style={{ background: "var(--gradient-blue)" }}>
            {busy ? "Sending…" : "Send OTP"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <input value={c} onChange={(e) => setC(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="4-digit OTP"
            className="w-full h-11 px-3 rounded-md bg-input border border-border tracking-[0.5em] text-center text-lg" />
          <button onClick={verify} disabled={busy || c.length !== 4}
            className="w-full h-11 rounded-xl text-primary-foreground font-bold disabled:opacity-60"
            style={{ background: "var(--gradient-blue)" }}>
            {busy ? "Verifying…" : "Verify & Enter"}
          </button>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </div>
  );
}

function TrainingPage() {
  const [s, setS] = useState<Sess | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const list = useServerFn(listTrainingDocs);
  const upsert = useServerFn(upsertTrainingDoc);
  const del = useServerFn(deleteTrainingDoc);

  async function refresh(sess: Sess) {
    const r = await list({ data: { sessionId: sess.id } });
    if (r.ok) setDocs(r.rows as Doc[]);
  }

  useEffect(() => { if (s) void refresh(s); }, [s]);

  function startNew() {
    setEditing(null); setTitle(""); setContent(""); setTags(""); setActive(true);
  }
  function startEdit(d: Doc) {
    setEditing(d); setTitle(d.title); setContent(d.content);
    setTags((d.tags ?? []).join(", ")); setActive(d.active);
  }

  async function save() {
    if (!s || !title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      await upsert({ data: {
        sessionId: s.id, id: editing?.id, title, content,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean), active,
      }});
      startNew();
      await refresh(s);
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!s || !confirm("Delete this training entry?")) return;
    await del({ data: { sessionId: s.id, id } });
    await refresh(s);
  }

  if (!s) return <main className="min-h-screen px-4"><Gate onAuth={setS} /></main>;

  return (
    <main className="min-h-screen px-4 py-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black blue-text">Training Console</h1>
          <p className="text-xs text-muted-foreground">Signed in as @{s.username} (trainer)</p>
        </div>
        <a href="/" className="text-xs px-3 py-2 rounded bg-secondary">← Back to chat</a>
      </header>

      <section className="glass rounded-2xl p-5 mb-6">
        <h2 className="font-bold mb-3">{editing ? "Edit entry" : "Add new training entry"}</h2>
        <div className="grid gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. 'Withdrawal limits')"
            className="h-11 px-3 rounded-md bg-input border border-border" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="Detailed knowledge the bot should use…" rows={6}
            className="px-3 py-2 rounded-md bg-input border border-border" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma-separated"
            className="h-11 px-3 rounded-md bg-input border border-border" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (included in bot's system prompt)
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !title.trim() || !content.trim()}
              className="px-5 h-11 rounded-xl text-primary-foreground font-bold disabled:opacity-60"
              style={{ background: "var(--gradient-blue)" }}>
              {busy ? "Saving…" : editing ? "Update" : "Add to bot"}
            </button>
            {editing && (
              <button onClick={startNew} className="px-5 h-11 rounded-xl bg-secondary">Cancel</button>
            )}
          </div>
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="font-bold mb-3">Knowledge base ({docs.length})</h2>
        <div className="grid gap-3">
          {docs.map((d) => (
            <div key={d.id} className="border border-border rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{d.title} {!d.active && <span className="text-xs text-muted-foreground">(inactive)</span>}</div>
                  <div className="text-[11px] text-muted-foreground">Updated {new Date(d.updated_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(d)} className="text-xs px-3 py-1.5 rounded bg-secondary">Edit</button>
                  <button onClick={() => remove(d.id)} className="text-xs px-3 py-1.5 rounded bg-destructive text-destructive-foreground">Delete</button>
                </div>
              </div>
              <p className="text-sm mt-2 whitespace-pre-wrap text-foreground/80 line-clamp-4">{d.content}</p>
              {d.tags && d.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.tags.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary">{t}</span>)}
                </div>
              )}
            </div>
          ))}
          {docs.length === 0 && <p className="text-sm text-muted-foreground">No training entries yet. Add the first one above.</p>}
        </div>
      </section>
    </main>
  );
}