-- NAV KURD 2027 — Google-only authentication, feedback workflow and notification closure.
-- Applies after 20260716_000009_nav_kurd_root_clean.sql.
--
-- Guarantees:
--   * an existing administrator remains an administrator after signing in with Google
--     using the same verified email address;
--   * ordinary users and administrators both authenticate through Google OAuth;
--   * feedback is authenticated, rate-limited, recipient-scoped and reviewable;
--   * users receive durable in-app confirmation when a place or edit enters review;
--   * approval/rejection notifications preserve exact language fields without copying
--     Kurdish names into Arabic or English fields;
--   * approved-place edits continue through revision review, while user-owned place
--     deletion remains an immediate authenticated server-side operation.

begin;

create schema if not exists nav_kurd_private;
revoke all on schema nav_kurd_private from public, anon, authenticated;
grant usage on schema nav_kurd_private to service_role;

-- ---------------------------------------------------------------------------
-- 1) Preserve administrator authorization across Google identities.
-- ---------------------------------------------------------------------------
create table if not exists nav_kurd_private.atlas_owner_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  check (email = lower(btrim(email)) and char_length(email) between 3 and 320)
);

revoke all on table nav_kurd_private.atlas_owner_emails from public, anon, authenticated;
grant select, insert, update, delete on table nav_kurd_private.atlas_owner_emails to service_role;

-- Capture the verified email of every administrator that already exists. No email is
-- exposed to browser roles: this allow-list lives in the private schema.
insert into nav_kurd_private.atlas_owner_emails(email)
select distinct lower(btrim(u.email))
from public.atlas_owners o
join auth.users u on u.id = o.user_id
where u.email is not null and btrim(u.email) <> ''
on conflict (email) do nothing;

create or replace function nav_kurd_private.sync_atlas_owner_from_verified_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, nav_kurd_private
as $$
declare
  normalized_email text := lower(btrim(coalesce(new.email, '')));
begin
  if normalized_email <> '' and exists (
    select 1 from nav_kurd_private.atlas_owner_emails a where a.email = normalized_email
  ) then
    insert into public.atlas_owners(user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function nav_kurd_private.sync_atlas_owner_from_verified_email() from public, anon, authenticated;

drop trigger if exists nav_kurd_sync_owner_from_email on auth.users;
create trigger nav_kurd_sync_owner_from_email
after insert or update of email on auth.users
for each row execute function nav_kurd_private.sync_atlas_owner_from_verified_email();

-- Backfill a Google identity that may already exist before this migration is applied.
insert into public.atlas_owners(user_id)
select u.id
from auth.users u
join nav_kurd_private.atlas_owner_emails a on a.email = lower(btrim(u.email))
where u.email is not null
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Authenticated feedback with bounded diagnostics and strict RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.atlas_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  message text not null,
  diagnostics jsonb not null default '{}'::jsonb,
  locale text not null default 'ku',
  app_version text not null,
  map_data_version text not null,
  status text not null default 'new',
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_feedback_category_check check (category in ('bug','data','place','search','login','offline','gps','ui','other')),
  constraint atlas_feedback_message_limit check (char_length(btrim(message)) between 20 and 2000),
  constraint atlas_feedback_diagnostics_shape check (jsonb_typeof(diagnostics) = 'object' and octet_length(diagnostics::text) <= 32768),
  constraint atlas_feedback_locale_check check (locale in ('ku','ar','en')),
  constraint atlas_feedback_version_limits check (char_length(app_version) between 1 and 120 and char_length(map_data_version) between 1 and 180),
  constraint atlas_feedback_status_check check (status in ('new','in_progress','resolved','closed')),
  constraint atlas_feedback_admin_note_limit check (admin_note is null or char_length(admin_note) <= 1200)
);

create index if not exists atlas_feedback_user_created_idx on public.atlas_feedback(user_id, created_at desc);
create index if not exists atlas_feedback_status_created_idx on public.atlas_feedback(status, created_at desc);

drop trigger if exists atlas_feedback_updated_at on public.atlas_feedback;
create trigger atlas_feedback_updated_at
before update on public.atlas_feedback
for each row execute function public.set_atlas_updated_at();

alter table public.atlas_feedback enable row level security;

drop policy if exists "atlas feedback recipient read" on public.atlas_feedback;
create policy "atlas feedback recipient read" on public.atlas_feedback
for select to authenticated
using (user_id = (select auth.uid()) or public.is_atlas_owner());

-- Browser clients cannot insert/update/delete feedback rows directly. All writes go
-- through the bounded RPCs below.
revoke all on table public.atlas_feedback from public, anon, authenticated;
grant select on table public.atlas_feedback to authenticated;
grant select, insert, update, delete on table public.atlas_feedback to service_role;

create or replace function public.submit_atlas_feedback(
  p_category text,
  p_message text,
  p_diagnostics jsonb default '{}'::jsonb,
  p_locale text default 'ku',
  p_app_version text default 'unknown',
  p_map_data_version text default 'unknown'
)
returns public.atlas_feedback
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  category_value text := lower(btrim(coalesce(p_category, '')));
  message_value text := btrim(coalesce(p_message, ''));
  locale_value text := lower(btrim(coalesce(p_locale, 'ku')));
  diagnostics_value jsonb := coalesce(p_diagnostics, '{}'::jsonb);
  result public.atlas_feedback;
  title_ku_value text;
  title_ar_value text;
  title_en_value text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if category_value not in ('bug','data','place','search','login','offline','gps','ui','other') then
    raise exception 'Invalid feedback category';
  end if;
  if char_length(message_value) < 20 or char_length(message_value) > 2000 then
    raise exception 'Feedback must contain between 20 and 2000 characters';
  end if;
  if locale_value not in ('ku','ar','en') then raise exception 'Invalid feedback locale'; end if;
  if jsonb_typeof(diagnostics_value) <> 'object' or octet_length(diagnostics_value::text) > 32768 then
    raise exception 'Feedback diagnostics are invalid or too large';
  end if;
  if char_length(btrim(coalesce(p_app_version, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_map_data_version, ''))) not between 1 and 180 then
    raise exception 'Invalid release metadata';
  end if;

  -- Per-account limits reduce spam without collecting IP addresses or adding a
  -- third-party tracking service.
  if (select count(*) from public.atlas_feedback where user_id = uid and created_at > now() - interval '5 minutes') >= 2 then
    raise exception 'Please wait before sending another feedback report';
  end if;
  if (select count(*) from public.atlas_feedback where user_id = uid and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Daily feedback limit reached';
  end if;

  insert into public.atlas_feedback(
    user_id, category, message, diagnostics, locale, app_version, map_data_version
  ) values (
    uid, category_value, message_value, diagnostics_value, locale_value,
    btrim(p_app_version), btrim(p_map_data_version)
  ) returning * into result;

  title_ku_value := case category_value
    when 'bug' then 'ڕاپۆرتی گلیچ/هەڵەی نوێ'
    when 'data' then 'ڕاپۆرتی نوێی داتای ماپ'
    when 'place' then 'ڕاپۆرتی نوێی ناو یان شوێن'
    when 'search' then 'ڕاپۆرتی نوێی گەڕان'
    when 'login' then 'ڕاپۆرتی نوێی چوونەژوورەوە'
    when 'offline' then 'ڕاپۆرتی نوێی ئۆفلاین'
    when 'gps' then 'ڕاپۆرتی نوێی GPS و ڕێنیشاندان'
    when 'ui' then 'ڕاپۆرتی نوێی UI و شاشە'
    else 'فیدباکی نوێ'
  end;
  title_ar_value := case category_value
    when 'bug' then 'بلاغ جديد عن خلل أو خطأ'
    when 'data' then 'بلاغ جديد عن بيانات الخريطة'
    when 'place' then 'بلاغ جديد عن اسم أو مكان'
    when 'search' then 'بلاغ جديد عن البحث'
    when 'login' then 'بلاغ جديد عن تسجيل الدخول'
    when 'offline' then 'بلاغ جديد عن وضع عدم الاتصال'
    when 'gps' then 'بلاغ جديد عن GPS والملاحة'
    when 'ui' then 'بلاغ جديد عن الواجهة والشاشة'
    else 'ملاحظة جديدة'
  end;
  title_en_value := case category_value
    when 'bug' then 'New bug or glitch report'
    when 'data' then 'New map-data report'
    when 'place' then 'New place or name report'
    when 'search' then 'New search report'
    when 'login' then 'New sign-in report'
    when 'offline' then 'New offline report'
    when 'gps' then 'New GPS and navigation report'
    when 'ui' then 'New UI and display report'
    else 'New feedback'
  end;

  insert into public.atlas_notifications(
    user_id, place_id, revision_id, kind,
    title_ku, title_ar, title_en, body_ku, body_ar, body_en
  )
  select o.user_id, null, null, 'feedback',
    title_ku_value, title_ar_value, title_en_value,
    'فیدباک لە داشبۆردی ئەدمینەوە ببینە.',
    'راجع الملاحظة من لوحة المشرف.',
    'Review the report from the administrator dashboard.'
  from public.atlas_owners o;

  insert into public.atlas_notifications(
    user_id, place_id, revision_id, kind,
    title_ku, title_ar, title_en, body_ku, body_ar, body_en
  ) values (
    uid, null, null, 'feedback',
    'فیدباکەکەت گەیشت', 'تم استلام ملاحظتك', 'Your feedback was received',
    'سوپاس؛ ڕاپۆرتەکەت بۆ پشکنین تۆمار کرا.',
    'شكرًا؛ تم تسجيل تقريرك للمراجعة.',
    'Thank you; your report was recorded for review.'
  );
  return result;
end;
$$;

revoke all on function public.submit_atlas_feedback(text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_atlas_feedback(text, text, jsonb, text, text, text) to authenticated;

create or replace function public.review_atlas_feedback(
  p_feedback_id uuid,
  p_status text,
  p_admin_note text default null
)
returns public.atlas_feedback
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  status_value text := lower(btrim(coalesce(p_status, '')));
  note_value text := nullif(btrim(coalesce(p_admin_note, '')), '');
  target public.atlas_feedback;
  result public.atlas_feedback;
begin
  if uid is null or not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if status_value not in ('new','in_progress','resolved','closed') then raise exception 'Invalid feedback status'; end if;
  if note_value is not null and char_length(note_value) > 1200 then raise exception 'Administrator note is too long'; end if;

  select * into target from public.atlas_feedback where id = p_feedback_id for update;
  if target.id is null then raise exception 'Feedback report not found'; end if;

  update public.atlas_feedback
  set status = status_value,
      admin_note = note_value,
      reviewed_by = uid,
      reviewed_at = case when status_value in ('resolved','closed') then now() else reviewed_at end
  where id = p_feedback_id
  returning * into result;

  if target.status is distinct from status_value and status_value in ('resolved','closed') then
    insert into public.atlas_notifications(
      user_id, place_id, revision_id, kind,
      title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      target.user_id, null, null, 'feedback',
      case when status_value = 'resolved' then 'ڕاپۆرتەکەت چارەسەر کرا' else 'ڕاپۆرتەکەت داخرا' end,
      case when status_value = 'resolved' then 'تم حل بلاغك' else 'تم إغلاق بلاغك' end,
      case when status_value = 'resolved' then 'Your report was resolved' else 'Your report was closed' end,
      null, null, null
    );
  end if;
  return result;
end;
$$;

revoke all on function public.review_atlas_feedback(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_atlas_feedback(uuid, text, text) to authenticated;

-- Notification taxonomy now includes feedback events.
alter table public.atlas_notifications drop constraint if exists atlas_notifications_kind_check;
alter table public.atlas_notifications add constraint atlas_notifications_kind_check
  check (kind in ('submitted','revision_submitted','approved','rejected','withdrawn','deleted','account_deleted','feedback','system'));

-- ---------------------------------------------------------------------------
-- 3) Submitter confirmations when a place or edit enters moderation.
-- ---------------------------------------------------------------------------
create or replace function public.notify_atlas_submitter_review_received()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.submission_source = 'user' and new.created_by is not null and new.review_status = 'pending'
     and (tg_op = 'INSERT' or old.review_status is distinct from new.review_status) then
    insert into public.atlas_notifications(
      user_id, place_id, revision_id, kind,
      title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      new.created_by, new.id, null, 'submitted',
      'شوێنەکەت بۆ ڕیڤیو نێردرا',
      'تم إرسال مكانك للمراجعة',
      'Your place was submitted for review',
      new.name_ku, new.name_ar, new.name_en
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_atlas_submitter_review_received() from public, anon, authenticated;

drop trigger if exists atlas_places_notify_submitter_received on public.atlas_places;
create trigger atlas_places_notify_submitter_received
after insert or update on public.atlas_places
for each row execute function public.notify_atlas_submitter_review_received();

create or replace function public.notify_atlas_revision_submitter_received()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.created_by is not null and new.review_status = 'pending' then
    insert into public.atlas_notifications(
      user_id, place_id, revision_id, kind,
      title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      new.created_by, new.place_id, new.id, 'revision_submitted',
      'دەستکارییەکەت بۆ ڕیڤیو نێردرا',
      'تم إرسال تعديلك للمراجعة',
      'Your edit was submitted for review',
      nullif(btrim(coalesce(new.proposed_data->>'name_ku', '')), ''),
      nullif(btrim(coalesce(new.proposed_data->>'name_ar', '')), ''),
      nullif(btrim(coalesce(new.proposed_data->>'name_en', '')), '')
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_atlas_revision_submitter_received() from public, anon, authenticated;

drop trigger if exists atlas_place_revisions_notify_submitter_received on public.atlas_place_revisions;
create trigger atlas_place_revisions_notify_submitter_received
after insert on public.atlas_place_revisions
for each row execute function public.notify_atlas_revision_submitter_received();

-- Keep administrator lifecycle notifications exact-language as well. Empty language
-- fields remain empty instead of borrowing a name from another language.
create or replace function public.notify_atlas_place_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.submission_source <> 'user' or new.created_by is null then return new; end if;
  if tg_op = 'INSERT' and new.review_status = 'pending' then
    perform public.notify_atlas_admins(
      new.id, null, 'submitted',
      'شوێنێکی نوێ بۆ ڕیڤیو نێردرا', 'تم إرسال مكان جديد للمراجعة', 'A new place was submitted for review',
      new.name_ku, new.name_ar, new.name_en
    );
  elsif tg_op = 'UPDATE' and old.review_status is distinct from new.review_status then
    if new.review_status = 'withdrawn' then
      perform public.notify_atlas_admins(
        new.id, null, 'withdrawn',
        'داواکاریی شوێن هەڵوەشێندرایەوە', 'تم سحب طلب مكان', 'A place submission was withdrawn',
        new.name_ku, new.name_ar, new.name_en
      );
    elsif new.review_status = 'pending' and old.review_status in ('rejected','withdrawn') then
      perform public.notify_atlas_admins(
        new.id, null, 'submitted',
        'شوێنێک دووبارە بۆ ڕیڤیو نێردرا', 'أعيد إرسال مكان للمراجعة', 'A place was resubmitted for review',
        new.name_ku, new.name_ar, new.name_en
      );
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_atlas_place_lifecycle() from public, anon, authenticated;

create or replace function public.notify_atlas_revision_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  place_name public.atlas_places;
begin
  select * into place_name from public.atlas_places where id = new.place_id;
  if tg_op = 'INSERT' and new.review_status = 'pending' then
    perform public.notify_atlas_admins(
      new.place_id, new.id, 'revision_submitted',
      'دەستکاریی شوێنێک بۆ ڕیڤیو نێردرا', 'تم إرسال تعديل مكان للمراجعة', 'A place edit was submitted for review',
      nullif(btrim(coalesce(new.proposed_data->>'name_ku','')), ''),
      nullif(btrim(coalesce(new.proposed_data->>'name_ar','')), ''),
      nullif(btrim(coalesce(new.proposed_data->>'name_en','')), '')
    );
  elsif tg_op = 'UPDATE' and old.review_status = 'pending' and new.review_status = 'withdrawn' then
    perform public.notify_atlas_admins(
      new.place_id, new.id, 'withdrawn',
      'دەستکاریی شوێن هەڵوەشێندرایەوە', 'تم سحب تعديل مكان', 'A place edit was withdrawn',
      place_name.name_ku, place_name.name_ar, place_name.name_en
    );
  end if;
  return new;
end;
$$;
revoke all on function public.notify_atlas_revision_lifecycle() from public, anon, authenticated;

create or replace function public.notify_user_on_admin_place_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.submission_source = 'user' and old.created_by is not null and public.is_atlas_owner() then
    insert into public.atlas_notifications(
      user_id, place_id, revision_id, kind,
      title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      old.created_by, null, null, 'deleted',
      'شوێنەکەت لەلایەن بەڕێوەبەرەوە سڕایەوە',
      'حذف المشرف مكانك',
      'Your place was deleted by an administrator',
      old.name_ku, old.name_ar, old.name_en
    );
  end if;
  return old;
end;
$$;
revoke all on function public.notify_user_on_admin_place_delete() from public, anon, authenticated;

-- Exact-language revision approval/rejection notification. The published place stays
-- live while this revision waits for review.
create or replace function public.review_atlas_place_revision(
  p_revision_id uuid,
  p_decision text,
  p_note text default null
)
returns public.atlas_place_revisions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_place_revisions;
  target_place public.atlas_places;
  result public.atlas_place_revisions;
  decision text := lower(btrim(p_decision));
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
  payload jsonb;
begin
  if uid is null or not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  if note_value is not null and (char_length(note_value) > 1200 or public.atlas_word_count(note_value) > 220) then
    raise exception 'Review note exceeds NAV KURD limits';
  end if;

  select * into target from public.atlas_place_revisions where id = p_revision_id for update;
  if target.id is null or target.review_status <> 'pending' then raise exception 'Pending revision not found'; end if;
  select * into target_place from public.atlas_places where id = target.place_id for update;
  if target_place.id is null then raise exception 'Place not found'; end if;
  payload := target.proposed_data;

  perform set_config('nav_kurd.workflow_action', 'review_revision', true);
  if decision = 'approve' then
    update public.atlas_places
    set
      name_ku = btrim(payload->>'name_ku'),
      name_ar = nullif(btrim(coalesce(payload->>'name_ar','')), ''),
      name_en = nullif(btrim(coalesce(payload->>'name_en','')), ''),
      category = payload->>'category',
      tags = array(select jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb))),
      metadata = coalesce(payload->'metadata','{}'::jsonb),
      description_ku = nullif(btrim(coalesce(payload->>'description_ku','')), ''),
      description_ar = nullif(btrim(coalesce(payload->>'description_ar','')), ''),
      description_en = nullif(btrim(coalesce(payload->>'description_en','')), ''),
      longitude = (payload->>'longitude')::double precision,
      latitude = (payload->>'latitude')::double precision,
      status = 'published', review_status = 'approved', review_note = null,
      reviewed_by = uid, reviewed_at = now()
    where id = target.place_id;

    update public.atlas_place_revisions
    set review_status = 'approved', review_note = null, reviewed_by = uid, reviewed_at = now()
    where id = target.id returning * into result;

    insert into public.atlas_notifications(user_id, place_id, revision_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.place_id, target.id, 'approved',
      'دەستکاریی شوێنەکەت پەسەند کرا',
      'تمت الموافقة على تعديل مكانك',
      'Your place edit was approved',
      nullif(btrim(coalesce(payload->>'name_ku','')), ''),
      nullif(btrim(coalesce(payload->>'name_ar','')), ''),
      nullif(btrim(coalesce(payload->>'name_en','')), '')
    );
  else
    update public.atlas_place_revisions
    set review_status = 'rejected', review_note = note_value, reviewed_by = uid, reviewed_at = now()
    where id = target.id returning * into result;

    insert into public.atlas_notifications(user_id, place_id, revision_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.place_id, target.id, 'rejected',
      'دەستکارییەکەت پێویستی بە چاککردن هەیە',
      'تعديلك يحتاج إلى تغييرات',
      'Your place edit needs changes',
      nullif(btrim(coalesce(payload->>'name_ku','')), ''),
      nullif(btrim(coalesce(payload->>'name_ar','')), ''),
      nullif(btrim(coalesce(payload->>'name_en','')), '')
    );
  end if;
  return result;
end;
$$;
revoke all on function public.review_atlas_place_revision(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_atlas_place_revision(uuid, text, text) to authenticated;

-- Add feedback to Realtime only once. RLS still controls row visibility.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'atlas_feedback'
  ) then
    alter publication supabase_realtime add table public.atlas_feedback;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
