import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  PLANS,
  submitSubscription,
  getDepositAddress,
} from "@/lib/subscription.functions";

interface Props {
  sessionId: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function SubscriptionDialog({ sessionId, onClose, onSubmitted }: Props) {
  const submitFn = useServerFn(submitSubscription);
  const addrFn = useServerFn(getDepositAddress);
  const [address, setAddress] = useState("0xe724D2800Cf0Af62aB7f3e08f2f6AD32900c1491");
  const [plan, setPlan] = useState<(typeof PLANS)[number] | null>(null);
  const [txn, setTxn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const normalizedTxn = useMemo(() => txn.trim().toLowerCase(), [txn]);

  useEffect(() => {
    addrFn().then((r) => r?.address && setAddress(r.address));
  }, []);

  const totalToSend = useMemo(() => (plan ? plan.gtc : 0), [plan]);

  async function submit() {
    if (!plan || !normalizedTxn || busy || done) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitFn({
        data: {
          sessionId,
          planGtc: plan.gtc,
          txnHash: txn.trim(),
        },
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setDone(true);
      onSubmitted?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 backdrop-blur-sm px-3 py-3 sm:p-6 overflow-y-auto"
      onClick={() => !busy && onClose()}
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <style>{`
        @keyframes sub-pop { 0%{transform:scale(.3);opacity:0} 60%{transform:scale(1.15);opacity:1} 100%{transform:scale(1)} }
        @keyframes sub-ring { 0%{transform:scale(.4);opacity:.9} 100%{transform:scale(2.4);opacity:0} }
        @keyframes sub-stroke { from{stroke-dashoffset:60} to{stroke-dashoffset:0} }
        @keyframes sub-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes sub-spark { 0%{transform:scale(0) rotate(0);opacity:0} 50%{transform:scale(1) rotate(180deg);opacity:1} 100%{transform:scale(0) rotate(360deg);opacity:0} }
        .sub-success-circle { animation: sub-pop .6s cubic-bezier(.22,1.4,.36,1) both; }
        .sub-success-ring { animation: sub-ring 1.1s ease-out .15s both; }
        .sub-success-check { stroke-dasharray:60; stroke-dashoffset:60; animation: sub-stroke .55s ease-out .35s forwards; }
        .sub-success-float { animation: sub-float 2.6s ease-in-out infinite; }
        .sub-spark { animation: sub-spark 1.4s ease-out infinite; }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md glass rounded-2xl p-5 shadow-2xl border border-border space-y-4"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black blue-text">Subscribe with GTC</h3>
            <p className="text-[11px] text-muted-foreground">
              Buy more chat messages for today. Credits do <b>not</b> roll over.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="w-7 h-7 rounded-full bg-secondary text-foreground/70 text-sm shrink-0"
          >
            ×
          </button>
        </div>

        {done ? (
          <div className="text-center py-6 space-y-3">
            <div className="relative mx-auto w-24 h-24 sub-success-float">
              <span className="absolute inset-0 rounded-full sub-success-ring"
                style={{ background: "radial-gradient(circle, rgba(99,102,241,.45), transparent 70%)" }} />
              <div className="relative w-24 h-24 rounded-full sub-success-circle grid place-items-center"
                style={{ background: "var(--gradient-blue, linear-gradient(135deg,#7c3aed,#3b82f6))", boxShadow: "0 14px 40px -8px rgba(99,102,241,.6)" }}>
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
                  <path className="sub-success-check"
                    d="M14 29 L24 39 L43 18"
                    stroke="white" strokeWidth="5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="sub-spark absolute -top-1 -right-2 text-yellow-300 text-xl">✦</span>
              <span className="sub-spark absolute -bottom-1 -left-2 text-pink-300 text-lg" style={{ animationDelay: ".4s" }}>✦</span>
              <span className="sub-spark absolute top-1 -left-3 text-blue-200 text-sm" style={{ animationDelay: ".8s" }}>✦</span>
            </div>
            <p className="font-black text-base">Request submitted</p>
            <p className="text-xs text-muted-foreground px-2">
              Admin will verify your TXN against the GTC deposit ledger. Once approved, your messages will be credited automatically. Track status in <b>My Queries</b>.
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-5 py-2 rounded-lg font-bold text-primary-foreground"
              style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
            >
              Done
            </button>
          </div>
        ) : !plan ? (
          <div className="space-y-2">
            {PLANS.map((p) => (
              <button
                key={p.gtc}
                onClick={() => setPlan(p)}
                className="w-full text-left p-4 rounded-xl border border-border bg-secondary/40 hover:bg-secondary transition flex items-center justify-between"
              >
                <div>
                  <div className="text-base font-black">
                    {p.gtc.toLocaleString()} GTC
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    +{p.messages} messages (today only)
                  </div>
                </div>
                <span className="blue-text text-xl">›</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => setPlan(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              ← Change plan
            </button>
            <div className="rounded-xl border border-border bg-secondary/40 p-3 text-center space-y-2">
              <div className="text-[10px] font-bold text-muted-foreground uppercase">
                Send exactly
              </div>
              <div className="text-2xl font-black blue-text">
                {totalToSend.toLocaleString()} GTC
              </div>
              <div className="text-[10px] text-muted-foreground">
                Plan amount — no network fee
              </div>
              <div className="text-[10px] text-muted-foreground">
                You'll receive <b>+{plan.messages}</b> messages
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <div className="text-[10px] font-bold text-muted-foreground uppercase">
                Deposit address (BNB Smart Chain)
              </div>
              <div className="font-mono text-xs break-all p-2 rounded bg-secondary/60 border border-border">
                {address}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(address)}
                className="text-[11px] text-primary hover:underline"
              >
                Copy address
              </button>
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground">
                Transaction hash
              </label>
              <input
                value={txn}
                onChange={(e) => {
                  setTxn(e.target.value);
                  if (err) setErr(null);
                }}
                placeholder="0x…"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full h-11 rounded-xl bg-input border border-border px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                The database checks this TXN before saving. If it already exists, the request will not be submitted.
              </p>
            </div>

            {err && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {err}
              </div>
            )}

            <button
              onClick={submit}
              disabled={busy || done || !normalizedTxn}
              className="w-full h-12 rounded-xl font-bold text-primary-foreground shadow-lg disabled:opacity-50"
              style={{ background: "var(--gradient-blue)", boxShadow: "var(--shadow-blue)" }}
            >
              {busy ? "Submitting…" : "I have paid — Submit for review"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
