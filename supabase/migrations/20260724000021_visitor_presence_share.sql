-- NAV KURD 2027 — current visitor-directory and presence closure.
-- Run after 20260723_000020_direction_taxonomy_quality.sql.
--
-- Product contract:
--   * a signed-in Google profile is listed automatically on first activity;
--   * a user can explicitly hide the profile at any time;
--   * an explicit previous choice is preserved;
--   * public results use a project pseudonym, never the raw Auth UUID;
--   * online state is computed from the database server clock.

alter table public.atlas_user_profiles
  alter column public_directory_visible set default true;

-- Migration 000018 created this field with default false. Backfill only profiles
-- that never made an explicit privacy choice; rows with an update timestamp keep
-- the user's selected value.
update public.atlas_user_profiles
set public_directory_visible = true,
    updated_at = greatest(coalesce(updated_at, clock_timestamp()), clock_timestamp())
where public_directory_updated_at is null
  and public_directory_visible = false;

create index if not exists atlas_user_profiles_public_directory_online_idx
  on public.atlas_user_profiles(public_directory_visible, last_seen_at desc, user_id)
  where public_directory_visible = true
    and last_seen_at is not null
    and nullif(btrim(display_name), '') is not null;

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
  ), true);
$$;

revoke all on function public.get_atlas_public_directory_visibility() from public, anon;
grant execute on function public.get_atlas_public_directory_visibility() to authenticated;

create or replace function public.record_atlas_activity(p_event text default 'active')
returns timestamptz
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := clock_timestamp();
  normalized_event text := lower(coalesce(nullif(btrim(p_event), ''), 'active'));
  metadata jsonb := '{}'::jsonb;
  resolved_name text;
  resolved_avatar text;
  resolved_locale text := 'ku';
  auth_last_sign_in timestamptz;
begin
  if actor is null then
    return null;
  end if;

  if normalized_event not in ('sign_in', 'active', 'heartbeat', 'resume', 'gps') then
    normalized_event := 'active';
  end if;

  select
    coalesce(raw_user_meta_data, '{}'::jsonb),
    case
      when raw_user_meta_data ->> 'locale' in ('ku', 'ar', 'en') then raw_user_meta_data ->> 'locale'
      else 'ku'
    end,
    last_sign_in_at
  into metadata, resolved_locale, auth_last_sign_in
  from auth.users
  where id = actor;

  resolved_name := coalesce(
    nullif(btrim(metadata ->> 'full_name'), ''),
    nullif(btrim(metadata ->> 'name'), '')
  );
  resolved_avatar := coalesce(
    nullif(btrim(metadata ->> 'avatar_url'), ''),
    nullif(btrim(metadata ->> 'picture'), '')
  );

  insert into public.atlas_user_profiles (
    user_id,
    display_name,
    avatar_url,
    locale,
    last_seen_at,
    last_active_at,
    last_signed_in_at,
    activity_updated_at,
    public_directory_visible,
    public_directory_updated_at,
    created_at,
    updated_at
  ) values (
    actor,
    resolved_name,
    resolved_avatar,
    resolved_locale,
    stamp,
    stamp,
    coalesce(auth_last_sign_in, case when normalized_event = 'sign_in' then stamp else null end),
    stamp,
    true,
    null,
    stamp,
    stamp
  )
  on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, public.atlas_user_profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url, public.atlas_user_profiles.avatar_url),
      locale = coalesce(excluded.locale, public.atlas_user_profiles.locale),
      last_seen_at = stamp,
      last_active_at = case
        when normalized_event in ('sign_in', 'active', 'resume', 'gps') then stamp
        else coalesce(public.atlas_user_profiles.last_active_at, stamp)
      end,
      last_signed_in_at = coalesce(
        auth_last_sign_in,
        case when normalized_event = 'sign_in' then stamp else public.atlas_user_profiles.last_signed_in_at end
      ),
      activity_updated_at = stamp,
      public_directory_visible = case
        when public.atlas_user_profiles.public_directory_updated_at is null then true
        else public.atlas_user_profiles.public_directory_visible
      end,
      updated_at = stamp;

  return stamp;
end;
$$;

revoke all on function public.record_atlas_activity(text) from public, anon;
grant execute on function public.record_atlas_activity(text) to authenticated;

-- The return signatures add is_online, so PostgreSQL requires a clean drop.
drop function if exists public.list_public_recent_activity(integer);
create function public.list_public_recent_activity(p_limit integer default 24)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  last_seen_at timestamptz,
  is_online boolean
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
    profile.last_seen_at,
    profile.last_seen_at >= clock_timestamp() - interval '3 minutes' as is_online
  from public.atlas_user_profiles as profile
  where profile.public_directory_visible = true
    and profile.last_seen_at is not null
    and nullif(btrim(profile.display_name), '') is not null
  order by profile.last_seen_at desc, profile.user_id
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

revoke all on function public.list_public_recent_activity(integer) from public;
grant execute on function public.list_public_recent_activity(integer) to anon, authenticated;

drop function if exists public.list_public_visitor_directory(integer, integer);
create function public.list_public_visitor_directory(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  last_seen_at timestamptz,
  is_online boolean,
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
      profile.last_seen_at,
      profile.last_seen_at >= clock_timestamp() - interval '3 minutes' as is_online
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
    eligible.is_online,
    count(*) over () as total_count
  from eligible
  order by eligible.last_seen_at desc, eligible.private_user_id
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;

revoke all on function public.list_public_visitor_directory(integer, integer) from public;
grant execute on function public.list_public_visitor_directory(integer, integer) to anon, authenticated;

comment on column public.atlas_user_profiles.public_directory_visible is
  'Controls public visitor-list visibility. New and previously undecided signed-in profiles default to visible; an explicit user choice is preserved.';
comment on function public.record_atlas_activity(text) is
  'Synchronizes the authenticated Google profile, updates authoritative activity time and enables the visitor-list default unless the user explicitly opted out.';
comment on function public.list_public_recent_activity(integer) is
  'Returns privacy-filtered recent profiles with a pseudonymous ID and server-clock online state.';
comment on function public.list_public_visitor_directory(integer, integer) is
  'Returns the paginated privacy-filtered visitor list with pseudonymous IDs, server-clock online state and total count.';

notify pgrst, 'reload schema';
