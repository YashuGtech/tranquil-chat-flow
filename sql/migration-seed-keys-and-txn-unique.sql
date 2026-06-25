-- =========================================================
-- Seed default AI keys (Gemma + Nvidia pools).
-- Safe to re-run (uses ON CONFLICT).
--
-- NOTE: TXN replay protection now lives in
-- migration-deposit-fee-and-unique-hash.sql. It uses a registry/trigger so
-- historical duplicate rows can remain for audit history while NEW duplicate
-- TXN hashes are blocked before saving.
-- =========================================================

-- Make api_key globally unique so re-running this seed is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS ai_api_keys_api_key_unique
  ON public.ai_api_keys (api_key);

-- Seed Gemma keys (15 RPM each). Provider 'gemini' uses the Google
-- OpenAI-compat endpoint, model gemma-3-27b-it.
INSERT INTO public.ai_api_keys (provider, label, api_key, model, rpm_limit, active) VALUES
  ('gemini', 'Gemma Pool #1', 'AQ.Ab8RN6IVMQS-BSbwuWMQekIQkm8Rxz5FEuic_f0_e7_XMc5g5w', 'gemma-3-27b-it', 15, true),
  ('gemini', 'Gemma Pool #2', 'AQ.Ab8RN6JwgiDa_nRZj5YPVWgSw8mcoUbZUZFCFgkackybRWNCqw', 'gemma-3-27b-it', 15, true),
  ('gemini', 'Gemma Pool #3', 'AQ.Ab8RN6Iaz2JokMfGeNqRQBefDjOCby1dfbGnQGZ2sN7NfskAHQ', 'gemma-3-27b-it', 15, true),
  ('gemini', 'Gemma Pool #4', 'AIzaSyAhoCH7h8HGrY31dvh15q66M72usC7B76g',                 'gemma-3-27b-it', 15, true),
  ('gemini', 'Gemma Pool #5', 'AIzaSyAFweU9UpIoaFojhFxGCLtlfUYTlMQWNkA',                 'gemma-3-27b-it', 15, true)
ON CONFLICT (api_key) DO NOTHING;

-- Seed Nvidia Nemotron keys (40 RPM each).
INSERT INTO public.ai_api_keys (provider, label, api_key, model, rpm_limit, active) VALUES
  ('nvidia', 'Nvidia Nemotron #1', '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', 'nvidia/nemotron-nano-3-8b-v1', 40, true),
  ('nvidia', 'Nvidia Nemotron #2', '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', 'nvidia/nemotron-nano-3-8b-v1', 40, true)
ON CONFLICT (api_key) DO NOTHING;
