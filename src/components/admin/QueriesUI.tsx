import React from "react";
import { Button } from "@/components/ui/button";
import { SecureImage } from "@/components/SecureImage";
import { ChevronRight } from "lucide-react";

export type Tone = "violet" | "emerald" | "amber";

const TONE: Record<Tone, {
  border: string;
  glow: string;
  ring: string;
  iconBg: string;
  iconText: string;
  text: string;
  pillBg: string;
  pillText: string;
  btn: string;
  divider: string;
}> = {
  violet: {
    border: "border-violet-500/40",
    glow: "shadow-[0_0_40px_-12px_rgba(139,92,246,0.45)]",
    ring: "ring-violet-500/20",
    iconBg: "bg-violet-500/15",
    iconText: "text-violet-400",
    text: "text-violet-300",
    pillBg: "bg-violet-500/15",
    pillText: "text-violet-300",
    btn: "bg-violet-600 hover:bg-violet-500 text-white",
    divider: "border-violet-500/15",
  },
  emerald: {
    border: "border-emerald-500/40",
    glow: "shadow-[0_0_40px_-12px_rgba(16,185,129,0.45)]",
    ring: "ring-emerald-500/20",
    iconBg: "bg-emerald-500/15",
    iconText: "text-emerald-400",
    text: "text-emerald-300",
    pillBg: "bg-emerald-500/15",
    pillText: "text-emerald-300",
    btn: "bg-emerald-600 hover:bg-emerald-500 text-white",
    divider: "border-emerald-500/15",
  },
  amber: {
    border: "border-amber-500/40",
    glow: "shadow-[0_0_40px_-12px_rgba(245,158,11,0.45)]",
    ring: "ring-amber-500/20",
    iconBg: "bg-amber-500/15",
    iconText: "text-amber-400",
    text: "text-amber-300",
    pillBg: "bg-amber-500/15",
    pillText: "text-amber-400",
    btn: "bg-violet-600 hover:bg-violet-500 text-white",
    divider: "border-amber-500/15",
  },
};

export function QueryStatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: Tone;
  icon: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      className={`relative rounded-2xl border ${t.border} ${t.glow} bg-card/40 backdrop-blur p-4 sm:p-5 flex items-center gap-4 overflow-hidden`}
    >
      <div
        className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full ${t.iconBg} ${t.iconText} grid place-items-center shrink-0`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-muted-foreground truncate">{label}</div>
        <div className={`text-3xl sm:text-4xl font-black ${t.text} leading-tight tabular-nums`}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function QuerySection<T extends { id: string }>({
  title,
  tone,
  items,
  icon,
  renderItem,
}: {
  title: string;
  tone: Tone;
  items: T[];
  icon: React.ReactNode;
  renderItem: (item: T) => React.ReactNode;
}) {
  const t = TONE[tone];
  if (items.length === 0) return null;
  return (
    <section
      className={`relative rounded-2xl border ${t.border} ${t.glow} bg-card/30 backdrop-blur p-4 sm:p-5`}
    >
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-full ${t.iconBg} ${t.iconText} grid place-items-center`}>
            {icon}
          </span>
          <h3 className="text-lg sm:text-xl font-extrabold text-foreground">{title}</h3>
        </div>
        <span className={`text-sm font-bold px-3 py-1 rounded-md border ${t.border} ${t.pillText}`}>
          {items.length}
        </span>
      </header>
      <div className="relative">
        <ol className={`divide-y ${t.divider}`}>
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              {renderItem(item)}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

type Req = {
  id: string;
  telegram_username: string;
  subject?: string | null;
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
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function QueryItem({
  req,
  tone,
  replyDrafts,
  setReplyDrafts,
  replyPhotos,
  pickReplyPhoto,
  clearReplyPhoto,
  sendReply,
  replyBusy,
  onReopen,
}: {
  req: Req;
  tone: Tone;
  replyDrafts: Record<string, string>;
  setReplyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  replyPhotos: Record<string, { file: File; url: string }>;
  pickReplyPhoto: (id: string, e: React.ChangeEvent<HTMLInputElement>) => void;
  clearReplyPhoto: (id: string) => void;
  sendReply: (id: string) => void;
  replyBusy: string | null;
  onReopen?: () => void;
}) {
  const t = TONE[tone];
  const isAnswered = req.status === "answered";
  const isReopened = tone === "amber";
  const statusLabel = isAnswered ? "Answered" : isReopened ? "Reopened" : "Pending";
  const [open, setOpen] = React.useState(!isAnswered);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <code className="font-mono text-sm font-extrabold text-foreground">
            GT-{req.id.slice(0, 8).toUpperCase()}
          </code>
          <span className="text-xs text-muted-foreground">· @{req.telegram_username}</span>
        </div>
        <div className="text-base font-semibold text-foreground mb-2 break-words">
          {req.subject || req.message.slice(0, 80)}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span
            className={`px-2 py-0.5 rounded-md font-bold ${t.pillBg} ${t.pillText} border ${t.border}`}
          >
            {statusLabel}
          </span>
          <span className={`${t.pillText}`}>·</span>
          <span className={`${t.pillText} font-medium`}>
            {isReopened && !req.admin_reply
              ? "Awaiting Response"
              : timeAgo(req.created_at)}
          </span>
        </div>

        {open && (
          <div className="mt-3 space-y-2">
            {req.subject && req.message && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{req.message}</p>
            )}
            {req.photo_url && (
              <SecureImage
                url={req.photo_url}
                alt="user attachment"
                mode="inline"
                className="rounded-lg max-h-48 object-cover border border-border"
              />
            )}
            {req.ai_analysis && (
              <div className="text-[11px] rounded-md bg-secondary/60 p-2 whitespace-pre-wrap">
                <b className="text-primary">AI vision summary:</b>
                {"\n"}
                {req.ai_analysis}
              </div>
            )}
            {req.admin_reply && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs whitespace-pre-wrap">
                <b className="text-emerald-400">
                  Reply{req.replied_by ? ` by @${req.replied_by}` : ""}:
                </b>
                {"\n"}
                {req.admin_reply}
                {req.reply_photo_url && (
                  <SecureImage
                    url={req.reply_photo_url}
                    alt="admin attachment"
                    mode="inline"
                    className="rounded-lg max-h-44 object-cover border border-border"
                  />
                )}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground/60">
              {new Date(req.created_at).toLocaleString()} · source: {req.source ?? "ai"}
            </div>

            {!isAnswered && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={replyDrafts[req.id] ?? ""}
                  onChange={(e) =>
                    setReplyDrafts((d) => ({ ...d, [req.id]: e.target.value }))
                  }
                  placeholder="Type a reply to the user…"
                  rows={2}
                  className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                {replyPhotos[req.id] ? (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-secondary/60 border border-border">
                    <img
                      src={replyPhotos[req.id].url}
                      alt="preview"
                      className="h-12 w-12 rounded object-cover"
                    />
                    <div className="flex-1 text-[11px] text-muted-foreground truncate">
                      {replyPhotos[req.id].file.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => clearReplyPhoto(req.id)}
                      className="w-6 h-6 rounded-full bg-destructive text-white text-xs font-bold"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-md bg-secondary cursor-pointer hover:bg-secondary/80">
                    📎 Attach photo (optional)
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => pickReplyPhoto(req.id, e)}
                    />
                  </label>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => sendReply(req.id)}
                    disabled={
                      replyBusy === req.id || !(replyDrafts[req.id] ?? "").trim()
                    }
                  >
                    {replyBusy === req.id
                      ? "Sending…"
                      : "Send Reply & Mark Answered"}
                  </Button>
                </div>
              </div>
            )}

            {isAnswered && onReopen && (
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={onReopen} className="text-xs">
                  Move to Pending
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg ${t.btn} transition-colors`}
        >
          {isAnswered ? (open ? "Hide" : "View") : open ? "Hide" : "Respond Now"}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}