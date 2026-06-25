-- ============================================================
-- GTech Support Bot — Full Database Setup
-- Run this in your Supabase SQL Editor
-- ============================================================
-- RLS: DISABLED on all tables (bot uses service_role key server-side,
--      which bypasses RLS. All auth/access control is in application code.)
-- ============================================================

-- 1. Chat sessions (one per login)
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_username text not null,
  telegram_user_id bigint,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.chat_sessions disable row level security;

-- 2. Chat messages (history per session)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_session on public.chat_messages(session_id, created_at);
alter table public.chat_messages disable row level security;

-- 3. Admin/user requests (raised queries with photo support)
--    status: 'pending' | 'answered'
create table if not exists public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  telegram_username text not null,
  telegram_user_id bigint,
  subject text,
  message text not null,
  photo_url text,                       -- optional: link to user-attached photo
  status text not null default 'pending' check (status in ('pending', 'answered')),
  assigned_admin text,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_requests_status on public.admin_requests(status, created_at desc);
create index if not exists idx_admin_requests_user on public.admin_requests(telegram_username, created_at desc);
alter table public.admin_requests disable row level security;

-- 4. OTP codes (2-minute expiry, max 10 per day per user)
create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  username text not null,
  code text not null,
  attempts int not null default 0,
  consumed boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_otp_codes_lookup on public.otp_codes(telegram_id, created_at desc);
alter table public.otp_codes disable row level security;

-- 5. Trainer-curated AI knowledge base (@Yashu_Gtech only)
create table if not exists public.training_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  tags text[] default '{}',
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_training_docs_active on public.training_docs(active, updated_at desc);
alter table public.training_docs disable row level security;

-- 6. Bot config (admin-updatable API keys — stored in DB as fallback)
create table if not exists public.bot_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.bot_config disable row level security;

-- ============================================================
-- Your existing tables (used by the bot, NOT created here):
--   users(telegram_id bigint, username text, balance_gtc numeric, phone text, ...)
--   deposits(telegram_id bigint, amount numeric, txn_hash text, status text, created_at timestamptz)
--   withdrawals(telegram_id bigint, amount numeric, txn_hash text, status text, created_at timestamptz)
--
-- If column names differ, update src/config/user-db.ts to match.
-- ============================================================

-- Optional: Create deposits / withdrawals if you don't have them yet:
-- create table if not exists public.deposits (
--   id uuid primary key default gen_random_uuid(),
--   telegram_id bigint not null,
--   amount numeric not null,
--   txn_hash text,
--   status text default 'pending',
--   created_at timestamptz not null default now()
-- );
-- alter table public.deposits disable row level security;

-- create table if not exists public.withdrawals (
--   id uuid primary key default gen_random_uuid(),
--   telegram_id bigint not null,
--   amount numeric not null,
--   txn_hash text,
--   status text default 'pending',
--   created_at timestamptz not null default now()
-- );
-- alter table public.withdrawals disable row level security;
