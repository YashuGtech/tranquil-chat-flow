-- ============================================================
-- Deposit fee + strict unique TXN hash for subscription_requests.
-- Idempotent. Safe to re-run.
-- ============================================================

-- 1) Random GTC network fee (1..10) recorded with every deposit request.
ALTER TABLE public.subscription_requests
  ADD COLUMN IF NOT EXISTS fee_gtc int;

-- 2) Strict global uniqueness on txn_hash so the same on-chain transaction
--    cannot be reused, even across different users / statuses.
--    Wrapped in a DO block so legacy duplicates don't break the migration.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS subscription_requests_txn_hash_unique
      ON public.subscription_requests (lower(trim(txn_hash)));
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'subscription_requests has historical duplicate txn_hash values; UNIQUE index skipped. Application-layer check still blocks new duplicates.';
  END;
END $$;
