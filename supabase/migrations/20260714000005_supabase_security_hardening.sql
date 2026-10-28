-- NAV KURD 2027 — Supabase security hardening for source-owned Atlas objects.
-- Safe, additive, rerunnable after migration 000004.
-- This migration intentionally does NOT alter extension-managed public.spatial_ref_sys:
-- Supabase currently flags it in Security Advisor even though PostGIS owns it and project
-- users may be unable to enable RLS on that extension-managed table.

-- ---------------------------------------------------------------------------
-- 1) Freeze search_path on every NAV KURD function owned by these migrations.
-- SECURITY DEFINER functions must not inherit a caller-controlled search path.
-- Trigger functions are hardened too, so Security Advisor does not flag mutable paths.
-- ---------------------------------------------------------------------------
alter function public.is_atlas_owner()
  set search_path = pg_catalog, public;

alter function public.set_atlas_updated_at()
  set search_path = pg_catalog, public;

alter function public.guard_atlas_place_user_write()
  set search_path = pg_catalog, public;

alter function public.accept_atlas_legal_terms(text, text, text)
  set search_path = pg_catalog, public;

alter function public.withdraw_atlas_place_submission(uuid)
  set search_path = pg_catalog, public;

alter function public.review_atlas_place(uuid, text, text)
  set search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- 2) Make SECURITY DEFINER execution explicit and least-privilege.
-- Revoke inherited PUBLIC/anon/authenticated access first, then grant back only the
-- functions that the browser app actually calls or that RLS policies must evaluate.
-- Trigger functions are never directly executable by browser roles.
-- ---------------------------------------------------------------------------
revoke all on function public.is_atlas_owner() from public, anon, authenticated;
revoke all on function public.guard_atlas_place_user_write() from public, anon, authenticated;
revoke all on function public.accept_atlas_legal_terms(text, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_atlas_place_submission(uuid) from public, anon, authenticated;
revoke all on function public.review_atlas_place(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_atlas_updated_at() from public, anon, authenticated;

grant execute on function public.is_atlas_owner() to anon, authenticated;
grant execute on function public.accept_atlas_legal_terms(text, text, text) to authenticated;
grant execute on function public.withdraw_atlas_place_submission(uuid) to authenticated;
grant execute on function public.review_atlas_place(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Stop anonymous listing of the public media bucket while preserving public image URLs.
-- A public Supabase bucket serves known object URLs without a storage.objects SELECT
-- policy. The app uses getPublicUrl() for published images and does not list the bucket.
-- Authenticated owners/users retain the narrow metadata SELECT needed by remove/cleanup.
-- ---------------------------------------------------------------------------
drop policy if exists "atlas media public read" on storage.objects;
drop policy if exists "atlas media owner metadata read" on storage.objects;
drop policy if exists "atlas media user metadata read own path" on storage.objects;

create policy "atlas media owner metadata read" on storage.objects
for select to authenticated
using (
  bucket_id = 'kri-place-media'
  and public.is_atlas_owner()
);

create policy "atlas media user metadata read own path" on storage.objects
for select to authenticated
using (
  bucket_id = 'kri-place-media'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1
    from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

notify pgrst, 'reload schema';
