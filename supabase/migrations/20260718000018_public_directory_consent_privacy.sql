-- NAV KURD 2027 — privacy-safe persistent visitor directory.
-- Additive and rerunnable. Run after 20260718_000017_persistent_visitor_directory.sql.
-- Profiles remain available to their owner/admin and for aggregate online counts,
-- but public name/avatar/activity disclosure is opt-in and raw Auth UUIDs are never returned.

alter table public.atlas_user_profiles
  add column if not exists public_directory_visible boolean not null default false,
  add column if not exists public_directory_updated_at timestamptz;

create index if not exists atlas_user_profiles_public_directory_idx
  on public.atlas_user_profiles(last_seen_at desc, user_id)
  where public_directory_visible = true
    and last_seen_at is not null
    and nullif(btrim(display_name), '') is not null;

create or replace function public.atlas_public_directory_id(p_user_id uuid)
returns uuid
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select (
    substr(md5(p_user_id::text || ':nav-kurd-public-directory-v1'), 1, 8) || '-' ||
    substr(md5(p_user_id::text || ':nav-kurd-public-directory-v1'), 9, 4) || '-' ||
    substr(md5(p_user_id::text || ':nav-kurd-public-directory-v1'), 13, 4) || '-' ||
    substr(md5(p_user_id::text || ':nav-kurd-public-directory-v1'), 17, 4) || '-' ||
    substr(md5(p_user_id::text || ':nav-kurd-public-directory-v1'), 21, 12)
  )::uuid;
$$;

revoke all on function public.atlas_public_directory_id(uuid) from public, anon, authenticated;

create or replace function public.get_atlas_public_directory_visibility()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce((
    select profile.public_directory_visible
    from public.atlas_user_profiles as profile
    where profile.user_id = auth.uid()
  ), false);
$$;

revoke all on function public.get_atlas_public_directory_visibility() from public, anon;
grant execute on function public.get_atlas_public_directory_visibility() to authenticated;

create or replace function public.set_atlas_public_directory_visibility(p_visible boolean)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := clock_timestamp();
begin
  if actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.atlas_user_profiles (
    user_id,
    locale,
    public_directory_visible,
    public_directory_updated_at,
    created_at,
    updated_at
  ) values (
    actor,
    'ku',
    coalesce(p_visible, false),
    stamp,
    stamp,
    stamp
  )
  on conflict (user_id) do update
  set public_directory_visible = coalesce(p_visible, false),
      public_directory_updated_at = stamp,
      updated_at = stamp;

  return coalesce(p_visible, false);
end;
$$;

revoke all on function public.set_atlas_public_directory_visibility(boolean) from public, anon;
grant execute on function public.set_atlas_public_directory_visibility(boolean) to authenticated;

create or replace function public.list_public_recent_activity(p_limit integer default 24)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.atlas_public_directory_id(profile.user_id) as user_id,
    nullif(btrim(profile.display_name), '') as display_name,
    nullif(btrim(profile.avatar_url), '') as avatar_url,
    profile.last_seen_at
  from public.atlas_user_profiles as profile
  where profile.public_directory_visible = true
    and profile.last_seen_at is not null
    and nullif(btrim(profile.display_name), '') is not null
  order by profile.last_seen_at desc, profile.user_id
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

revoke all on function public.list_public_recent_activity(integer) from public;
grant execute on function public.list_public_recent_activity(integer) to anon, authenticated;

create or replace function public.list_public_visitor_directory(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  last_seen_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as (
    select
      profile.user_id as private_user_id,
      public.atlas_public_directory_id(profile.user_id) as public_user_id,
      nullif(btrim(profile.display_name), '') as display_name,
      nullif(btrim(profile.avatar_url), '') as avatar_url,
      profile.last_seen_at
    from public.atlas_user_profiles as profile
    where profile.public_directory_visible = true
      and profile.last_seen_at is not null
      and nullif(btrim(profile.display_name), '') is not null
  )
  select
    eligible.public_user_id as user_id,
    eligible.display_name,
    eligible.avatar_url,
    eligible.last_seen_at,
    count(*) over () as total_count
  from eligible
  order by eligible.last_seen_at desc, eligible.private_user_id
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;

revoke all on function public.list_public_visitor_directory(integer, integer) from public;
grant execute on function public.list_public_visitor_directory(integer, integer) to anon, authenticated;

comment on column public.atlas_user_profiles.public_directory_visible is
  'Explicit opt-in for public display of Google display name, avatar and latest NAV KURD activity. Defaults to false.';
comment on function public.list_public_visitor_directory(integer, integer) is
  'Returns only explicitly opted-in profiles and exposes a deterministic public pseudonym instead of the Auth user UUID.';

notify pgrst, 'reload schema';
