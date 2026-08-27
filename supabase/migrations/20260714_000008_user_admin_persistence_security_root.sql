-- NAV KURD 2027 — user/admin persistence, notification lifecycle and audit hardening.
-- Applies after 20260714_000007_contribution_form_quality_root.sql.
--
-- Guarantees:
--   * admins can identify the submitter of review items without exposing other profiles to ordinary users;
--   * notification read state is durable, one-way (old items never become unread again) and recipient-scoped;
--   * recipients may delete only their own already-read notifications;
--   * material place/revision workflow changes are recorded in an append-only audit stream;
--   * ordinary users still cannot modify/delete another user's content or self-approve;
--   * public visitors continue to see approved published places only.

-- ---------------------------------------------------------------------------
-- 1) Reviewer identity: owner/admin may read contributor display name + avatar.
-- ---------------------------------------------------------------------------
alter table public.atlas_user_profiles enable row level security;

drop policy if exists "atlas profiles admin read" on public.atlas_user_profiles;
create policy "atlas profiles admin read" on public.atlas_user_profiles
for select to authenticated
using (public.is_atlas_owner());

grant select on public.atlas_user_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Ordinary-user withdrawal of an already approved place.
--    This is different from editing: an approved edit remains public while a
--    revision waits for review, but an explicit withdrawal immediately removes
--    the owner's own place from public visibility.
-- ---------------------------------------------------------------------------
create or replace function public.guard_atlas_place_user_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  workflow text := coalesce(current_setting('nav_kurd.workflow_action', true), '');
begin
  if public.is_atlas_owner() then return new; end if;
  if uid is null then raise exception 'Authentication required'; end if;

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

  if workflow = 'withdraw_approved_place' then
    if old.review_status <> 'approved' or old.status <> 'published'
       or new.review_status <> 'withdrawn' or new.status <> 'draft' then
      raise exception 'This approved place cannot be withdrawn';
    end if;
    new.created_by := old.created_by;
    new.submission_source := 'user';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  if old.review_status = 'approved' or old.status = 'published' then
    raise exception 'Approved places must be edited through a separate review revision';
  end if;

  new.created_by := old.created_by;
  new.submission_source := 'user';
  new.status := 'draft';
  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;

  if workflow = 'withdraw_submission' then
    if old.review_status not in ('pending','rejected') or new.review_status <> 'withdrawn' then
      raise exception 'This submission cannot be withdrawn';
    end if;
    return new;
  end if;

  new.review_status := 'pending';
  return new;
end;
$$;

revoke all on function public.guard_atlas_place_user_write() from public, anon, authenticated;

drop policy if exists "atlas places regular user withdraw approved" on public.atlas_places;
create policy "atlas places regular user withdraw approved" on public.atlas_places
for update to authenticated
using (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'published'
  and review_status = 'approved'
)
with check (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'draft'
  and review_status = 'withdrawn'
);

create or replace function public.withdraw_atlas_approved_place(p_place_id uuid)
returns public.atlas_places
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  result public.atlas_places;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if public.is_atlas_owner() then raise exception 'Administrator accounts cannot use ordinary-user withdrawal'; end if;

  perform set_config('nav_kurd.workflow_action', 'withdraw_approved_place', true);
  update public.atlas_places
  set review_status = 'withdrawn', status = 'draft', review_note = null, reviewed_by = null, reviewed_at = null
  where id = p_place_id
    and created_by = uid
    and submission_source = 'user'
    and review_status = 'approved'
    and status = 'published'
  returning * into result;

  if result.id is null then raise exception 'This approved place cannot be withdrawn'; end if;
  return result;
end;
$$;

revoke all on function public.withdraw_atlas_approved_place(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_atlas_approved_place(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Media-count boundary. UI/service checks are advisory; the database remains
--    authoritative and rejects a thirteenth image for the same place.
-- ---------------------------------------------------------------------------
create or replace function public.guard_atlas_place_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' and (
    select count(*) from public.atlas_place_photos where place_id = new.place_id
  ) >= 12 then
    raise exception 'A place can contain no more than 12 images';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_atlas_place_photo_limit() from public, anon, authenticated;
drop trigger if exists atlas_place_photos_guard_limit on public.atlas_place_photos;
create trigger atlas_place_photos_guard_limit
before insert on public.atlas_place_photos
for each row execute function public.guard_atlas_place_photo_limit();

-- ---------------------------------------------------------------------------
-- 4) Durable notification lifecycle.
-- ---------------------------------------------------------------------------
alter table public.atlas_notifications
  add column if not exists read_at timestamptz;

update public.atlas_notifications
set read_at = coalesce(read_at, created_at)
where is_read = true and read_at is null;

create index if not exists atlas_notifications_user_created_idx
  on public.atlas_notifications(user_id, created_at desc);

create or replace function public.guard_atlas_notification_recipient_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A persisted notification belongs to one recipient and its content/lifecycle
  -- identifiers are immutable. The only client-editable state is unread -> read.
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.place_id is distinct from old.place_id
     or new.revision_id is distinct from old.revision_id
     or new.kind is distinct from old.kind
     or new.title_ku is distinct from old.title_ku
     or new.title_ar is distinct from old.title_ar
     or new.title_en is distinct from old.title_en
     or new.body_ku is distinct from old.body_ku
     or new.body_ar is distinct from old.body_ar
     or new.body_en is distinct from old.body_en
     or new.created_at is distinct from old.created_at then
    raise exception 'Notification content and ownership are immutable';
  end if;

  if old.is_read = true and new.is_read = false then
    raise exception 'A read notification cannot become unread again';
  end if;

  if old.is_read = false and new.is_read = true then
    new.read_at := coalesce(new.read_at, now());
  elsif old.is_read = new.is_read then
    new.read_at := old.read_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_atlas_notification_recipient_update() from public, anon, authenticated;
drop trigger if exists atlas_notifications_guard_recipient_update on public.atlas_notifications;
create trigger atlas_notifications_guard_recipient_update
before update on public.atlas_notifications
for each row execute function public.guard_atlas_notification_recipient_update();

-- Replace notification policies with strict recipient-scoped lifecycle rules.
drop policy if exists "atlas notifications own read" on public.atlas_notifications;
drop policy if exists "atlas notifications own update" on public.atlas_notifications;
drop policy if exists "atlas notifications own delete read" on public.atlas_notifications;
drop policy if exists "atlas notifications admin insert" on public.atlas_notifications;

create policy "atlas notifications own read" on public.atlas_notifications
for select to authenticated
using (user_id = (select auth.uid()));

create policy "atlas notifications own update" on public.atlas_notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "atlas notifications own delete read" on public.atlas_notifications
for delete to authenticated
using (user_id = (select auth.uid()) and is_read = true);

create policy "atlas notifications admin insert" on public.atlas_notifications
for insert to authenticated
with check (public.is_atlas_owner());

-- Column-level privilege ensures browser clients cannot mutate notification content.
revoke update on public.atlas_notifications from authenticated;
grant update (is_read) on public.atlas_notifications to authenticated;
grant select, insert, delete on public.atlas_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Append-only workflow audit. No direct browser write privilege exists.
--    Actor IDs become NULL on account deletion so the user's personal identity is
--    not retained after erasure, while non-personal operational history remains.
-- ---------------------------------------------------------------------------
create table if not exists public.atlas_activity_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'place_submitted','place_updated','place_approved','place_rejected',
    'place_withdrawn','place_deleted','revision_submitted','revision_approved',
    'revision_rejected','revision_withdrawn'
  )),
  place_id uuid,
  revision_id uuid,
  source text not null default 'database' check (source in ('database','edge_function')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists atlas_activity_audit_place_idx on public.atlas_activity_audit(place_id, created_at desc);
create index if not exists atlas_activity_audit_created_idx on public.atlas_activity_audit(created_at desc);

alter table public.atlas_activity_audit enable row level security;
drop policy if exists "atlas audit admin read" on public.atlas_activity_audit;
create policy "atlas audit admin read" on public.atlas_activity_audit
for select to authenticated using (public.is_atlas_owner());

revoke all on public.atlas_activity_audit from public, anon, authenticated;
grant select on public.atlas_activity_audit to authenticated;

create or replace function public.audit_atlas_place_workflow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_action text;
  event_actor uuid;
  event_place uuid;
  event_details jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    event_action := 'place_submitted';
    event_actor := new.created_by;
    event_place := new.id;
    event_details := jsonb_build_object('submission_source', new.submission_source, 'review_status', new.review_status);
  elsif tg_op = 'DELETE' then
    event_action := 'place_deleted';
    event_actor := coalesce(auth.uid(), old.created_by);
    event_place := old.id;
    event_details := jsonb_build_object('submission_source', old.submission_source, 'review_status', old.review_status);
  else
    event_actor := coalesce(auth.uid(), new.reviewed_by, new.created_by);
    event_place := new.id;
    if old.review_status is distinct from new.review_status then
      event_action := case new.review_status
        when 'approved' then 'place_approved'
        when 'rejected' then 'place_rejected'
        when 'withdrawn' then 'place_withdrawn'
        else 'place_updated'
      end;
    elsif old.updated_at is distinct from new.updated_at then
      event_action := 'place_updated';
    else
      return new;
    end if;
    event_details := jsonb_build_object('from_review_status', old.review_status, 'to_review_status', new.review_status);
  end if;

  insert into public.atlas_activity_audit(actor_id, action, place_id, source, details)
  values (event_actor, event_action, event_place, 'database', event_details);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_atlas_place_workflow() from public, anon, authenticated;
drop trigger if exists atlas_places_audit_workflow on public.atlas_places;
create trigger atlas_places_audit_workflow
after insert or update or delete on public.atlas_places
for each row execute function public.audit_atlas_place_workflow();

create or replace function public.audit_atlas_revision_workflow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_action text;
  event_actor uuid;
begin
  if tg_op = 'INSERT' then
    event_action := 'revision_submitted';
    event_actor := new.created_by;
  elsif old.review_status is distinct from new.review_status then
    event_action := case new.review_status
      when 'approved' then 'revision_approved'
      when 'rejected' then 'revision_rejected'
      when 'withdrawn' then 'revision_withdrawn'
      else null
    end;
    event_actor := coalesce(auth.uid(), new.reviewed_by, new.created_by);
  else
    return new;
  end if;

  if event_action is not null then
    insert into public.atlas_activity_audit(actor_id, action, place_id, revision_id, source, details)
    values (
      event_actor,
      event_action,
      new.place_id,
      new.id,
      'database',
      jsonb_build_object('review_status', new.review_status, 'revision_no', new.revision_no)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_atlas_revision_workflow() from public, anon, authenticated;
drop trigger if exists atlas_revisions_audit_workflow on public.atlas_place_revisions;
create trigger atlas_revisions_audit_workflow
after insert or update on public.atlas_place_revisions
for each row execute function public.audit_atlas_revision_workflow();

-- ---------------------------------------------------------------------------
-- 6) Explicitly preserve the core authorization invariants.
-- ---------------------------------------------------------------------------
-- Public reads only approved published places. Ordinary users can read their own
-- submissions; admins can read everything through the existing separate policies.
-- No ordinary-user DELETE policy is added for atlas_places: user deletion is routed
-- through the authenticated delete-atlas-place Edge Function, which validates owner,
-- role and confirmation before using service-role authority.

notify pgrst, 'reload schema';
