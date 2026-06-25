interface QuotaSnapshot {
  dailyAllowance: number;
  used: number;
  freeLeft: number;
  bonusLeft: number;
  totalLeft: number;
}

interface Props {
  quota: QuotaSnapshot | null;
  onSubscribe: () => void;
}

export function QuotaBar({ quota, onSubscribe }: Props) {
  if (!quota) return null;
  const pct = Math.min(
    100,
    Math.round((quota.used / Math.max(1, quota.dailyAllowance)) * 100),
  );
  const exhausted = quota.totalLeft <= 0;
  const lowFree = quota.freeLeft <= 2;
  return (
    <div className="px-3 sm:px-5 pt-2 pb-1">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between text-[10px] font-bold mb-1">
          <span className="text-muted-foreground">
            Daily messages:{" "}
            <span className="text-foreground">
              {quota.used}/{quota.dailyAllowance}
            </span>
            {quota.bonusLeft > 0 && (
              <span className="ml-2 text-emerald-600">
                +{quota.bonusLeft} bonus
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onSubscribe}
            className="text-primary hover:underline"
          >
            {exhausted ? "Subscribe to continue" : "Buy more"}
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              exhausted
                ? "bg-destructive"
                : lowFree
                  ? "bg-amber-500"
                  : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {quota.totalLeft} message{quota.totalLeft === 1 ? "" : "s"} remaining today
        </div>
      </div>
    </div>
  );
}
