-- Per-minute chat traffic counters for the admin Metrics panel.
-- Idempotent. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.chat_metrics (
  minute_bucket timestamptz PRIMARY KEY,
  received int NOT NULL DEFAULT 0,
  responded int NOT NULL DEFAULT 0
);
ALTER TABLE public.chat_metrics DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS chat_metrics_minute_idx
  ON public.chat_metrics (minute_bucket DESC);
