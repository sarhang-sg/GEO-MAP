-- NAV KURD 9.1.0 — fresh-production backend ownership and contract closure.
-- Run after 20260724_000021_visitor_presence_share.sql.
--
-- This migration is intentionally idempotent. It gives the final production
-- Google account a durable administrator bootstrap and refuses to complete if
-- any Auth/Realtime/notification/Storage primitive required by the app is
-- absent. OAuth provider secrets and Auth redirect URLs remain dashboard
-- configuration and are never stored in SQL or source control.

begin;

-- The fresh database has no previous atlas_owners row from which migration
-- 000010 could learn the administrator email. Keep the verified email in the
-- private allow-list so the auth.users trigger grants the owner role on the
-- first Google sign-in. Browser roles cannot read this schema/table.
insert into nav_kurd_private.atlas_owner_emails(email)
values ('s.pasha0101@gmail.com')
on conflict (email) do nothing;

-- Also repair the role immediately if Google sign-in happened before this
-- migration reached production.
insert into public.atlas_owners(user_id)
select auth_user.id
from auth.users as auth_user
where lower(btrim(auth_user.email)) = 's.pasha0101@gmail.com'
on conflict (user_id) do nothing;

-- Reassert the two real media buckets and their production limits. Object
-- bytes are never fabricated; an old project's objects must be copied
-- separately through the Storage API if they are still required.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('kri-place-media', 'kri-place-media', true, 10485760,
   array['image/jpeg','image/png','image/webp']),
  ('kri-place-media-private', 'kri-place-media-private', false, 10485760,
   array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Only tables consumed by the live application enter Postgres Changes.
-- Supabase Presence itself uses its dedicated channel and does not require a
-- database table in this publication.
do $realtime$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'atlas_places',
    'atlas_place_photos',
    'atlas_place_revisions',
    'atlas_notifications',
    'atlas_feedback'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = relation_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        relation_name
      );
    end if;
  end loop;
end;
$realtime$;

-- Fail the deployment instead of allowing a partly-working backend.
do $contract$
declare
  missing_tables text;
  missing_functions text;
  unprotected_tables text;
  realtime_count integer;
begin
  select string_agg(required.name, ', ' order by required.name)
  into missing_tables
  from unnest(array[
    'public.atlas_account_deletion_requests',
    'public.atlas_activity_audit',
    'public.atlas_feedback',
    'public.atlas_notifications',
    'public.atlas_owners',
    'public.atlas_place_photos',
    'public.atlas_place_revisions',
    'public.atlas_places',
    'public.atlas_supporters',
    'public.atlas_user_profiles'
  ]) as required(name)
  where to_regclass(required.name) is null;

  if missing_tables is not null then
    raise exception 'NAV KURD backend tables are missing: %', missing_tables;
  end if;

  select string_agg(required.signature, ', ' order by required.signature)
  into missing_functions
  from unnest(array[
    'public.count_public_online_users(integer)',
    'public.get_atlas_public_directory_visibility()',
    'public.list_public_visitor_directory(integer,integer)',
    'public.record_atlas_activity(text)',
    'public.set_atlas_public_directory_visibility(boolean)'
  ]) as required(signature)
  where to_regprocedure(required.signature) is null;

  if missing_functions is not null then
    raise exception 'NAV KURD backend functions are missing: %', missing_functions;
  end if;

  select string_agg(class.relname, ', ' order by class.relname)
  into unprotected_tables
  from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = any(array[
      'atlas_account_deletion_requests',
      'atlas_activity_audit',
      'atlas_feedback',
      'atlas_notifications',
      'atlas_owners',
      'atlas_place_photos',
      'atlas_place_revisions',
      'atlas_places',
      'atlas_supporters',
      'atlas_user_profiles'
    ])
    and not class.relrowsecurity;

  if unprotected_tables is not null then
    raise exception 'NAV KURD tables without RLS: %', unprotected_tables;
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'kri-place-media' and public = true
      and file_size_limit = 10485760
  ) then
    raise exception 'NAV KURD public media bucket is not production-ready';
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'kri-place-media-private' and public = false
      and file_size_limit = 10485760
  ) then
    raise exception 'NAV KURD private media bucket is not production-ready';
  end if;

  select count(*)
  into realtime_count
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = any(array[
      'atlas_places',
      'atlas_place_photos',
      'atlas_place_revisions',
      'atlas_notifications',
      'atlas_feedback'
    ]);

  if realtime_count <> 5 then
    raise exception 'NAV KURD Realtime contract is incomplete (%/5)', realtime_count;
  end if;

  if not exists (
    select 1
    from nav_kurd_private.atlas_owner_emails
    where email = 's.pasha0101@gmail.com'
  ) then
    raise exception 'NAV KURD production owner bootstrap is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger as trg
    join pg_class as class on class.oid = trg.tgrelid
    join pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'auth'
      and class.relname = 'users'
      and trg.tgname = 'nav_kurd_sync_owner_from_email'
      and not trg.tgisinternal
  ) then
    raise exception 'NAV KURD Google-owner synchronization trigger is missing';
  end if;
end;
$contract$;

notify pgrst, 'reload schema';
commit;
