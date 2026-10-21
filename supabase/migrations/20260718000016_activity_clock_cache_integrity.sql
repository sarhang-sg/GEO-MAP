-- NAV KURD 2027 — authoritative account activity clock and presence integrity.
-- Additive, idempotent and safe after migrations 000014 and 000015.

alter table public.atlas_user_profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists last_signed_in_at timestamptz,
  add column if not exists activity_updated_at timestamptz;

create index if not exists atlas_user_profiles_last_seen_idx
  on public.atlas_user_profiles(last_seen_at desc)
  where last_seen_at is not null;

create index if not exists atlas_user_profiles_last_active_idx
  on public.atlas_user_profiles(last_active_at desc)
  where last_active_at is not null;

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
    stamp,
    stamp
  )
  on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, public.atlas_user_profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url, public.atlas_user_profiles.avatar_url),
      last_seen_at = stamp,
      last_active_at = case
        when normalized_event in ('sign_in', 'active', 'resume', 'gps') then stamp
        else coalesce(public.atlas_user_profiles.last_active_at, stamp)
      end,
      last_signed_in_at = coalesce(
        auth_last_sign_in,
        case when normalized_event = 'sign_in' then stamp else public.atlas_user_profiles.last_signed_in_at end
      ),
      activity_updated_at = stamp;

  return stamp;
end;
$$;

revoke all on function public.record_atlas_activity(text) from public, anon;
grant execute on function public.record_atlas_activity(text) to authenticated;

-- Compatibility function now delegates to the authoritative server-clock RPC.
create or replace function public.touch_atlas_presence()
returns timestamptz
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select public.record_atlas_activity('heartbeat');
$$;

revoke all on function public.touch_atlas_presence() from public, anon;
grant execute on function public.touch_atlas_presence() to authenticated;


create or replace function public.get_atlas_server_clock()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select clock_timestamp();
$$;

revoke all on function public.get_atlas_server_clock() from public;
grant execute on function public.get_atlas_server_clock() to anon, authenticated;

create or replace function public.count_public_online_users(p_window_minutes integer default 3)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.atlas_user_profiles
  where last_seen_at is not null
    and last_seen_at >= clock_timestamp() - make_interval(mins => least(greatest(coalesce(p_window_minutes, 3), 1), 15));
$$;

revoke all on function public.count_public_online_users(integer) from public;
grant execute on function public.count_public_online_users(integer) to anon, authenticated;

create or replace function public.list_public_recent_activity(p_limit integer default 12)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  last_seen_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    profile.user_id,
    nullif(btrim(profile.display_name), '') as display_name,
    nullif(btrim(profile.avatar_url), '') as avatar_url,
    profile.last_seen_at
  from public.atlas_user_profiles as profile
  where profile.last_seen_at is not null
    and profile.last_seen_at >= clock_timestamp() - interval '24 hours'
    and nullif(btrim(profile.display_name), '') is not null
  order by profile.last_seen_at desc, profile.user_id
  limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;

revoke all on function public.list_public_recent_activity(integer) from public;
grant execute on function public.list_public_recent_activity(integer) to anon, authenticated;

comment on function public.record_atlas_activity(text) is
  'Records NAV KURD sign-in/activity using the PostgreSQL server clock and Auth last_sign_in_at; synchronizes safe Google name/avatar metadata.';
comment on function public.get_atlas_server_clock() is
  'Returns the authoritative database clock so relative activity labels do not depend on the device clock.';
comment on column public.atlas_user_profiles.last_seen_at is
  'Authoritative server timestamp for the latest NAV KURD presence heartbeat.';
comment on column public.atlas_user_profiles.last_active_at is
  'Authoritative server timestamp for the latest user interaction, resume or GPS activity.';
comment on column public.atlas_user_profiles.last_signed_in_at is
  'Authoritative server timestamp for the latest NAV KURD sign-in event observed by the app.';

notify pgrst, 'reload schema';
