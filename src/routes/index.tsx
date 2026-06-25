import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { SecureImage } from "@/components/SecureImage";
import {
  saveMessage,
  requestOtp,
  verifyOtp,
  getUserQueries,
  analyzeAndForwardPhoto,
  raiseTicket,
  reopenUserQuery,
} from "@/lib/bot.functions";
import { getMyQuota, listMySubscriptions } from "@/lib/subscription.functions";
import { SubscriptionDialog } from "@/components/SubscriptionDialog";
import { QuotaBar } from "@/components/QuotaBar";
import gtcCoin from "@/assets/gtc-coin.png";
import iconSend from "@/assets/icon-send.png";
import iconPhoto from "@/assets/icon-photo.png";
import iconTicket from "@/assets/icon-ticket.png";
import qaPhoto from "@/assets/qa-photo.png";
import qaForm from "@/assets/qa-form.png";
import qaSend from "@/assets/qa-send.png";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GTech AI — Crypto & Forex Assistant" },
      {
        name: "description",
        content:
          "GTech AI — your AI crypto + forex expert for GTech Network (GTC). Live prices, TXN verification, ticket support.",
      },
      { property: "og:title", content: "GTech AI — Crypto Assistant" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#7c3aed" },
    ],
  }),
  component: Index,
});

type Msg = {
  role: "user" | "assistant";
  content: string;
  t: number;
  photoUrl?: string;
};

interface Session {
  id: string;
  username: string;
  verified: boolean;
  isAdmin?: boolean;
  isTrainer?: boolean;
}

interface UserQuery {
  id: string;
  subject: string;
  message: string;
  status: string;
  photo_url?: string | null;
  admin_reply?: string | null;
  reply_photo_url?: string | null;
  replied_at?: string | null;
  replied_by?: string | null;
  source?: string | null;
  created_at: string;
}

type QueryComposer = {
  text: string;
  photo?: File | null;
  photoUrl?: string | null;
  busy?: boolean;
};

const BOT_NAME = "GTech AI";
const TG_BOT = "GtechAI_Bot";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4MB

function TypingDots() {
  return (
    <div className="flex gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-primary"
          style={{ animation: `bounceDot 1.2s ${i * 0.18}s infinite ease-in-out` }}
        />
      ))}
    </div>
  );
}

// Clean GTC coin — no background, no outline, no ring
function CoinImg({ size = "w-9 h-9" }: { size?: string }) {
  return (
    <img
      src={gtcCoin}
      alt="GTC"
      className={`${size} shrink-0 object-contain select-none`}
      draggable={false}
    />
  );
}

function CoinBurst() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none bg-black/40 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <CoinImg size="w-28 h-28" />
        <div className="blue-text text-xl font-bold animate-slide-in">
          Withdrawal confirmed
        </div>
      </div>
    </div>
  );
}

type Tab = "home" | "chat" | "queries";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState<"username" | "code">("username");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Counter of in-flight text chat requests (incl. silent retries) so the
  // user can keep typing/sending while previous turns are still cooking.
  const [pendingChats, setPendingChats] = useState(0);

  const [showBurst, setShowBurst] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  // Ticket popup state
  const [showTicket, setShowTicket] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDetails, setTicketDetails] = useState("");
  const [ticketSending, setTicketSending] = useState(false);
  const [ticketDone, setTicketDone] = useState(false);
  const [ticketPhoto, setTicketPhoto] = useState<File | null>(null);
  const [ticketPhotoUrl, setTicketPhotoUrl] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketResultId, setTicketResultId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Photo in chat
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(null);

  // My queries
  const [myQueries, setMyQueries] = useState<UserQuery[]>([]);
  const [queriesLoading, setQueriesLoading] = useState(false);

  // Quota + subscription state
  const [quota, setQuota] = useState<{
    dailyAllowance: number; used: number; freeLeft: number; bonusLeft: number; totalLeft: number;
  } | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [mySubs, setMySubs] = useState<Array<{
    id: string; plan_gtc: number; plan_messages: number; txn_hash: string;
    status: "pending"|"approved"|"rejected"; reject_reason: string|null;
    created_at: string; decided_at: string|null;
  }>>([]);

  const saveFn = useServerFn(saveMessage);
  const reqOtpFn = useServerFn(requestOtp);
  const verOtpFn = useServerFn(verifyOtp);
  const getQueriesFn = useServerFn(getUserQueries);
  const photoFn = useServerFn(analyzeAndForwardPhoto);
  const ticketFn = useServerFn(raiseTicket);
  const reopenQueryFn = useServerFn(reopenUserQuery);
  const quotaFn = useServerFn(getMyQuota);
  const subsFn = useServerFn(listMySubscriptions);

  const [queryReplyDrafts, setQueryReplyDrafts] = useState<Record<string, QueryComposer>>({});

  function pickQueryReplyPhoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_PHOTO_BYTES) return;
    setQueryReplyDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { text: "" }), photo: f, photoUrl: URL.createObjectURL(f) },
    }));
  }

  function clearQueryReplyPhoto(id: string) {
    setQueryReplyDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { text: "" }), photo: null, photoUrl: null },
    }));
  }

  async function reopenQuery(id: string) {
    if (!session) return;
    const draft = queryReplyDrafts[id];
    const text = draft?.text?.trim() ?? "";
    if (!text) return;
    setQueryReplyDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { text: "" }), busy: true },
    }));
    try {
      const imageBase64 = draft?.photo ? await fileToDataUrl(draft.photo) : undefined;
      const r = await reopenQueryFn({ data: { sessionId: session.id, id, message: text, imageBase64 } });
      if (!r.ok) return;
      setMyQueries((rows) => rows.map((q) => q.id === id
        ? {
            ...q,
            status: "pending",
            message: [q.message, "— User follow-up / reopen —", text].join("\n\n"),
            photo_url: r.photoUrl ?? q.photo_url ?? null,
            admin_reply: null,
            reply_photo_url: null,
            replied_at: null,
            replied_by: null,
            source: "user_reopened",
          }
        : q));
      setQueryReplyDrafts((prev) => ({ ...prev, [id]: { text: "", photo: null, photoUrl: null, busy: false } }));
    } finally {
      setQueryReplyDrafts((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? { text: "" }), busy: false },
      }));
    }
  }

  function pickTicketPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_PHOTO_BYTES) {
      setTicketError("Photo too large — max 4 MB.");
      return;
    }
    setTicketError(null);
    setTicketPhoto(f);
    setTicketPhotoUrl(URL.createObjectURL(f));
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!session || ticketSending) return;
    if (!ticketSubject.trim() || ticketDetails.trim().length < 5) return;
    setTicketError(null);
    setTicketSending(true);
    try {
      let imageBase64: string | undefined;
      if (ticketPhoto) imageBase64 = await fileToDataUrl(ticketPhoto);
      const r = await ticketFn({
        data: {
          sessionId: session.id,
          subject: ticketSubject.trim(),
          details: ticketDetails.trim(),
          imageBase64,
        },
      });
      if (r.ok) {
        setTicketResultId(r.shortId);
        setTicketDone(true);
        setTicketSubject("");
        setTicketDetails("");
        setTicketPhoto(null);
        setTicketPhotoUrl(null);
        if (tab === "queries") void loadMyQueries();
      } else {
        setTicketError(r.error);
      }
    } finally {
      setTicketSending(false);
    }
  }

  function closeTicket() {
    setShowTicket(false);
    setTicketDone(false);
    setTicketError(null);
    setTicketResultId(null);
    setTicketPhoto(null);
    setTicketPhotoUrl(null);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  useEffect(() => {
    const raw = localStorage.getItem("gtech-session");
    if (raw) {
      try { setSession(JSON.parse(raw)); } catch {}
    }
  }, []);

  useEffect(() => {
    if (session && (tab === "queries" || tab === "home")) loadMyQueries();
  }, [session, tab]);

  useEffect(() => {
    if (!session) return;
    refreshQuota();
    refreshSubs();
    // Poll so admin-granted credits and subscription approvals show up
    // in the quota bar within ~15s without requiring a page reload.
    const id = setInterval(() => {
      refreshQuota();
      refreshSubs();
    }, 15000);
    return () => clearInterval(id);
  }, [session]);

  async function loadMyQueries() {
    if (!session) return;
    setQueriesLoading(true);
    try {
      const r = await getQueriesFn({ data: { sessionId: session.id } });
      if (r.ok) setMyQueries(r.rows as UserQuery[]);
    } finally {
      setQueriesLoading(false);
    }
  }

  async function refreshQuota() {
    if (!session) return;
    const r = await quotaFn({ data: { sessionId: session.id } });
    if (r.ok) setQuota(r.snapshot);
  }
  async function refreshSubs() {
    if (!session) return;
    const r = await subsFn({ data: { sessionId: session.id } });
    if (r.ok) setMySubs(r.rows as typeof mySubs);
  }


  function persist(s: Session | null) {
    if (s) localStorage.setItem("gtech-session", JSON.stringify(s));
    else localStorage.removeItem("gtech-session");
    setSession(s);
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!usernameInput.trim() || otpSending) return;
    setAuthError(null);
    setOtpSending(true);
    try {
      const res = await reqOtpFn({ data: { identifier: usernameInput, mode: "username" } });
      if (!res.ok) { setAuthError(res.error); return; }
      setOtpStep("code");
      setOtpInfo(`Code sent to @${res.username} via @${TG_BOT}. It expires in 2 minutes.`);
    } finally {
      setOtpSending(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otpCode.length !== 4 || otpVerifying) return;
    setAuthError(null);
    setOtpVerifying(true);
    try {
      const res = await verOtpFn({
        data: { identifier: usernameInput, code: otpCode, mode: "username" },
      });
      if (!res.ok) { setAuthError(res.error); return; }
      persist({
        id: res.sessionId,
        username: res.username,
        verified: true,
        isAdmin: res.isAdmin,
        isTrainer: res.isTrainer,
      });
      setMessages([{
        role: "assistant",
        content: `Welcome back, **@${res.username}**! ✨\n\nI'm **${BOT_NAME}** — your AI crypto + forex expert for **GTech Network (GTC)**.\n\nTry:\n• "what's the bitcoin price right now?" (I'll check the live market)\n• "show my balance"\n• "verify TXN 0x..."\n• Tap 📷 to attach a screenshot · 🎫 to raise a ticket.`,
        t: Date.now(),
      }]);
    } finally {
      setOtpVerifying(false);
    }
  }

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_PHOTO_BYTES) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Photo too large. Please attach an image under 4 MB.", t: Date.now() },
      ]);
      return;
    }
    setPendingPhoto(f);
    setPendingPhotoUrl(URL.createObjectURL(f));
  }

  async function sendPhotoMessage() {
    if (!session || !pendingPhoto || sending) return;
    setSending(true);
    try {
      const dataUrl = await fileToDataUrl(pendingPhoto);
      const caption = input.trim();
      const localPreview = pendingPhotoUrl ?? undefined;
      setMessages((m) => [
        ...m,
        {
          role: "user",
          content: caption || "📷 (photo attached)",
          t: Date.now(),
          photoUrl: localPreview,
        },
      ]);
      setInput("");
      setPendingPhoto(null);
      setPendingPhotoUrl(null);

      const r = await photoFn({
        data: { sessionId: session.id, imageBase64: dataUrl, caption },
      });
      if (!r.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `⚠️ ${r.error}`, t: Date.now() },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: r.reply, t: Date.now() },
        ]);
        void saveFn({
          data: { sessionId: session.id, role: "user", content: `[photo] ${caption}` },
        });
        void saveFn({
          data: { sessionId: session.id, role: "assistant", content: r.reply },
        });
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Could not send photo. Please try again.", t: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (!session) return;
    if (pendingPhoto) return sendPhotoMessage();
    if (!input.trim()) return;
    if (input.trim().length > 4000) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Message too long. Please keep it under 4000 characters.", t: Date.now() },
      ]);
      return;
    }
    const userMsg: Msg = { role: "user", content: input.trim(), t: Date.now() };
    // Snapshot the conversation that will be sent BEFORE clearing input,
    // so concurrent sends don't race on a moving `messages` array.
    const convoForApi = [...messages, userMsg]
      .slice(-30)
      .map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setPendingChats((n) => n + 1);
    void saveFn({ data: { sessionId: session.id, role: "user", content: userMsg.content } });

    // Silent retry loop: if every AI worker is busy, the server returns
    // { retry: true } instead of an error. We keep the typing bubble up
    // and re-poll until we get a real reply (or a hard error). The user
    // can keep typing & sending more messages in the meantime — each one
    // gets its own pending counter slot.
    let attemptDelay = 0;
    let hardError = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (attemptDelay > 0) {
          await new Promise((res) => setTimeout(res, attemptDelay));
        }
        let r: Response;
        try {
          r = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: session.id, messages: convoForApi }),
          });
        } catch {
          // Network blip — back off and try again silently. Don't surface
          // anything to the user; the thinking bubble stays.
          attemptDelay = 5000;
          continue;
        }
        const data = await r.json().catch(() => ({} as any));
        if (data?.quota) setQuota(data.quota);

        if (!r.ok) {
          if (data?.limit_reached) {
            setMessages((m) => [
              ...m,
              { role: "assistant", content: data.error, t: Date.now() },
            ]);
            setShowSubscribe(true);
          } else {
            setMessages((m) => [
              ...m,
              { role: "assistant", content: `⚠️ ${data.error ?? "Error"}`, t: Date.now() },
            ]);
          }
          hardError = true;
          break;
        }

        if (data?.retry) {
          // All workers busy — wait the server-suggested cool-off and
          // try again WITHOUT telling the user. Bubble stays visible.
          attemptDelay = Math.max(1500, Number(data.retry_after_ms) || 4000);
          continue;
        }

        const reply = ((data.reply as string) ?? "").trim();
        const shown = reply || "⚠️ Empty response. Please try again.";
        setMessages((m) => [...m, { role: "assistant", content: shown, t: Date.now() }]);
        if (reply) {
          void saveFn({ data: { sessionId: session.id, role: "assistant", content: reply } });
        }
        if (/withdrawal (confirmed|successful|processed)/i.test(reply)) {
          setShowBurst(true);
          setTimeout(() => setShowBurst(false), 2200);
        }
        break;
      }
    } finally {
      setPendingChats((n) => Math.max(0, n - 1));
      // `sending` is preserved only for the photo flow; we never block on it here.
      if (hardError) void 0;
    }
  }


  // --- Login screen ---
  if (!session) {
    return (
      <main className="min-h-[100dvh] grid place-items-center px-4 py-10">
        <div className="w-full max-w-md glass rounded-3xl p-7 shadow-2xl">
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <CoinImg size="w-28 h-28" />
            <h1 className="text-2xl font-black blue-text">GTech AI</h1>
            <p className="text-sm text-muted-foreground">
              AI crypto + forex expert for GTC holders. Verify with @{TG_BOT} to unlock your account.
            </p>
          </div>

          {otpStep === "username" && (
            <form onSubmit={sendOtp} className="space-y-3">
              <div className="flex gap-2">
                <span className="grid place-items-center px-3 rounded-md bg-secondary text-secondary-foreground text-sm font-bold">
                  @
                </span>
                <input
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="your_telegram_username"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  className="flex-1 h-11 rounded-md bg-input border border-border px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <a
                href={`https://t.me/${TG_BOT}`}
                target="_blank" rel="noreferrer"
                className="block text-center text-xs text-primary hover:underline"
              >
                Step 1 → Open @{TG_BOT} and press Start
              </a>
              <button
                type="submit"
                disabled={otpSending || !usernameInput.trim()}
                className="w-full h-12 rounded-xl font-bold text-primary-foreground shadow-lg transition-transform active:scale-[.98] disabled:opacity-60"
                style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
              >
                {otpSending ? "Sending OTP…" : "Send 4-digit OTP on Telegram"}
              </button>
            </form>
          )}

          {otpStep === "code" && (
            <form onSubmit={submitOtp} className="space-y-4">
              <div className="text-xs text-muted-foreground text-center">{otpInfo}</div>
              <div className="flex justify-center gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <input
                    key={i}
                    inputMode="numeric"
                    maxLength={1}
                    value={otpCode[i] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      const next = (otpCode.substring(0, i) + v + otpCode.substring(i + 1)).slice(0, 4);
                      setOtpCode(next);
                      if (v && i < 3) {
                        const el = (e.target.parentElement?.children[i + 1] as HTMLInputElement);
                        el?.focus();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !otpCode[i] && i > 0) {
                        const el = (e.currentTarget.parentElement?.children[i - 1] as HTMLInputElement);
                        el?.focus();
                      }
                    }}
                    className="w-14 h-16 text-center text-2xl font-black rounded-xl bg-input border-2 border-border focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={otpCode.length !== 4 || otpVerifying}
                className="w-full h-12 rounded-xl font-bold text-primary-foreground shadow-lg transition-transform active:scale-[.98] disabled:opacity-60"
                style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
              >
                {otpVerifying ? "Verifying…" : "Verify & Enter Chat"}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => { setOtpStep("username"); setOtpCode(""); setOtpInfo(null); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ← Change username
                </button>
                <button
                  type="button"
                  onClick={(e) => sendOtp(e as unknown as React.FormEvent)}
                  disabled={otpSending}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}

          {authError && (
            <p className="mt-4 text-sm text-destructive text-center">{authError}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] flex flex-col">
      {showBurst && <CoinBurst />}

      <header className="tg-header sticky top-0 z-30 px-3 py-2.5 flex items-center gap-2 shadow-md"
        style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}>
        <CoinImg />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base text-white leading-tight truncate">{BOT_NAME}</div>
          <div className="text-[11px] text-white/80 truncate flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            online · @{session.username}
          </div>
        </div>
        {session.isTrainer && (
          <Link to="/training"
            className="text-[11px] px-2.5 py-1.5 rounded-md bg-white/15 text-white hover:bg-white/25">
            Training
          </Link>
        )}
        {session.isTrainer && (
          <Link to="/developer"
            className="text-[11px] px-2.5 py-1.5 rounded-md bg-white/15 text-white hover:bg-white/25">
            Dev
          </Link>
        )}

        {session.isAdmin && (
          <Link
            to="/admin"
            className="text-[11px] px-2.5 py-1.5 rounded-md bg-white/15 text-white hover:bg-white/25"
          >
            Admin
          </Link>
        )}
        <button
          onClick={() => { persist(null); setMessages([]); }}
          className="text-[11px] px-2.5 py-1.5 rounded-md bg-white/15 text-white hover:bg-white/25"
        >
          Sign out
        </button>
      </header>

      <div className="flex border-b border-border bg-background/95 backdrop-blur sticky z-20"
        style={{ top: "calc(56px + env(safe-area-inset-top))" }}>
        {(["home", "chat", "queries"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-bold transition-colors ${
              tab === t
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "home" ? "Home" : t === "chat" ? "Chat" : "My Queries"}
          </button>
        ))}
      </div>

      {tab === "home" && (
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="max-w-lg mx-auto space-y-6">
            {/* Greeting */}
            <div>
              <h1 className="text-2xl font-light text-foreground/90 leading-tight">
                {(() => {
                  const h = new Date().getHours();
                  return h < 12 ? "Good morning," : h < 18 ? "Good afternoon," : "Good evening,";
                })()}
              </h1>
              <h2 className="text-xl sm:text-2xl font-black gold-text leading-tight break-words">
                {session.username}!
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Ask me anything about GTC.
              </p>
            </div>

            {/* Ask input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!input.trim()) { setTab("chat"); return; }
                setTab("chat");
                setTimeout(() => send(), 50);
              }}
              className="relative"
            >
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-primary">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask me anything..."
                className="w-full h-14 rounded-full bg-input/60 border border-primary/30 pl-12 pr-16 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full grid place-items-center shadow-lg active:scale-95 transition-transform"
                style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
                aria-label="Send"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8L20 10l-5.5 3.3L16 20l-4-3.5L8 20l1.5-6.7L4 10l6.1-1.2z"/></svg>
              </button>
            </form>

            {/* Quick Actions */}
            <section>
              <h3 className="text-lg font-black mb-3">Quick Actions</h3>
              <div className="grid grid-cols-3 gap-3">
                {/* Photo Upload */}
                <label className="glass rounded-2xl p-3 flex flex-col items-center text-center gap-2 cursor-pointer active:scale-95 transition-transform">
                  <img src={qaPhoto} alt="" className="w-16 h-16 object-contain" draggable={false} />
                  <div className="w-full flex items-center justify-between gap-1">
                    <div className="text-left leading-tight">
                      <div className="text-sm font-black">Photo</div>
                      <div className="text-[10px] text-muted-foreground">Upload</div>
                    </div>
                    <span className="text-primary text-lg">›</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      pickPhoto(e);
                      setTab("chat");
                    }}
                    className="hidden"
                  />
                </label>

                {/* Form Fill — opens ticket modal */}
                <button
                  type="button"
                  onClick={() => setShowTicket(true)}
                  className="glass rounded-2xl p-3 flex flex-col items-center text-center gap-2 active:scale-95 transition-transform"
                >
                  <img src={qaForm} alt="" className="w-16 h-16 object-contain" draggable={false} />
                  <div className="w-full flex items-center justify-between gap-1">
                    <div className="text-left leading-tight">
                      <div className="text-sm font-black">Form</div>
                      <div className="text-[10px] text-muted-foreground">Fill</div>
                    </div>
                    <span className="text-primary text-lg">›</span>
                  </div>
                </button>

                {/* Send Chat */}
                <button
                  type="button"
                  onClick={() => setTab("chat")}
                  className="glass rounded-2xl p-3 flex flex-col items-center text-center gap-2 active:scale-95 transition-transform"
                >
                  <img src={qaSend} alt="" className="w-16 h-16 object-contain" draggable={false} />
                  <div className="w-full flex items-center justify-between gap-1">
                    <div className="text-left leading-tight">
                      <div className="text-sm font-black">Send</div>
                      <div className="text-[10px] blue-text font-bold">Chat</div>
                    </div>
                    <span className="text-primary text-lg">›</span>
                  </div>
                </button>
              </div>
            </section>

            {/* Raised Queries preview */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-black">Raised Queries</h3>
                <button
                  onClick={() => setTab("queries")}
                  className="text-sm font-bold blue-text flex items-center gap-1"
                >
                  View all <span>›</span>
                </button>
              </div>

              {queriesLoading && myQueries.length === 0 ? (
                <div className="text-center text-muted-foreground text-xs py-6">Loading…</div>
              ) : myQueries.length === 0 ? (
                <div className="glass rounded-xl p-6 text-center text-muted-foreground text-xs">
                  No queries yet. Tap <b>Form</b> above to raise one.
                </div>
              ) : (
                <div className="space-y-3">
                  {myQueries.slice(0, 4).map((q) => {
                    const when = (() => {
                      const d = new Date(q.created_at);
                      const now = new Date();
                      const sameDay = d.toDateString() === now.toDateString();
                      const diffDays = Math.floor(
                        (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
                      );
                      if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                      if (diffDays === 1) return "Yesterday";
                      if (diffDays < 7) return `${diffDays} days ago`;
                      return d.toLocaleDateString();
                    })();
                    return (
                      <button
                        key={q.id}
                        onClick={() => setTab("queries")}
                        className="w-full glass rounded-xl p-3 flex items-center gap-3 text-left active:scale-[.98] transition-transform"
                      >
                        <div className="w-11 h-11 rounded-full grid place-items-center shrink-0 bg-primary/15 border border-primary/30">
                          <img src={qaForm} alt="" className="w-7 h-7 object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm truncate">{q.subject || "Query"}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {q.message}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground shrink-0 flex flex-col items-end gap-1">
                          <span>{when}</span>
                          <span className="text-primary text-base leading-none">›</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === "chat" && (
        <>
          <div
            ref={scrollRef}
            className="tg-chat-bg flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3 w-full"
          >
            <div className="max-w-3xl mx-auto space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">
                  <div className="mx-auto mb-3"><CoinImg size="w-16 h-16 mx-auto" /></div>
                  <p className="font-bold text-base mb-1">Hi @{session.username}! 👋</p>
                  <p>Ask me anything about GTC, mining, presale, or your account.</p>
                  <p className="mt-1 text-xs">Tap 📷 to attach a screenshot · Tap 🎫 to raise a ticket.</p>
                </div>
              )}
              {messages.map((m, i) => (
                <MessageBubble key={i} m={m} />
              ))}
              {sending && (
                <div className="flex items-end gap-2 animate-slide-in">
                  <CoinImg />
                  <div className="bubble-in rounded-2xl rounded-bl-sm shadow"><TypingDots /></div>
                </div>
              )}
            </div>
          </div>

          <div className="glass border-t border-border">
            <QuotaBar quota={quota} onSubscribe={() => setShowSubscribe(true)} />
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="glass sticky bottom-0 px-3 sm:px-5 py-3 border-t border-border"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >

            <div className="max-w-3xl mx-auto">
              {pendingPhotoUrl && (
                <div className="mb-2 flex items-center gap-2 p-2 rounded-xl bg-secondary/60 border border-border">
                  <img src={pendingPhotoUrl} alt="preview" className="h-12 w-12 rounded-md object-cover" />
                  <div className="flex-1 text-xs">
                    <div className="font-bold">Photo ready</div>
                    <div className="text-muted-foreground truncate">
                      Add a short note (optional) and press Send to forward to admin.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPendingPhoto(null); setPendingPhotoUrl(null); }}
                    className="w-6 h-6 rounded-full bg-destructive text-white text-xs font-bold"
                  >×</button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <label className="h-12 w-12 grid place-items-center rounded-2xl bg-[#ece9ff] border border-[#d9d2ff] shadow-sm cursor-pointer shrink-0 active:scale-95 transition-transform overflow-hidden"
                  aria-label="Attach photo from gallery" title="Attach photo">
                  <img src={iconPhoto} alt="" className="w-9 h-9 object-contain" draggable={false} />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={pickPhoto}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setShowTicket(true)}
                  className="h-12 w-12 grid place-items-center rounded-2xl bg-[#fff3db] border border-[#ffe3a8] shadow-sm shrink-0 active:scale-95 transition-transform overflow-hidden"
                  aria-label="Raise a ticket to admin"
                  title="Raise a ticket"
                >
                  <img src={iconTicket} alt="" className="w-9 h-9 object-contain" draggable={false} />
                </button>
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder={
                      pendingPhoto
                        ? "Describe the issue (optional)…"
                        : "Ask about GTC, mining, presale, or your account…"
                    }
                    className="w-full resize-none max-h-32 min-h-[48px] rounded-2xl bg-input border border-border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <button
                  type="submit"
                  disabled={sending || (!pendingPhoto && !input.trim())}
                  className="h-12 w-12 grid place-items-center rounded-2xl bg-[#e4f9e6] border border-[#bff0c5] shadow-sm disabled:opacity-50 transition-transform active:scale-[.95] shrink-0 overflow-hidden"
                  aria-label="Send"
                  title="Send"
                >
                  <img src={iconSend} alt="Send" className="w-9 h-9 object-contain" draggable={false} />
                </button>
              </div>
            </div>
          </form>
        </>
      )}

      {tab === "queries" && (
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-black blue-text">My Queries</h2>
                <p className="text-[11px] text-muted-foreground">
                  Track admin replies to queries the bot forwarded for you.
                </p>
              </div>
              <button
                onClick={loadMyQueries}
                disabled={queriesLoading}
                className="text-xs px-3 py-1.5 rounded-lg bg-secondary text-foreground"
              >
                {queriesLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {/* Subscription history */}
            <section className="space-y-2 mb-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black">Subscription history</h3>
                <button
                  onClick={() => setShowSubscribe(true)}
                  className="text-[11px] px-2.5 py-1 rounded bg-primary/15 text-primary font-bold"
                >+ New subscription</button>
              </div>
              {mySubs.length === 0 ? (
                <div className="glass rounded-xl p-3 text-[11px] text-muted-foreground">
                  No subscriptions yet. Tap “+ New subscription” to buy more messages.
                </div>
              ) : (
                <div className="space-y-2">
                  {mySubs.map((sub) => (
                    <div key={sub.id} className="glass rounded-xl p-3 border border-border">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold">
                          {sub.plan_gtc.toLocaleString()} GTC → +{sub.plan_messages} msg
                        </div>
                        <span className={`text-[10px] font-black px-2 py-1 rounded-full ${
                          sub.status === "pending" ? "bg-amber-500/15 text-amber-600" :
                          sub.status === "approved" ? "bg-emerald-500/15 text-emerald-600" :
                          "bg-destructive/15 text-destructive"
                        }`}>{sub.status.toUpperCase()}</span>
                      </div>
                      <div className="text-[10px] font-mono break-all text-muted-foreground mt-1">
                        TXN: {sub.txn_hash}
                      </div>
                      {sub.reject_reason && (
                        <div className="mt-2 text-[11px] text-destructive">
                          Rejected: {sub.reject_reason}
                        </div>
                      )}
                      <div className="text-[10px] text-muted-foreground/70 mt-1">
                        {new Date(sub.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>


            {myQueries.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-12">
                <div className="text-3xl mb-3">📋</div>
                <p>No queries yet.</p>
                <p className="text-xs mt-1">
                  Ask the bot to "contact admin" or attach a photo in chat — your queries appear here.
                </p>
              </div>
            ) : (
                <div className="space-y-5">
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black text-foreground">Answered Queries</h3>
                      <span className="text-[11px] text-muted-foreground">{myQueries.filter((q) => q.status === "answered").length}</span>
                    </div>
                    {myQueries.filter((q) => q.status === "answered").length === 0 ? (
                      <div className="glass rounded-xl p-4 text-xs text-muted-foreground">No answered queries yet.</div>
                    ) : myQueries.filter((q) => q.status === "answered").map((q) => (
                      <div key={q.id} className="glass rounded-xl p-4 border border-border">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm truncate">{q.subject || "Query"}</div>
                            <code className="text-[10px] font-mono text-primary">GT-{q.id.slice(0, 8).toUpperCase()}</code>
                          </div>
                          <span className="shrink-0 text-[10px] font-black px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-600">✅ Answered</span>
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{q.message}</p>
                        {q.photo_url && (
                          <SecureImage url={q.photo_url} alt="attached" className="rounded-lg max-h-44 object-cover border border-border" />
                        )}
                        {q.admin_reply && (
                          <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                            <div className="text-[10px] font-bold text-primary mb-1">Admin reply{q.replied_by ? ` · @${q.replied_by}` : ""}</div>
                            <p className="text-sm whitespace-pre-wrap">{q.admin_reply}</p>
                            {q.reply_photo_url && (
                              <SecureImage url={q.reply_photo_url} alt="admin attachment" className="rounded-lg max-h-44 object-cover border border-border" />
                            )}
                          </div>
                        )}
                        <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="text-[11px] font-bold">Reply again / Reopen</div>
                          <textarea
                            value={queryReplyDrafts[q.id]?.text ?? ""}
                            onChange={(e) => setQueryReplyDrafts((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] ?? { text: "" }), text: e.target.value } }))}
                            rows={3}
                            placeholder="Tell admin what is still pending or what changed..."
                            className="w-full rounded-xl bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                          />
                          {queryReplyDrafts[q.id]?.photoUrl ? (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-background border border-border">
                              <img src={queryReplyDrafts[q.id]?.photoUrl ?? ""} alt="preview" className="h-12 w-12 rounded object-cover" />
                              <div className="flex-1 text-[11px] text-muted-foreground truncate">{queryReplyDrafts[q.id]?.photo?.name}</div>
                              <button type="button" onClick={() => clearQueryReplyPhoto(q.id)} className="w-6 h-6 rounded-full bg-destructive text-white text-xs font-bold">×</button>
                            </div>
                          ) : (
                            <label className="inline-flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-md bg-secondary cursor-pointer hover:bg-secondary/80">
                              📎 Attach photo
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => pickQueryReplyPhoto(q.id, e)} />
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() => reopenQuery(q.id)}
                            disabled={queryReplyDrafts[q.id]?.busy || !(queryReplyDrafts[q.id]?.text ?? "").trim()}
                            className="w-full h-10 rounded-xl font-bold text-primary-foreground disabled:opacity-50"
                            style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
                          >
                            {queryReplyDrafts[q.id]?.busy ? "Sending…" : "Reopen this query"}
                          </button>
                        </div>
                        <div className="mt-2 text-[10px] text-muted-foreground/60">{new Date(q.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black text-foreground">Pending Queries</h3>
                      <span className="text-[11px] text-muted-foreground">{myQueries.filter((q) => q.status !== "answered").length}</span>
                    </div>
                    {myQueries.filter((q) => q.status !== "answered").length === 0 ? (
                      <div className="glass rounded-xl p-4 text-xs text-muted-foreground">No pending queries right now.</div>
                    ) : myQueries.filter((q) => q.status !== "answered").map((q) => (
                  <div key={q.id} className="glass rounded-xl p-4 border border-border">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{q.subject || "Query"}</div>
                        <code className="text-[10px] font-mono text-primary">
                          GT-{q.id.slice(0, 8).toUpperCase()}
                        </code>
                      </div>
                      <span className="shrink-0 text-[10px] font-black px-2 py-1 rounded-full bg-amber-500/15 text-amber-600">⏳ Pending</span>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{q.message}</p>
                    {q.photo_url && (
                      <SecureImage
                        url={q.photo_url}
                        alt="attached"
                        className="rounded-lg max-h-44 object-cover border border-border"
                      />
                    )}
                    <div className="mt-2 text-[10px] text-muted-foreground/60">
                      {new Date(q.created_at).toLocaleString()}
                    </div>
                  </div>
                    ))}
                  </section>
              </div>
            )}
          </div>
        </div>
      )}

      {showSubscribe && session && (
        <SubscriptionDialog
          sessionId={session.id}
          onClose={() => setShowSubscribe(false)}
          onSubmitted={() => { refreshSubs(); refreshQuota(); }}
        />
      )}
      {showTicket && (

        <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 backdrop-blur-sm px-3 py-3 sm:p-6"
          onClick={() => !ticketSending && closeTicket()}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitTicket}
            className="w-full max-w-md glass rounded-2xl p-5 shadow-2xl border border-border"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between mb-3 gap-3">
              <div className="flex items-center gap-2">
                <img src={iconTicket} alt="" className="w-9 h-9 object-contain" />
                <div>
                  <h3 className="text-lg font-black blue-text">Raise a Query</h3>
                  <p className="text-[11px] text-muted-foreground">
                    AI verifies your request, then forwards it to admins. Max 4 per day.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeTicket}
                disabled={ticketSending}
                className="w-7 h-7 rounded-full bg-secondary text-foreground/70 text-sm shrink-0"
              >×</button>
            </div>

            {ticketDone ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">✅</div>
                <p className="font-bold">Query sent to admins</p>
                {ticketResultId && (
                  <div className="mt-3 inline-flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-secondary/70 border border-border">
                    <span className="text-[10px] text-muted-foreground font-bold">Your Query ID</span>
                    <code className="font-mono text-base font-black blue-text">{ticketResultId}</code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(ticketResultId)}
                      className="text-[10px] text-primary hover:underline"
                    >Copy ID</button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  Track replies in <b>My Queries</b>. Share this ID with admin if needed.
                </p>
                <button
                  type="button"
                  onClick={closeTicket}
                  className="mt-4 px-4 py-2 rounded-lg bg-secondary text-sm font-bold"
                >Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Subject</label>
                  <input
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="e.g. Withdrawal stuck pending"
                    maxLength={200}
                    className="mt-1 w-full h-11 rounded-xl bg-input border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">
                    Describe your issue
                  </label>
                  <textarea
                    value={ticketDetails}
                    onChange={(e) => setTicketDetails(e.target.value)}
                    rows={5}
                    maxLength={4000}
                    placeholder="What happened? Include amounts, TXN hashes, times — anything that helps the admin."
                    className="mt-1 w-full rounded-xl bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                  <div className="text-[10px] text-muted-foreground/60 text-right">
                    {ticketDetails.length}/4000
                  </div>
                </div>

                {/* Photo attachment */}
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">
                    Attach photo (optional)
                  </label>
                  {ticketPhotoUrl ? (
                    <div className="mt-1 flex items-center gap-2 p-2 rounded-xl bg-secondary/60 border border-border">
                      <img src={ticketPhotoUrl} alt="preview" className="h-14 w-14 rounded-md object-cover" />
                      <div className="flex-1 text-xs">
                        <div className="font-bold">Photo attached</div>
                        <div className="text-muted-foreground truncate">{ticketPhoto?.name}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setTicketPhoto(null); setTicketPhotoUrl(null); }}
                        className="w-7 h-7 rounded-full bg-destructive text-white text-xs font-bold"
                      >×</button>
                    </div>
                  ) : (
                    <label className="mt-1 flex items-center gap-3 p-3 rounded-xl bg-secondary/40 border border-dashed border-border cursor-pointer hover:bg-secondary/70 transition-colors">
                      <img src={iconPhoto} alt="" className="w-10 h-10 object-contain" />
                      <div className="flex-1 text-xs">
                        <div className="font-bold">Tap to attach photo from gallery</div>
                        <div className="text-muted-foreground">PNG/JPG · max 4 MB</div>
                      </div>
                      <input type="file" accept="image/*" onChange={pickTicketPhoto} className="hidden" />
                    </label>
                  )}
                </div>

                {ticketError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {ticketError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    ticketSending ||
                    !ticketSubject.trim() ||
                    ticketDetails.trim().length < 5
                  }
                  className="w-full h-12 rounded-xl font-bold text-primary-foreground shadow-lg transition-transform active:scale-[.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
                >
                  {ticketSending ? (
                    "AI verifying & sending…"
                  ) : (
                    <>
                      <img src={iconSend} alt="" className="w-6 h-6 object-contain" />
                      Submit to admin
                    </>
                  )}
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </main>
  );
}

function MessageBubble({ m }: { m: Msg }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex items-end gap-2 animate-slide-in ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && <CoinImg />}
      <div className={`max-w-[78%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && (
          <span className="text-[10px] gold-text font-bold mb-0.5 ml-1">{BOT_NAME}</span>
        )}
        <div
          className={`px-4 py-2.5 text-sm leading-relaxed shadow ${
            isUser
              ? "rounded-2xl rounded-br-sm text-primary-foreground"
              : "rounded-2xl rounded-bl-sm bubble-in"
          }`}
          style={isUser ? { background: "var(--gradient-blue)" } : undefined}
        >
          {m.photoUrl && (
            <img
              src={m.photoUrl}
              alt="attached"
              className="mb-2 rounded-lg max-h-56 object-cover"
            />
          )}
          <Markdown text={m.content} />
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {new Date(m.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

function TradingViewWidget({ symbol }: { symbol: string }) {
  const safeSymbol = symbol.replace(/[^A-Z0-9:_\-]/gi, "");
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>html,body{margin:0;padding:0;background:#131722;}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js" async>${JSON.stringify(
    { symbol: safeSymbol, width: "100%", colorTheme: "dark", isTransparent: false, locale: "en" },
  )}<\/script></div></body></html>`;
  return (
    <iframe
      title={`TradingView ${safeSymbol}`}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin allow-popups"
      className="my-2 w-full rounded-lg border border-border"
      style={{ height: 132, background: "#131722" }}
    />
  );
}

function Markdown({ text }: { text: string }) {
  // Split on TradingView marker first so the widget renders inline.
  const tvSplit = text.split(/(\[\[TV:[A-Za-z0-9:_\-]+\]\])/g);
  return (
    <>
      {tvSplit.map((chunk, ti) => {
        const tv = chunk.match(/^\[\[TV:([A-Za-z0-9:_\-]+)\]\]$/);
        if (tv) return <TradingViewWidget key={`tv-${ti}`} symbol={tv[1]} />;
        const parts = chunk.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
        return (
          <span key={`t-${ti}`}>
            {parts.map((p, i) => {
              if (p === "\n") return <br key={i} />;
              if (p.startsWith("**") && p.endsWith("**"))
                return <strong key={i} className="font-bold">{p.slice(2, -2)}</strong>;
              if (p.startsWith("`") && p.endsWith("`"))
                return <code key={i} className="px-1 py-0.5 rounded bg-secondary text-xs">{p.slice(1, -1)}</code>;
              return <span key={i}>{p}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}
