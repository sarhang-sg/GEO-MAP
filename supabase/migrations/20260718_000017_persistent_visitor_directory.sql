-- NAV KURD 2027 — persistent public visitor directory.
-- Safe, additive and rerunnable. Run after 20260718_000016_activity_clock_cache_integrity.sql.
-- Visitor profiles are retained beyond 24 hours. A profile is removed only through
-- the existing explicit account-deletion workflow, not by time-window cleanup.

create index if not exists atlas_user_profiles_directory_idx
  on public.atlas_user_profiles(last_seen_at desc, user_id)
  where last_seen_at is not null
    and nullif(btrim(display_name), '') is not null;

-- Backwards-compatible function used by older deployed clients. The former
-- 24-hour predicate is intentionally removed, so existing visitors do not
-- disappear from the UI when they become older than one day.
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
    profile.user_id,
    nullif(btrim(profile.display_name), '') as display_name,
    nullif(btrim(profile.avatar_url), '') as avatar_url,
    profile.last_seen_at
  from public.atlas_user_profiles as profile
  where profile.last_seen_at is not null
    and nullif(btrim(profile.display_name), '') is not null
  order by profile.last_seen_at desc, profile.user_id
  limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

revoke all on function public.list_public_recent_activity(integer) from public;
grant execute on function public.list_public_recent_activity(integer) to anon, authenticated;

-- Paginated persistent directory for the current client. total_count is computed
-- before LIMIT/OFFSET so the UI can expose every retained profile without loading
-- an unbounded DOM in one request.
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
      profile.user_id,
      nullif(btrim(profile.display_name), '') as display_name,
      nullif(btrim(profile.avatar_url), '') as avatar_url,
      profile.last_seen_at
    from public.atlas_user_profiles as profile
    where profile.last_seen_at is not null
      and nullif(btrim(profile.display_name), '') is not null
  )
  select
    eligible.user_id,
    eligible.display_name,
    eligible.avatar_url,
    eligible.last_seen_at,
    count(*) over () as total_count
  from eligible
  order by eligible.last_seen_at desc, eligible.user_id
  limit least(greatest(coalesce(p_limit, 24), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000);
$$;

revoke all on function public.list_public_visitor_directory(integer, integer) from public;
grant execute on function public.list_public_visitor_directory(integer, integer) to anon, authenticated;

comment on function public.list_public_recent_activity(integer) is
  'Backwards-compatible persistent visitor list. No 24-hour expiry is applied.';
comment on function public.list_public_visitor_directory(integer, integer) is
  'Returns the persistent, paginated public visitor directory ordered by the authoritative latest server activity timestamp.';

notify pgrst, 'reload schema';
