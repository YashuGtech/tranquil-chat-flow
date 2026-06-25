-- ============================================================
-- GTech Support Bot — Update Migration (RUN THIS IN SUPABASE SQL EDITOR)
-- Safe to re-run. Adds all columns/tables needed by the latest app.
-- ============================================================

-- 1. admin_requests: ensure all columns exist (fixes "photo_url not found")
alter table public.admin_requests
  add column if not exists photo_url    text,
  add column if not exists admin_reply  text,
  add column if not exists ai_analysis  text,
  add column if not exists ai_summary   text,
  add column if not exists replied_at   timestamptz,
  add column if not exists replied_by   text,
  add column if not exists source       text not null default 'ai';
  -- source: 'ai' | 'user_photo' | 'user_ticket'

-- Refresh PostgREST schema cache so new columns are visible immediately
notify pgrst, 'reload schema';

-- 2. Storage bucket for user-uploaded query photos (public-read)
insert into storage.buckets (id, name, public)
values ('query-photos', 'query-photos', true)
on conflict (id) do nothing;

drop policy if exists "service role full access query-photos" on storage.objects;
create policy "service role full access query-photos"
  on storage.objects for all
  to service_role
  using (bucket_id = 'query-photos')
  with check (bucket_id = 'query-photos');

drop policy if exists "public read query-photos" on storage.objects;
create policy "public read query-photos"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'query-photos');

-- 3. Internal daily photo-analysis counter (NOT exposed to users)
create table if not exists public.photo_usage (
  day date primary key,
  count int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.photo_usage disable row level security;

-- 4. Drop the old per-day OTP limit by simply not enforcing it in code.
--    No schema change needed — otp_codes table is unchanged.

notify pgrst, 'reload schema';
-- ============================================================
-- Done.
-- ============================================================
