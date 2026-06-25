import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  requestOtp,
  verifyOtp,
  adminListRequests,
  adminUpdateRequest,
  adminLookupUser,
  adminUpdateApiKey,
  adminReplyRequest,
  adminFindRequest,
} from "@/lib/bot.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle2, RefreshCw } from "lucide-react";
import { QueryStatCard, QuerySection, QueryItem } from "@/components/admin/QueriesUI";
import { SubscriptionsUI } from "@/components/admin/SubscriptionsUI";
import { AIKeysUI } from "@/components/admin/AIKeysUI";
import { TestingUI } from "@/components/admin/TestingUI";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "GTech Admin Dashboard" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Admin,
});

interface AdminSession {
  id: string;
  username: string;
  isTrainer?: boolean;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function TelegramGate({ onAuth }: { onAuth: (s: AdminSession) => void }) {
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
      const r = await req({ data: { identifier: u, mode: "username" } });
      if (!r.ok) { setErr(r.error); return; }
      setStep("c");
    } finally { setBusy(false); }
  }
  async function verify() {
    setErr(null); setBusy(true);
    try {
      const r = await ver({ data: { identifier: u, code: c, mode: "username" } });
      if (!r.ok) { setErr(r.error); return; }
      if (!r.isAdmin) { setErr("Not an admin account."); return; }
      onAuth({ id: r.sessionId, username: r.username, isTrainer: r.isTrainer });
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="glass max-w-md w-full p-8 text-center space-y-4 rounded-2xl">
        <h1 className="text-2xl font-bold blue-text">GTech Admin</h1>
        <p className="text-sm text-muted-foreground">
          Admin-only. Verify via Telegram OTP.
        </p>
        {step === "u" ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <span className="grid place-items-center px-3 rounded-md bg-secondary text-secondary-foreground text-sm font-bold">@</span>
              <input value={u} onChange={(e) => setU(e.target.value)}
                placeholder="admin telegram username"
                autoCapitalize="none"
                className="flex-1 h-11 rounded-md bg-input border border-border px-3" />
            </div>
            <Button onClick={send} disabled={busy || !u.trim()} className="w-full">
              {busy ? "Sending…" : "Send OTP"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <input value={c} onChange={(e) => setC(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric" maxLength={4} placeholder="4-digit code"
              className="w-full h-12 text-center text-2xl font-bold tracking-[0.5em] rounded-md bg-input border border-border" />
            <Button onClick={verify} disabled={busy || c.length !== 4} className="w-full">
              {busy ? "Verifying…" : "Verify"}
            </Button>
            <button onClick={() => setStep("u")} className="text-xs text-muted-foreground hover:text-foreground">← Change username</button>
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </div>
  );
}

type Req = {
  id: string;
  telegram_username: string;
  subject?: string;
  message: string;
  status: string;
  photo_url?: string | null;
  ai_analysis?: string | null;
  admin_reply?: string | null;
  reply_photo_url?: string | null;
  replied_by?: string | null;
  replied_at?: string | null;
  source?: string | null;
  created_at: string;
  assigned_admin?: string | null;
};

function Admin() {
  const [s, setS] = useState<AdminSession | null>(null);
  const [requests, setRequests] = useState<Req[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(false);
  const [lookupUser, setLookupUser] = useState("");
  const [lookupResult, setLookupResult] = useState<Record<string, unknown> | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  // API key update
  const [newGeminiKey, setNewGeminiKey] = useState("");
  const [newTgToken, setNewTgToken] = useState("");
  const [apiSaving, setApiSaving] = useState(false);
  const [apiMsg, setApiMsg] = useState<string | null>(null);

  const listFn = useServerFn(adminListRequests);
  const updateFn = useServerFn(adminUpdateRequest);
  const lookupFn = useServerFn(adminLookupUser);
  const updateApiFn = useServerFn(adminUpdateApiKey);
  const replyFn = useServerFn(adminReplyRequest);
  const findFn = useServerFn(adminFindRequest);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyPhotos, setReplyPhotos] = useState<Record<string, { file: File; url: string }>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const [searchId, setSearchId] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<Req[] | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "answered" | "reopened">("all");

  async function doSearch() {
    if (!s || !searchId.trim()) { setSearchResults(null); return; }
    setSearchBusy(true);
    try {
      const r = await findFn({ data: { sessionId: s.id, query: searchId.trim() } });
      if (r.ok) setSearchResults(r.rows as Req[]);
    } finally { setSearchBusy(false); }
  }

  function pickReplyPhoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      alert("Photo too large — max 4 MB.");
      return;
    }
    setReplyPhotos((p) => ({ ...p, [id]: { file: f, url: URL.createObjectURL(f) } }));
  }

  function clearReplyPhoto(id: string) {
    setReplyPhotos((p) => {
      const { [id]: _drop, ...rest } = p;
      return rest;
    });
  }

  function playSuccessSound() {
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ctx = new Ctx();
      const now = ctx.currentTime;
      // Two-note chime: E5 → A5
      [
        { f: 659.25, t: 0 },
        { f: 880, t: 0.12 },
      ].forEach(({ f, t }) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.25);
        o.connect(g).connect(ctx.destination);
        o.start(now + t);
        o.stop(now + t + 0.3);
      });
      setTimeout(() => ctx.close(), 800);
    } catch {/* noop */}
  }

  async function sendReply(id: string) {
    if (!s) return;
    const text = (replyDrafts[id] ?? "").trim();
    if (!text) return;
    setReplyBusy(id);
    try {
      const photo = replyPhotos[id];
      const imageBase64 = photo ? await fileToDataUrl(photo.file) : undefined;
      const r = await replyFn({ data: { sessionId: s.id, id, reply: text, imageBase64 } });
      if (r.ok) {
        setRequests((rows) =>
          rows.map((req) =>
            req.id === id
              ? {
                  ...req,
                  status: "answered",
                  admin_reply: text,
                  reply_photo_url: r.replyPhotoUrl ?? req.reply_photo_url ?? null,
                  replied_by: s.username,
                  replied_at: new Date().toISOString(),
                }
              : req,
          ),
        );
        setReplyDrafts((d) => ({ ...d, [id]: "" }));
        clearReplyPhoto(id);
        playSuccessSound();
      }
    } finally {
      setReplyBusy(null);
    }
  }

  async function loadRequests() {
    if (!s) return;
    setLoadingReqs(true);
    try {
      const r = await listFn({ data: { sessionId: s.id } });
      if (r.ok) setRequests(r.rows as Req[]);
    } finally { setLoadingReqs(false); }
  }

  useEffect(() => { if (s) loadRequests(); }, [s]);

  async function updateStatus(id: string, status: "pending" | "answered") {
    if (!s) return;
    await updateFn({ data: { sessionId: s.id, id, status } });
    setRequests((r) => r.map((req) => req.id === id ? { ...req, status } : req));
  }

  async function doLookup() {
    if (!s || !lookupUser.trim()) return;
    setLookupBusy(true);
    try {
      const r = await lookupFn({ data: { sessionId: s.id, username: lookupUser } });
      setLookupResult(r as Record<string, unknown>);
    } finally { setLookupBusy(false); }
  }

  async function saveApiKey(type: "gemini" | "telegram") {
    if (!s) return;
    const key = type === "gemini" ? newGeminiKey : newTgToken;
    if (!key.trim()) return;
    setApiSaving(true);
    try {
      const r = await updateApiFn({ data: { sessionId: s.id, key, type } });
      setApiMsg(r.ok ? "✅ Saved successfully!" : `❌ ${r.error}`);
      setTimeout(() => setApiMsg(null), 3000);
      if (type === "gemini") setNewGeminiKey("");
      else setNewTgToken("");
    } finally { setApiSaving(false); }
  }

  if (!s) return <TelegramGate onAuth={setS} />;

  const isReopened = (r: Req) => r.status !== "answered" && r.source === "user_reopened";
  const pending = requests.filter((r) => r.status !== "answered" && !isReopened(r));
  const reopened = requests.filter(isReopened);
  const answered = requests.filter((r) => r.status === "answered");

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black blue-text">GTech Admin</h1>
            <p className="text-xs text-muted-foreground">Signed in as @{s.username}</p>
          </div>
          <a href="/" className="text-xs px-3 py-2 rounded bg-secondary">← Chat</a>
        </header>

        <Tabs defaultValue="queries">
          <TabsList className="mb-6 w-full flex-wrap h-auto">
            <TabsTrigger value="queries" className="flex-1">
              Queries ({pending.length + reopened.length} open)
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="flex-1">Subscriptions</TabsTrigger>
            <TabsTrigger value="aikeys" className="flex-1">AI Keys</TabsTrigger>
            <TabsTrigger value="testing" className="flex-1">Testing</TabsTrigger>
            <TabsTrigger value="lookup" className="flex-1">User Lookup</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">API Settings</TabsTrigger>
          </TabsList>


          {/* QUERIES TAB */}
          <TabsContent value="queries">
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-5">
              <button
                type="button"
                onClick={() => setFilter((f) => (f === "pending" ? "all" : "pending"))}
                className={`text-left rounded-2xl transition ${filter === "pending" ? "ring-2 ring-violet-400" : "opacity-90 hover:opacity-100"}`}
              >
                <QueryStatCard
                  label="Pending Queries"
                  value={pending.length}
                  tone="violet"
                  icon={<FileText className="w-6 h-6" />}
                />
              </button>
              <button
                type="button"
                onClick={() => setFilter((f) => (f === "answered" ? "all" : "answered"))}
                className={`text-left rounded-2xl transition ${filter === "answered" ? "ring-2 ring-emerald-400" : "opacity-90 hover:opacity-100"}`}
              >
                <QueryStatCard
                  label="Answered Queries"
                  value={answered.length}
                  tone="emerald"
                  icon={<CheckCircle2 className="w-6 h-6" />}
                />
              </button>
              <button
                type="button"
                onClick={() => setFilter((f) => (f === "reopened" ? "all" : "reopened"))}
                className={`text-left rounded-2xl transition ${filter === "reopened" ? "ring-2 ring-amber-400" : "opacity-90 hover:opacity-100"}`}
              >
                <QueryStatCard
                  label="Reopened Queries"
                  value={reopened.length}
                  tone="amber"
                  icon={<RefreshCw className="w-6 h-6" />}
                />
              </button>
            </div>

            {filter !== "all" && (
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Showing <b className="text-foreground capitalize">{filter}</b> queries only
                </span>
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="px-2 py-1 rounded bg-secondary hover:bg-secondary/80"
                >
                  Show all
                </button>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold">User Queries</h2>
              <Button variant="outline" size="sm" onClick={loadRequests} disabled={loadingReqs}>
                {loadingReqs ? "Loading…" : "Refresh"}
              </Button>
            </div>

            <div className="mb-4 flex gap-2">
              <input
                value={searchId}
                onChange={(e) => setSearchId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
                placeholder="Search by Query ID (e.g. GT-A1B2C3D4 or full UUID)"
                className="flex-1 h-10 rounded-md bg-input border border-border px-3 text-sm"
              />
              <Button size="sm" onClick={doSearch} disabled={searchBusy || !searchId.trim()}>
                {searchBusy ? "…" : "Search"}
              </Button>
              {searchResults && (
                <Button size="sm" variant="outline" onClick={() => { setSearchResults(null); setSearchId(""); }}>
                  Clear
                </Button>
              )}
            </div>

            {(() => {
              const src = searchResults ?? requests;
              const displayedAnswered = searchResults ? src.filter((r) => r.status === "answered") : answered;
              const displayedReopened = searchResults ? src.filter(isReopened) : reopened;
              const displayedPending = searchResults ? src.filter((r) => r.status !== "answered" && !isReopened(r)) : pending;
              const showPending = filter === "all" || filter === "pending";
              const showAnswered = filter === "all" || filter === "answered";
              const showReopened = filter === "all" || filter === "reopened";
              const visiblePending = showPending ? displayedPending : [];
              const visibleAnswered = showAnswered ? displayedAnswered : [];
              const visibleReopened = showReopened ? displayedReopened : [];
              if (visibleAnswered.length === 0 && visiblePending.length === 0 && visibleReopened.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-10">
                  {searchResults ? "No queries match that ID." : "No queries yet."}
                </p>;
              }
              return (
              <div className="space-y-5">
                <QuerySection<Req>
                  title="Reopened Queries"
                  tone="amber"
                  items={visibleReopened}
                  icon={<RefreshCw className="w-5 h-5" />}
                  renderItem={(req) => (
                    <QueryItem
                      key={req.id}
                      req={req}
                      tone="amber"
                      replyDrafts={replyDrafts}
                      setReplyDrafts={setReplyDrafts}
                      replyPhotos={replyPhotos}
                      pickReplyPhoto={pickReplyPhoto}
                      clearReplyPhoto={clearReplyPhoto}
                      sendReply={sendReply}
                      replyBusy={replyBusy}
                    />
                  )}
                />
                <QuerySection<Req>
                  title="Pending Queries"
                  tone="violet"
                  items={visiblePending}
                  icon={<FileText className="w-5 h-5" />}
                  renderItem={(req) => (
                    <QueryItem
                      key={req.id}
                      req={req}
                      tone="violet"
                      replyDrafts={replyDrafts}
                      setReplyDrafts={setReplyDrafts}
                      replyPhotos={replyPhotos}
                      pickReplyPhoto={pickReplyPhoto}
                      clearReplyPhoto={clearReplyPhoto}
                      sendReply={sendReply}
                      replyBusy={replyBusy}
                    />
                  )}
                />
                <QuerySection<Req>
                  title="Answered Queries"
                  tone="emerald"
                  items={visibleAnswered}
                  icon={<CheckCircle2 className="w-5 h-5" />}
                  renderItem={(req) => (
                    <QueryItem
                      key={req.id}
                      req={req}
                      tone="emerald"
                      replyDrafts={replyDrafts}
                      setReplyDrafts={setReplyDrafts}
                      replyPhotos={replyPhotos}
                      pickReplyPhoto={pickReplyPhoto}
                      clearReplyPhoto={clearReplyPhoto}
                      sendReply={sendReply}
                      replyBusy={replyBusy}
                      onReopen={() => updateStatus(req.id, "pending")}
                    />
                  )}
                />
              </div>
              );
            })()}
          </TabsContent>

          {/* SUBSCRIPTIONS TAB */}
          <TabsContent value="subscriptions">
            <SubscriptionsUI sessionId={s.id} />
          </TabsContent>

          {/* AI KEYS TAB */}
          <TabsContent value="aikeys">
            <AIKeysUI sessionId={s.id} />
          </TabsContent>

          {/* TESTING TAB */}
          <TabsContent value="testing">
            <TestingUI sessionId={s.id} />
          </TabsContent>



          {/* USER LOOKUP TAB */}
          <TabsContent value="lookup">

            <h2 className="font-bold mb-4">User Lookup</h2>
            <div className="flex gap-2 mb-4">
              <div className="flex gap-2 flex-1">
                <span className="grid place-items-center px-3 rounded-md bg-secondary text-sm font-bold">@</span>
                <input
                  value={lookupUser}
                  onChange={(e) => setLookupUser(e.target.value)}
                  placeholder="telegram_username"
                  className="flex-1 h-11 rounded-md bg-input border border-border px-3"
                />
              </div>
              <Button onClick={doLookup} disabled={lookupBusy || !lookupUser.trim()}>
                {lookupBusy ? "Looking…" : "Look up"}
              </Button>
            </div>
            {lookupResult && (
              <div className="glass rounded-xl p-4 border border-border">
                <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                  {JSON.stringify(lookupResult, null, 2)}
                </pre>
              </div>
            )}
          </TabsContent>

          {/* API SETTINGS TAB */}
          <TabsContent value="settings">
            <h2 className="font-bold mb-4">API Settings</h2>
            <p className="text-xs text-muted-foreground mb-5">
              Update API keys. These override environment variables and are stored securely in Supabase.
            </p>

            {apiMsg && (
              <div className={`mb-4 p-3 rounded-xl text-sm font-bold text-center ${
                apiMsg.startsWith("✅") ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
              }`}>
                {apiMsg}
              </div>
            )}

            <div className="space-y-6">
              {s.isTrainer ? (
                <div className="glass rounded-xl p-4 border border-border space-y-3">
                  <h3 className="font-bold text-sm">🤖 Gemini API Key</h3>
                  <p className="text-xs text-muted-foreground">
                    Powers GTech AI chat. Restricted to <b>@Yashu_Gtech</b>.
                  </p>
                  <input
                    value={newGeminiKey}
                    onChange={(e) => setNewGeminiKey(e.target.value)}
                    placeholder="AQ.Ab8R... (Google AI Studio key)"
                    type="password"
                    className="w-full h-11 rounded-md bg-input border border-border px-3 text-sm font-mono"
                  />
                  <Button
                    onClick={() => saveApiKey("gemini")}
                    disabled={apiSaving || !newGeminiKey.trim()}
                    className="w-full"
                  >
                    {apiSaving ? "Saving…" : "Update Gemini Key"}
                  </Button>
                </div>
              ) : (
                <div className="glass rounded-xl p-4 border border-border">
                  <h3 className="font-bold text-sm mb-1">🤖 Gemini API Key</h3>
                  <p className="text-xs text-muted-foreground">
                    Gemini API key updates are restricted to <b>@Yashu_Gtech</b>.
                  </p>
                </div>
              )}

              <div className="glass rounded-xl p-4 border border-border space-y-3">
                <h3 className="font-bold text-sm">📨 Telegram Bot Token</h3>
                <p className="text-xs text-muted-foreground">Used for sending OTP codes via Telegram.</p>
                <input
                  value={newTgToken}
                  onChange={(e) => setNewTgToken(e.target.value)}
                  placeholder="1234567890:AAH..."
                  type="password"
                  className="w-full h-11 rounded-md bg-input border border-border px-3 text-sm font-mono"
                />
                <Button
                  onClick={() => saveApiKey("telegram")}
                  disabled={apiSaving || !newTgToken.trim()}
                  className="w-full"
                >
                  {apiSaving ? "Saving…" : "Update Telegram Token"}
                </Button>
              </div>

              <div className="glass rounded-xl p-4 border border-border">
                <h3 className="font-bold text-sm mb-2">ℹ️ Environment Variables</h3>
                <p className="text-xs text-muted-foreground">
                  You can also set these in your <code className="bg-secondary px-1 rounded">.env</code> file:
                </p>
                <pre className="text-xs bg-secondary rounded p-2 mt-2 overflow-auto">
{`SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
TELEGRAM_BOT_TOKEN=your_token
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.5-flash`}
                </pre>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
