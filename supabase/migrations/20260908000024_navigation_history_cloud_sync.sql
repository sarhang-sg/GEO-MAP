-- NAV KURD 9.1.0 — private cross-device navigation history.
-- Each account can read, write, update and delete only its own route records.

begin;

create table if not exists public.atlas_navigation_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 160),
  status text not null check (status in ('arrived', 'cancelled')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  destination text not null check (char_length(destination) between 1 and 300),
  destination_longitude double precision check (destination_longitude between -180 and 180),
  destination_latitude double precision check (destination_latitude between -90 and 90),
  travel_mode text not null check (travel_mode in ('car', 'bicycle', 'walking')),
  planned_distance_meters integer not null default 0 check (planned_distance_meters >= 0),
  remaining_distance_meters integer not null default 0 check (remaining_distance_meters >= 0),
  planned_duration_seconds integer not null default 0 check (planned_duration_seconds >= 0),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  check (ended_at >= started_at)
);

create index if not exists atlas_navigation_history_user_ended_idx
  on public.atlas_navigation_history (user_id, ended_at desc);

alter table public.atlas_navigation_history enable row level security;

drop policy if exists atlas_navigation_history_select_own on public.atlas_navigation_history;
create policy atlas_navigation_history_select_own
on public.atlas_navigation_history for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists atlas_navigation_history_insert_own on public.atlas_navigation_history;
create policy atlas_navigation_history_insert_own
on public.atlas_navigation_history for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists atlas_navigation_history_update_own on public.atlas_navigation_history;
create policy atlas_navigation_history_update_own
on public.atlas_navigation_history for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists atlas_navigation_history_delete_own on public.atlas_navigation_history;
create policy atlas_navigation_history_delete_own
on public.atlas_navigation_history for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.atlas_navigation_history from public, anon;
grant select, insert, update, delete on table public.atlas_navigation_history to authenticated;
grant all on table public.atlas_navigation_history to service_role;

comment on table public.atlas_navigation_history is
  'Private per-account navigation history synchronized across NAV KURD devices.';

notify pgrst, 'reload schema';
commit;
