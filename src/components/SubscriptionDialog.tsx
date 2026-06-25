import { useEffect, useState } from "react";
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

  useEffect(() => {
    addrFn().then((r) => r?.address && setAddress(r.address));
  }, []);

  async function submit() {
    if (!plan || !txn.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitFn({
        data: { sessionId, planGtc: plan.gtc, txnHash: txn.trim() },
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
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 backdrop-blur-sm px-3 py-3 sm:p-6"
      onClick={() => !busy && onClose()}
    >
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
          <div className="text-center py-6 space-y-2">
            <div className="text-4xl">✅</div>
            <p className="font-bold">Request submitted</p>
            <p className="text-xs text-muted-foreground">
              Admin will verify your TXN against the GTC deposit ledger. Once approved,
              your messages will be credited automatically. Track status in <b>My Queries</b>.
            </p>
            <button
              onClick={onClose}
              className="mt-3 px-4 py-2 rounded-lg bg-secondary text-sm font-bold"
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
                {plan.gtc.toLocaleString()} GTC
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
                onChange={(e) => setTxn(e.target.value)}
                placeholder="0x…"
                autoCapitalize="none"
                className="mt-1 w-full h-11 rounded-xl bg-input border border-border px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {err && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {err}
              </div>
            )}

            <button
              onClick={submit}
              disabled={busy || !txn.trim()}
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
