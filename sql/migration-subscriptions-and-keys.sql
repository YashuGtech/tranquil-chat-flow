-- ============================================================
-- GTech AI Bot — Daily limits, GTC subscriptions & AI key pool
-- Run in Supabase SQL Editor (RLS disabled — server uses service_role)
-- ============================================================

-- 1. Daily message usage (per user, per day). bonus_remaining does NOT roll over.
create table if not exists public.message_usage (
  telegram_username text not null,
  day date not null,
  used int not null default 0,
  bonus_remaining int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (telegram_username, day)
);
create index if not exists idx_message_usage_day on public.message_usage(day desc);
alter table public.message_usage disable row level security;

-- 2. Subscription requests
create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_username text not null,
  telegram_user_id bigint,
  plan_gtc int not null,
  plan_messages int not null,
  txn_hash text not null,
  fee_gtc int,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_sub_req_status on public.subscription_requests(status, created_at desc);
create index if not exists idx_sub_req_user   on public.subscription_requests(telegram_username, created_at desc);
alter table public.subscription_requests disable row level security;

-- Database-level TXN hash replay protection for new deposit requests.
create table if not exists public.subscription_txn_hash_registry (
  normalized_txn_hash text primary key,
  subscription_request_id uuid references public.subscription_requests(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.subscription_txn_hash_registry disable row level security;

create or replace function public.reserve_subscription_txn_hash()
returns trigger
language plpgsql
as $$
declare
  normalized text;
begin
  normalized := lower(trim(NEW.txn_hash));
  if normalized = '' then
    raise exception 'Transaction hash is required';
  end if;
  insert into public.subscription_txn_hash_registry (normalized_txn_hash, subscription_request_id)
  values (normalized, NEW.id);
  return NEW;
exception when unique_violation then
  raise exception 'This transaction hash has already been submitted. Each on-chain TXN can only be used once.'
    using errcode = '23505';
end;
$$;

drop trigger if exists trg_reserve_subscription_txn_hash on public.subscription_requests;
create trigger trg_reserve_subscription_txn_hash
before insert on public.subscription_requests
for each row execute function public.reserve_subscription_txn_hash();

-- 3. AI API key pool (developer-managed, unlimited keys per provider)
create table if not exists public.ai_api_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini','nvidia')),
  label text not null,
  api_key text not null,
  model text,                     -- override per key (defaults handled in code)
  rpm_limit int not null default 15,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ai_api_keys disable row level security;

-- 4. Per-key, per-minute usage (for RPM enforcement + stats)
create table if not exists public.ai_api_usage (
  key_id uuid not null references public.ai_api_keys(id) on delete cascade,
  minute_bucket timestamptz not null,
  requests int not null default 0,
  primary key (key_id, minute_bucket)
);
create index if not exists idx_ai_usage_recent on public.ai_api_usage(minute_bucket desc);

-- 5. Seed default GTC deposit address (editable later from admin if you want)
insert into public.bot_config(key, value)
values ('gtc_deposit_address', '0xe724D2800Cf0Af62aB7f3e08f2f6AD32900c1491')
on conflict (key) do nothing;
