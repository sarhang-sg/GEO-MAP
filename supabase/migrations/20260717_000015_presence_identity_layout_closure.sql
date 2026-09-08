-- NAV KURD 2027 — presence identity and support-layout data closure.
-- Safe, additive and rerunnable. Run after 20260717_000014_support_presence_cv_root.sql.

-- Backfill public profile presentation fields from the user's Google Auth metadata.
update public.atlas_user_profiles as profile
set display_name = coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), '')
    ),
    avatar_url = coalesce(
      nullif(btrim(profile.avatar_url), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'picture'), '')
    ),
    updated_at = greatest(coalesce(profile.updated_at, now()), now())
from auth.users as auth_user
where auth_user.id = profile.user_id
  and (
    profile.display_name is null or btrim(profile.display_name) = '' or
    profile.avatar_url is null or btrim(profile.avatar_url) = ''
  );

-- Presence now creates/repairs the user's profile from Google metadata before
-- updating last_seen_at, so recent visitors have a real name and avatar.
create or replace function public.touch_atlas_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := now();
  metadata jsonb := '{}'::jsonb;
  resolved_name text;
  resolved_avatar text;
begin
  if actor is null then
    return null;
  end if;

  select coalesce(raw_user_meta_data, '{}'::jsonb)
  into metadata
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
    created_at,
    updated_at
  ) values (
    actor,
    resolved_name,
    resolved_avatar,
    'ku',
    stamp,
    stamp,
    stamp
  )
  on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, public.atlas_user_profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url, public.atlas_user_profiles.avatar_url),
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at;

  return stamp;
end;
$$;

revoke all on function public.touch_atlas_presence() from public, anon;
grant execute on function public.touch_atlas_presence() to authenticated;

-- Only identifiable Google profiles are returned to the public 24-hour list.
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
    and profile.last_seen_at >= now() - interval '24 hours'
    and nullif(btrim(profile.display_name), '') is not null
  order by profile.last_seen_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;

revoke all on function public.list_public_recent_activity(integer) from public;
grant execute on function public.list_public_recent_activity(integer) to anon, authenticated;

comment on function public.touch_atlas_presence() is
  'Synchronizes authenticated Google profile identity and updates last_seen_at for NAV KURD presence.';
comment on function public.list_public_recent_activity(integer) is
  'Returns identifiable recent Google profiles active in NAV KURD during the last 24 hours.';

notify pgrst, 'reload schema';
