import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListSubscriptions,
  adminApproveSubscription,
  adminRejectSubscription,
} from "@/lib/subscription.functions";
import { Button } from "@/components/ui/button";

interface SubRow {
  id: string;
  telegram_username: string;
  telegram_user_id: number | null;
  plan_gtc: number;
  plan_messages: number;
  txn_hash: string;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  deposit_match: Record<string, unknown> | null;
}

export function SubscriptionsUI({ sessionId }: { sessionId: string }) {
  const listFn = useServerFn(adminListSubscriptions);
  const approveFn = useServerFn(adminApproveSubscription);
  const rejectFn = useServerFn(adminRejectSubscription);
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<SubRow | null>(null);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await listFn({ data: { sessionId } });
      if (r.ok) setRows(r.rows as unknown as SubRow[]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const r = await approveFn({ data: { sessionId, id } });
      if (r.ok) load();
      else alert(r.error);
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejectFor || reason.trim().length < 2) return;
    setBusyId(rejectFor.id);
    try {
      const r = await rejectFn({
        data: { sessionId, id: rejectFor.id, reason: reason.trim() },
      });
      if (r.ok) {
        setRejectFor(null);
        setReason("");
        load();
      } else alert(r.error);
    } finally {
      setBusyId(null);
    }
  }

  const counts = {
    pending: rows.filter((r) => r.status === "pending").length,
    approved: rows.filter((r) => r.status === "approved").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    total: rows.length,
  };
  const sums = {
    pending: rows.filter((r) => r.status === "pending").reduce((a, r) => a + (r.plan_gtc / 20), 0),
    approved: rows.filter((r) => r.status === "approved").reduce((a, r) => a + (r.plan_gtc / 20), 0),
    rejected: rows.filter((r) => r.status === "rejected").reduce((a, r) => a + (r.plan_gtc / 20), 0),
    total: rows.reduce((a, r) => a + (r.plan_gtc / 20), 0),
  };

  const q = search.trim().toLowerCase();
  const visible = rows
    .filter((r) => filter === "all" || r.status === filter)
    .filter((r) =>
      !q
        ? true
        : r.telegram_username.toLowerCase().includes(q) ||
          String(r.telegram_user_id ?? "").includes(q) ||
          r.txn_hash.toLowerCase().includes(q),
    );
  const txnCounts = rows.reduce((acc, r) => {
    const h = r.txn_hash.trim().toLowerCase();
    if (h) acc.set(h, (acc.get(h) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Pending"
          value={counts.pending}
          dollars={sums.pending}
          tone="violet"
          icon="⏳"
          active={filter === "pending"}
          onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
        />
        <StatCard
          label="Rejected"
          value={counts.rejected}
          dollars={sums.rejected}
          tone="rose"
          icon="✕"
          active={filter === "rejected"}
          onClick={() => setFilter(filter === "rejected" ? "all" : "rejected")}
        />
        <StatCard
          label="Approved"
          value={counts.approved}
          dollars={sums.approved}
          tone="emerald"
          icon="✓"
          active={filter === "approved"}
          onClick={() => setFilter(filter === "approved" ? "all" : "approved")}
        />
        <StatCard
          label="Total"
          value={counts.total}
          dollars={sums.total}
          tone="sky"
          icon="◳"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
      </div>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search UID, @username or TXN…"
          className="flex-1 h-10 rounded-md bg-input border border-border px-3 text-sm"
        />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </Button>
      </div>

      <Section title={`${filter[0].toUpperCase()}${filter.slice(1)} deposits (${visible.length})`}>
        {visible.length === 0 ? (
          <Empty />
        ) : (
          visible.map((r) => (
            <Row
              key={r.id}
              row={r}
              duplicateTxn={(txnCounts.get(r.txn_hash.trim().toLowerCase()) ?? 0) > 1}
              busy={busyId === r.id}
              onApprove={
                r.status === "pending" && (txnCounts.get(r.txn_hash.trim().toLowerCase()) ?? 0) <= 1
                  ? () => approve(r.id)
                  : undefined
              }
              onReject={
                r.status === "pending"
                  ? () => {
                      setReason("");
                      setRejectFor(r);
                    }
                  : undefined
              }
            />
          ))
        )}
      </Section>

      {rejectFor && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => setRejectFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass max-w-md w-full p-5 rounded-2xl border border-border space-y-3"
          >
            <h3 className="font-bold blue-text">Reject request</h3>
            <p className="text-xs text-muted-foreground">
              Reason will be forwarded to @{rejectFor.telegram_username} in their
              Queries page.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Why is this being rejected?"
              className="w-full rounded-xl bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRejectFor(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={reject}
                disabled={reason.trim().length < 2 || busyId === rejectFor.id}
                className="flex-1"
              >
                {busyId === rejectFor.id ? "Sending…" : "Reject & notify"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-black">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
function Empty() {
  return (
    <div className="glass rounded-xl p-4 text-xs text-muted-foreground">None.</div>
  );
}

const TONE_RING: Record<string, string> = {
  violet: "border-violet-500/50 text-violet-400 ring-violet-400",
  rose: "border-rose-500/50 text-rose-400 ring-rose-400",
  emerald: "border-emerald-500/50 text-emerald-400 ring-emerald-400",
  sky: "border-sky-500/50 text-sky-400 ring-sky-400",
};

function StatCard({
  label, value, dollars, tone, icon, active, onClick,
}: {
  label: string; value: number; dollars: number;
  tone: "violet" | "rose" | "emerald" | "sky";
  icon: string; active: boolean; onClick: () => void;
}) {
  const cls = TONE_RING[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass rounded-2xl p-4 text-left border ${cls.split(" ")[0]} ${
        active ? `ring-2 ${cls.split(" ")[2]}` : ""
      } active:scale-[.98] transition`}
    >
      <div className={`flex items-center gap-2 text-xs font-black uppercase ${cls.split(" ")[1]}`}>
        <span>{icon}</span> {label}
      </div>
      <div className="text-3xl font-black mt-1">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">$ {dollars.toFixed(2)}</div>
    </button>
  );
}

function Row({
  row,
  duplicateTxn,
  busy,
  onApprove,
  onReject,
}: {
  row: SubRow;
  duplicateTxn?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const matched = !!row.deposit_match;
  return (
    <div className="glass rounded-xl p-4 border border-border space-y-2">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <div className="font-bold">
            @{row.telegram_username} ·{" "}
            <span className="blue-text">{row.plan_gtc.toLocaleString()} GTC</span> →{" "}
            +{row.plan_messages} msg
          </div>
          <div className="text-[11px] text-muted-foreground">
            {new Date(row.created_at).toLocaleString()}
          </div>
        </div>
        <span
          className={`text-[10px] font-black px-2 py-1 rounded-full ${
            row.status === "pending"
              ? "bg-amber-500/15 text-amber-600"
              : row.status === "approved"
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-destructive/15 text-destructive"
          }`}
        >
          {row.status.toUpperCase()}
        </span>
      </div>
      <a
        href={`https://bscscan.com/tx/${encodeURIComponent(row.txn_hash)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-[11px] font-mono break-all p-2 rounded bg-secondary/40 text-primary hover:underline"
        title="View on BscScan"
      >
        TXN: {row.txn_hash} ↗
      </a>
      {duplicateTxn && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] font-bold text-destructive">
          Duplicate TXN hash found — do not approve another request with this same hash.
        </div>
      )}
      <div className="text-[11px]">
        Deposit ledger:{" "}
        {matched ? (
          <span className="text-emerald-600 font-bold">✅ matched</span>
        ) : (
          <span className="text-amber-600 font-bold">
            ⚠️ no matching deposit found
          </span>
        )}
      </div>
      {row.reject_reason && (
        <div className="text-[11px] text-destructive">
          Reason: {row.reject_reason}
        </div>
      )}
      {row.decided_by && (
        <div className="text-[10px] text-muted-foreground">
          Decided by @{row.decided_by}{" "}
          {row.decided_at && `· ${new Date(row.decided_at).toLocaleString()}`}
        </div>
      )}
      {row.status === "pending" && (onApprove || onReject) && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={onApprove}
            disabled={busy}
            className="flex-1"
          >
            {busy ? "…" : "Approve & credit"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={busy}
            className="flex-1"
          >
            Reject…
          </Button>
        </div>
      )}
    </div>
  );
}
