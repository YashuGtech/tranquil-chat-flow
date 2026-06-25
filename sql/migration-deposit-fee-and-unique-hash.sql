-- ============================================================
-- Deposit fee + strict unique TXN hash for subscription_requests.
-- Idempotent. Safe to re-run.
-- ============================================================

-- 1) Random GTC network fee (1..10) recorded with every deposit request.
ALTER TABLE public.subscription_requests
  ADD COLUMN IF NOT EXISTS fee_gtc int;

-- 2) Strict global uniqueness for NEW txn_hash values so the same on-chain
--    transaction cannot be reused, even across different users / statuses.
--    This registry/trigger keeps working even if legacy duplicate rows already
--    exist in subscription_requests (the old duplicates stay for history, but
--    no more duplicates can be inserted or approved going forward).
CREATE TABLE IF NOT EXISTS public.subscription_txn_hash_registry (
  normalized_txn_hash text PRIMARY KEY,
  subscription_request_id uuid REFERENCES public.subscription_requests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_txn_hash_registry DISABLE ROW LEVEL SECURITY;

-- Seed one registry row per existing hash. If historical duplicates exist, the
-- earliest request owns the hash and later duplicate history is left untouched.
INSERT INTO public.subscription_txn_hash_registry (normalized_txn_hash, subscription_request_id, created_at)
SELECT DISTINCT ON (lower(trim(txn_hash)))
  lower(trim(txn_hash)) AS normalized_txn_hash,
  id,
  created_at
FROM public.subscription_requests
WHERE txn_hash IS NOT NULL AND length(trim(txn_hash)) > 0
ORDER BY lower(trim(txn_hash)), created_at ASC
ON CONFLICT (normalized_txn_hash) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reserve_subscription_txn_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := lower(trim(NEW.txn_hash));
  IF normalized = '' THEN
    RAISE EXCEPTION 'Transaction hash is required';
  END IF;

  INSERT INTO public.subscription_txn_hash_registry (normalized_txn_hash, subscription_request_id)
  VALUES (normalized, NEW.id);
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This transaction hash has already been submitted. Each on-chain TXN can only be used once.'
    USING ERRCODE = '23505';
END;
$$;

DROP TRIGGER IF EXISTS trg_reserve_subscription_txn_hash ON public.subscription_requests;
CREATE TRIGGER trg_reserve_subscription_txn_hash
BEFORE INSERT ON public.subscription_requests
FOR EACH ROW EXECUTE FUNCTION public.reserve_subscription_txn_hash();

-- 3) Optional direct UNIQUE index. It will be created only if no historical
--    duplicates exist; the trigger above is the real enforcement for new rows.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS subscription_requests_txn_hash_unique
      ON public.subscription_requests (lower(trim(txn_hash)));
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'subscription_requests has historical duplicate txn_hash values; UNIQUE index skipped. Application-layer check still blocks new duplicates.';
  END;
END $$;
