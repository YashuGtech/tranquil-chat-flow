-- ============================================================
-- GTech Support Bot — Admin reply photo attachments
-- Run this once in your Supabase SQL Editor.
-- ============================================================

-- 1. Add a column on admin_requests for the admin's reply photo.
alter table public.admin_requests
  add column if not exists reply_photo_url text;

-- 2. Public storage bucket (idempotent) used for BOTH:
--      • user-attached query photos
--      • admin reply photos (stored under "admin-replies/<admin>/...")
insert into storage.buckets (id, name, public)
values ('query-photos', 'query-photos', true)
on conflict (id) do update set public = true;

-- 3. Public read so users and admins can both view the images.
drop policy if exists "query-photos public read" on storage.objects;
create policy "query-photos public read"
  on storage.objects for select
  using (bucket_id = 'query-photos');

-- 4. Service role (used by the server) can write — no extra policy
--    needed; service_role bypasses RLS. Users never upload directly.
