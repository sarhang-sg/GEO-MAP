-- NAV KURD 2027 — support panel polish, supporter registry and public presence feed.
-- Safe and rerunnable.

alter table public.atlas_user_profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists public.atlas_supporters (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  avatar_url text,
  note text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.atlas_supporters enable row level security;

drop policy if exists "atlas supporters public read" on public.atlas_supporters;
create policy "atlas supporters public read" on public.atlas_supporters
for select to anon, authenticated
using (is_visible = true);

drop policy if exists "atlas supporters owner manage" on public.atlas_supporters;
create policy "atlas supporters owner manage" on public.atlas_supporters
for all to authenticated
using (public.is_atlas_owner())
with check (public.is_atlas_owner());

drop trigger if exists atlas_supporters_updated_at on public.atlas_supporters;
create trigger atlas_supporters_updated_at
before update on public.atlas_supporters
for each row execute function public.set_atlas_updated_at();

create or replace function public.touch_atlas_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor uuid := auth.uid();
  stamp timestamptz := now();
begin
  if actor is null then
    return null;
  end if;

  update public.atlas_user_profiles
  set last_seen_at = stamp,
      updated_at = greatest(updated_at, stamp)
  where user_id = actor;

  return stamp;
end;
$$;

revoke all on function public.touch_atlas_presence() from public, anon;
grant execute on function public.touch_atlas_presence() to authenticated;

create or replace function public.count_public_online_users(p_window_minutes integer default 5)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.atlas_user_profiles
  where last_seen_at is not null
    and last_seen_at >= now() - make_interval(mins => greatest(coalesce(p_window_minutes, 5), 1));
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
    p.user_id,
    nullif(btrim(p.display_name), '') as display_name,
    nullif(btrim(p.avatar_url), '') as avatar_url,
    p.last_seen_at
  from public.atlas_user_profiles p
  where p.last_seen_at is not null
    and p.last_seen_at >= now() - interval '24 hours'
  order by p.last_seen_at desc
  limit greatest(coalesce(p_limit, 12), 1);
$$;

revoke all on function public.list_public_recent_activity(integer) from public;
grant execute on function public.list_public_recent_activity(integer) to anon, authenticated;

create or replace function public.list_public_supporters(p_limit integer default 24)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  note text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    s.id,
    s.display_name,
    nullif(btrim(s.avatar_url), '') as avatar_url,
    nullif(btrim(s.note), '') as note
  from public.atlas_supporters s
  where s.is_visible = true
  order by s.sort_order asc, s.created_at asc
  limit greatest(coalesce(p_limit, 24), 1);
$$;

revoke all on function public.list_public_supporters(integer) from public;
grant execute on function public.list_public_supporters(integer) to anon, authenticated;

comment on function public.touch_atlas_presence() is 'Updates the authenticated user profile last_seen_at timestamp for online-presence UI.';
comment on function public.count_public_online_users(integer) is 'Returns the number of user profiles active in the configured recent time window.';
comment on function public.list_public_recent_activity(integer) is 'Returns the most recent public activity rows for the last 24 hours.';
comment on function public.list_public_supporters(integer) is 'Returns visible supporters for the public support panel.';
