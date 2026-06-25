-- ============================================================
-- Paid credits persist across days (no rollover for FREE only).
--
-- New: user_credits table — persistent paid balance per user.
-- Existing: message_usage.bonus_remaining is kept for back-compat
-- but no longer the source of truth (we migrate any positive
-- bonuses on today's rows into user_credits then ignore it).
-- ============================================================

create table if not exists public.user_credits (
  telegram_username text primary key,
  paid_credits int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_credits disable row level security;

-- One-time migration: pull any existing bonus_remaining into user_credits
-- so users don't lose previously granted credits.
insert into public.user_credits (telegram_username, paid_credits)
select telegram_username, coalesce(sum(bonus_remaining), 0)
from public.message_usage
where bonus_remaining > 0
group by telegram_username
on conflict (telegram_username) do update
  set paid_credits = public.user_credits.paid_credits + excluded.paid_credits,
      updated_at = now();

-- Zero out the per-day bonus column so it can't double-credit later.
update public.message_usage set bonus_remaining = 0 where bonus_remaining > 0;
