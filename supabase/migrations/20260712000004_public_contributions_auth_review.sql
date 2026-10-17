-- NAV KURD 2027 — Google-authenticated public contributions, moderation, notifications and legal acceptance.
-- Safe, additive and rerunnable. Existing published places remain published and admin-owned.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- User profiles and legal acceptance
-- ---------------------------------------------------------------------------
create table if not exists public.atlas_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'ku' check (locale in ('ku','ar','en')),
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.atlas_user_profiles enable row level security;

drop policy if exists "atlas profiles own read" on public.atlas_user_profiles;
create policy "atlas profiles own read" on public.atlas_user_profiles
for select to authenticated
using (user_id = (select auth.uid()) or public.is_atlas_owner());

drop policy if exists "atlas profiles own insert" on public.atlas_user_profiles;
drop policy if exists "atlas profiles own update" on public.atlas_user_profiles;
drop policy if exists "atlas profiles admin update" on public.atlas_user_profiles;
create policy "atlas profiles admin update" on public.atlas_user_profiles
for update to authenticated
using (public.is_atlas_owner())
with check (public.is_atlas_owner());

-- ---------------------------------------------------------------------------
-- Moderation fields on places
-- ---------------------------------------------------------------------------
alter table public.atlas_places
  add column if not exists submission_source text not null default 'admin',
  add column if not exists review_status text not null default 'approved',
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

update public.atlas_places
set submission_source = 'admin', review_status = 'approved'
where submission_source is null or review_status is null;

alter table public.atlas_places drop constraint if exists atlas_places_submission_source_check;
alter table public.atlas_places
  add constraint atlas_places_submission_source_check
  check (submission_source in ('admin','user'));

alter table public.atlas_places drop constraint if exists atlas_places_review_status_check;
alter table public.atlas_places
  add constraint atlas_places_review_status_check
  check (review_status in ('pending','approved','rejected','withdrawn'));

create index if not exists atlas_places_creator_review_idx
  on public.atlas_places(created_by, review_status, updated_at desc);
create index if not exists atlas_places_review_queue_idx
  on public.atlas_places(review_status, updated_at desc)
  where submission_source = 'user';

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.atlas_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid references public.atlas_places(id) on delete cascade,
  kind text not null check (kind in ('approved','rejected','withdrawn','system')),
  title_ku text not null,
  title_ar text not null,
  title_en text not null,
  body_ku text,
  body_ar text,
  body_en text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists atlas_notifications_user_unread_idx
  on public.atlas_notifications(user_id, is_read, created_at desc);

alter table public.atlas_notifications enable row level security;

drop policy if exists "atlas notifications own read" on public.atlas_notifications;
create policy "atlas notifications own read" on public.atlas_notifications
for select to authenticated
using (user_id = (select auth.uid()) or public.is_atlas_owner());

drop policy if exists "atlas notifications own update" on public.atlas_notifications;
create policy "atlas notifications own update" on public.atlas_notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Account-deletion requests (privacy baseline)
-- ---------------------------------------------------------------------------
create table if not exists public.atlas_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, status)
);

alter table public.atlas_account_deletion_requests enable row level security;

drop policy if exists "atlas deletion request own read" on public.atlas_account_deletion_requests;
create policy "atlas deletion request own read" on public.atlas_account_deletion_requests
for select to authenticated
using (user_id = (select auth.uid()) or public.is_atlas_owner());

drop policy if exists "atlas deletion request own insert" on public.atlas_account_deletion_requests;
create policy "atlas deletion request own insert" on public.atlas_account_deletion_requests
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "atlas deletion request admin update" on public.atlas_account_deletion_requests;
create policy "atlas deletion request admin update" on public.atlas_account_deletion_requests
for update to authenticated
using (public.is_atlas_owner())
with check (public.is_atlas_owner());

-- ---------------------------------------------------------------------------
-- Updated timestamp for profiles
-- ---------------------------------------------------------------------------
drop trigger if exists atlas_user_profiles_updated_at on public.atlas_user_profiles;
create trigger atlas_user_profiles_updated_at
before update on public.atlas_user_profiles
for each row execute function public.set_atlas_updated_at();

-- ---------------------------------------------------------------------------
-- Guard non-admin writes at the database boundary.
-- Users can never publish themselves, approve themselves, change ownership,
-- or edit another user's place. Rejected edits return to the pending queue.
-- ---------------------------------------------------------------------------
create or replace function public.guard_atlas_place_user_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if public.is_atlas_owner() then
    return new;
  end if;

  if uid is null then
    raise exception 'Authentication required';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := uid;
    new.submission_source := 'user';
    new.status := 'draft';
    new.review_status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  if old.created_by is distinct from uid or old.submission_source <> 'user' then
    raise exception 'You cannot edit another user''s place';
  end if;

  if old.review_status = 'approved' or old.status = 'published' then
    raise exception 'Approved places require administrator review for further changes';
  end if;

  new.created_by := old.created_by;
  new.submission_source := 'user';
  new.status := 'draft';
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;

  if old.review_status = 'rejected' then
    new.review_status := 'pending';
    new.review_note := null;
  elsif new.review_status not in ('pending','withdrawn') then
    new.review_status := old.review_status;
  end if;

  return new;
end;
$$;

drop trigger if exists atlas_places_guard_user_write on public.atlas_places;
create trigger atlas_places_guard_user_write
before insert or update on public.atlas_places
for each row execute function public.guard_atlas_place_user_write();

-- ---------------------------------------------------------------------------
-- Replace place RLS policies with strict public / own / admin separation.
-- ---------------------------------------------------------------------------
drop policy if exists "atlas places public read" on public.atlas_places;
drop policy if exists "atlas places owner write" on public.atlas_places;
drop policy if exists "atlas places read published own or admin" on public.atlas_places;
drop policy if exists "atlas places user insert" on public.atlas_places;
drop policy if exists "atlas places user update own reviewable" on public.atlas_places;
drop policy if exists "atlas places admin delete" on public.atlas_places;

create policy "atlas places read published own or admin" on public.atlas_places
for select
using (
  status = 'published'
  or public.is_atlas_owner()
  or created_by = (select auth.uid())
);

create policy "atlas places user insert" on public.atlas_places
for insert to authenticated
with check (
  public.is_atlas_owner()
  or (
    created_by = (select auth.uid())
    and submission_source = 'user'
    and status = 'draft'
    and review_status = 'pending'
  )
);

create policy "atlas places user update own reviewable" on public.atlas_places
for update to authenticated
using (
  public.is_atlas_owner()
  or (
    created_by = (select auth.uid())
    and submission_source = 'user'
    and status = 'draft'
    and review_status in ('pending','rejected','withdrawn')
  )
)
with check (
  public.is_atlas_owner()
  or (
    created_by = (select auth.uid())
    and submission_source = 'user'
    and status = 'draft'
    and review_status in ('pending','rejected','withdrawn')
  )
);

create policy "atlas places admin delete" on public.atlas_places
for delete to authenticated
using (public.is_atlas_owner());

-- ---------------------------------------------------------------------------
-- Photo RLS: public sees only published-parent photos; users see and manage
-- their own unapproved submission photos; admins manage all.
-- ---------------------------------------------------------------------------
drop policy if exists "atlas photos public read" on public.atlas_place_photos;
drop policy if exists "atlas photos owner write" on public.atlas_place_photos;
drop policy if exists "atlas photos read public own or admin" on public.atlas_place_photos;
drop policy if exists "atlas photos user insert own place" on public.atlas_place_photos;
drop policy if exists "atlas photos user update own place" on public.atlas_place_photos;
drop policy if exists "atlas photos user delete own place" on public.atlas_place_photos;

create policy "atlas photos read public own or admin" on public.atlas_place_photos
for select
using (
  public.is_atlas_owner()
  or exists (
    select 1 from public.atlas_places p
    where p.id = place_id
      and (p.status = 'published' or p.created_by = (select auth.uid()))
  )
);

create policy "atlas photos user insert own place" on public.atlas_place_photos
for insert to authenticated
with check (
  public.is_atlas_owner()
  or exists (
    select 1 from public.atlas_places p
    where p.id = place_id
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

create policy "atlas photos user update own place" on public.atlas_place_photos
for update to authenticated
using (
  public.is_atlas_owner()
  or exists (
    select 1 from public.atlas_places p
    where p.id = place_id
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
)
with check (
  public.is_atlas_owner()
  or exists (
    select 1 from public.atlas_places p
    where p.id = place_id
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

create policy "atlas photos user delete own place" on public.atlas_place_photos
for delete to authenticated
using (
  public.is_atlas_owner()
  or exists (
    select 1 from public.atlas_places p
    where p.id = place_id
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

-- ---------------------------------------------------------------------------
-- Storage write policy for user-owned media paths:
-- users/<auth.uid()>/places/<place-id>/<uuid>.<ext>
-- Existing admin policies remain valid for owners.
-- ---------------------------------------------------------------------------
drop policy if exists "atlas media user insert own path" on storage.objects;
create policy "atlas media user insert own path" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'kri-place-media'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

drop policy if exists "atlas media user update own path" on storage.objects;
create policy "atlas media user update own path" on storage.objects
for update to authenticated
using (
  bucket_id = 'kri-place-media'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
)
with check (
  bucket_id = 'kri-place-media'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

drop policy if exists "atlas media user delete own path" on storage.objects;
create policy "atlas media user delete own path" on storage.objects
for delete to authenticated
using (
  bucket_id = 'kri-place-media'
  and (storage.foldername(name))[1] = 'users'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] = 'places'
  and exists (
    select 1 from public.atlas_places p
    where p.id::text = (storage.foldername(name))[4]
      and p.created_by = (select auth.uid())
      and p.submission_source = 'user'
      and p.status = 'draft'
      and p.review_status <> 'approved'
  )
);

-- ---------------------------------------------------------------------------
-- Legal acceptance RPC
-- ---------------------------------------------------------------------------
create or replace function public.accept_atlas_legal_terms(
  p_locale text default 'ku',
  p_display_name text default null,
  p_avatar_url text default null
)
returns public.atlas_user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result public.atlas_user_profiles;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  insert into public.atlas_user_profiles (
    user_id, display_name, avatar_url, locale, terms_accepted_at, privacy_accepted_at
  ) values (
    uid,
    nullif(trim(p_display_name), ''),
    nullif(trim(p_avatar_url), ''),
    case when p_locale in ('ku','ar','en') then p_locale else 'ku' end,
    now(),
    now()
  )
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, public.atlas_user_profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.atlas_user_profiles.avatar_url),
    locale = excluded.locale,
    terms_accepted_at = now(),
    privacy_accepted_at = now(),
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- User withdrawal RPC
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_atlas_place_submission(p_place_id uuid)
returns public.atlas_places
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result public.atlas_places;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  update public.atlas_places
  set review_status = 'withdrawn', status = 'draft', review_note = null, reviewed_by = null, reviewed_at = null
  where id = p_place_id
    and created_by = uid
    and submission_source = 'user'
    and review_status in ('pending','rejected')
  returning * into result;

  if result.id is null then raise exception 'This submission cannot be withdrawn'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin moderation RPC. Only atlas_owners can call successfully.
-- Approval publishes; rejection returns the item to the user with a notification.
-- ---------------------------------------------------------------------------
create or replace function public.review_atlas_place(
  p_place_id uuid,
  p_decision text,
  p_note text default null
)
returns public.atlas_places
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_places;
  result public.atlas_places;
  decision text := lower(trim(p_decision));
begin
  if not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;

  select * into target from public.atlas_places where id = p_place_id for update;
  if target.id is null then raise exception 'Place not found'; end if;
  if target.submission_source <> 'user' then raise exception 'Only user submissions use the review queue'; end if;

  if decision = 'approve' then
    update public.atlas_places
    set review_status = 'approved', status = 'published', review_note = null, reviewed_by = uid, reviewed_at = now()
    where id = p_place_id
    returning * into result;

    insert into public.atlas_notifications(user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.id, 'approved',
      'شوێنەکەت پەسەند کرا', 'تمت الموافقة على مكانك', 'Your place was approved',
      target.name_ku, coalesce(target.name_ar, target.name_ku), coalesce(target.name_en, target.name_ku)
    );
  else
    update public.atlas_places
    set review_status = 'rejected', status = 'draft', review_note = nullif(trim(p_note), ''), reviewed_by = uid, reviewed_at = now()
    where id = p_place_id
    returning * into result;

    insert into public.atlas_notifications(user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.id, 'rejected',
      'داواکارییەکەت پێویستی بە دەستکاری هەیە', 'طلبك يحتاج إلى تعديل', 'Your submission needs changes',
      coalesce(nullif(trim(p_note), ''), target.name_ku),
      coalesce(nullif(trim(p_note), ''), coalesce(target.name_ar, target.name_ku)),
      coalesce(nullif(trim(p_note), ''), coalesce(target.name_en, target.name_ku))
    );
  end if;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on public.atlas_user_profiles to authenticated;
grant select, update on public.atlas_notifications to authenticated;
grant select, insert, update on public.atlas_account_deletion_requests to authenticated;
revoke all on function public.accept_atlas_legal_terms(text,text,text) from public;
revoke all on function public.withdraw_atlas_place_submission(uuid) from public;
revoke all on function public.review_atlas_place(uuid,text,text) from public;
grant execute on function public.accept_atlas_legal_terms(text,text,text) to authenticated;
grant execute on function public.withdraw_atlas_place_submission(uuid) to authenticated;
grant execute on function public.review_atlas_place(uuid,text,text) to authenticated;

-- Realtime refresh for user dashboards and review notifications.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atlas_notifications'
  ) then
    alter publication supabase_realtime add table public.atlas_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
