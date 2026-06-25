-- ============================================================
-- GTech AI Bot — env-pool usage tracking + admin testing accounts
-- Run in Supabase SQL Editor.
-- ============================================================

-- Per-env-key (label-based), per-minute usage so the admin AI Keys tab can
-- show how many requests each provider/key in .env handled. DB-managed keys
-- continue to use public.ai_api_usage (key_id uuid). Env-pool keys live here.
create table if not exists public.ai_pool_usage (
  label text not null,
  minute_bucket timestamptz not null,
  requests int not null default 0,
  primary key (label, minute_bucket)
);
create index if not exists idx_ai_pool_usage_recent
  on public.ai_pool_usage(minute_bucket desc);
alter table public.ai_pool_usage disable row level security;
grant all on public.ai_pool_usage to service_role;
grant select, insert, update on public.ai_pool_usage to anon, authenticated;

-- Admin testing harness: synthetic verified sessions used by the
-- "Testing" tab to load-test the chat backend. We mark these with a
-- well-known prefix so they can be cleaned up later.
create table if not exists public.test_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_test_accounts_created
  on public.test_accounts(created_at desc);
alter table public.test_accounts disable row level security;
grant all on public.test_accounts to service_role;
grant select, insert, update, delete on public.test_accounts to anon, authenticated;
