-- NAV KURD 10.0.2: owner-approved UI and notification wording only.
-- Existing rows, permissions, search normalization and function logic are unchanged.
BEGIN;

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
    when 'bug' then 'ڕاپۆرتی کێشە/هەڵەی نوێ'
    when 'data' then 'ڕاپۆرتی نوێی داتای نەخشە'
    when 'place' then 'ڕاپۆرتی نوێی ناو یان شوێن'
    when 'search' then 'ڕاپۆرتی نوێی گەڕان'
    when 'login' then 'ڕاپۆرتی نوێی چوونەژوورەوە'
    when 'offline' then 'ڕاپۆرتی نوێی دەرھێڵ'
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
    'ڕاپۆرتەکان لە ڕووکاری بەڕێوەبەرەوە ببینە.',
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
      'شوێنەکەت بۆ پێداچوونەوە نێردرا',
      'تم إرسال مكانك للمراجعة',
      'Your place was submitted for review',
      new.name_ku, new.name_ar, new.name_en
    );
  end if;
  return new;
end;
$$;

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
      'دەستکارییەکەت بۆ پێداچوونەوە نێردرا',
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
      'شوێنێکی نوێ بۆ پێداچوونەوە نێردرا', 'تم إرسال مكان جديد للمراجعة', 'A new place was submitted for review',
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
        'شوێنێک دووبارە بۆ پێداچوونەوە نێردرا', 'أعيد إرسال مكان للمراجعة', 'A place was resubmitted for review',
        new.name_ku, new.name_ar, new.name_en
      );
    end if;
  end if;
  return new;
end;
$$;

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
      'دەستکاریی شوێنێک بۆ پێداچوونەوە نێردرا', 'تم إرسال تعديل مكان للمراجعة', 'A place edit was submitted for review',
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

create or replace function public.review_atlas_place(
  p_place_id uuid,
  p_decision text,
  p_note text default null
)
returns public.atlas_places
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_places;
  result public.atlas_places;
  decision text := lower(btrim(p_decision));
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null or not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  if note_value is not null and (char_length(note_value) > 1200 or public.atlas_word_count(note_value) > 220) then
    raise exception 'Review note exceeds NAV KURD limits';
  end if;

  select * into target from public.atlas_places where id = p_place_id for update;
  if target.id is null then raise exception 'Place not found.'; end if;
  if target.submission_source <> 'user' or target.review_status <> 'pending' then
    raise exception 'Only pending user submissions can be reviewed';
  end if;

  if decision = 'approve' then
    update public.atlas_places
    set review_status = 'approved', status = 'published', review_note = null, reviewed_by = uid, reviewed_at = now()
    where id = p_place_id returning * into result;
    insert into public.atlas_notifications(user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.id, 'approved',
      'شوێنەکەت پەسەند کرا', 'تمت الموافقة على مكانك', 'Your place was approved',
      target.name_ku, coalesce(target.name_ar, target.name_ku), coalesce(target.name_en, target.name_ku)
    );
  else
    update public.atlas_places
    set review_status = 'rejected', status = 'draft', review_note = note_value, reviewed_by = uid, reviewed_at = now()
    where id = p_place_id returning * into result;
    insert into public.atlas_notifications(user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en)
    values (
      target.created_by, target.id, 'rejected',
      'داواکارییەکەت پێویستی بە دەستکاری هەیە', 'طلبك يحتاج إلى تعديل', 'Your submission needs changes',
      coalesce(note_value, target.name_ku),
      coalesce(note_value, coalesce(target.name_ar, target.name_ku)),
      coalesce(note_value, coalesce(target.name_en, target.name_ku))
    );
  end if;
  return result;
end;
$$;

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
  if target_place.id is null then raise exception 'Place not found.'; end if;
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

create or replace function public.review_atlas_place_with_media(
  p_reviewer_id uuid,
  p_place_id uuid,
  p_decision text,
  p_note text default null,
  p_media_map jsonb default '[]'::jsonb
)
returns public.atlas_places
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.atlas_places;
  result public.atlas_places;
  decision text := lower(btrim(coalesce(p_decision, '')));
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
  item jsonb;
  photo_id uuid;
  old_path text;
  new_path text;
  promoted_id uuid;
begin
  if p_reviewer_id is null or not exists (
    select 1 from public.atlas_owners where user_id = p_reviewer_id
  ) then raise exception 'Administrator access required'; end if;
  if decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;
  if note_value is not null
     and (char_length(note_value) > 1200 or public.atlas_word_count(note_value) > 220)
  then raise exception 'Review note exceeds NAV KURD limits'; end if;
  if p_media_map is null or jsonb_typeof(p_media_map) <> 'array' then
    raise exception 'Media promotion map must be an array';
  end if;

  select * into target from public.atlas_places where id = p_place_id for update;
  if target.id is null then raise exception 'Place not found.'; end if;
  if target.submission_source <> 'user' or target.review_status <> 'pending' then
    raise exception 'Only pending user submissions can be reviewed';
  end if;

  perform set_config('nav_kurd.workflow_action', 'review_place', true);

  if decision = 'approve' then
    for item in select value from jsonb_array_elements(p_media_map) loop
      begin
        photo_id := (item->>'photo_id')::uuid;
      exception when others then
        raise exception 'Invalid media photo identifier';
      end;
      old_path := btrim(coalesce(item->>'old_path', ''));
      new_path := btrim(coalesce(item->>'new_path', ''));
      if old_path !~ ('^users/' || target.created_by::text || '/places/' || p_place_id::text || '/[A-Za-z0-9._-]{1,180}$')
         or new_path !~ ('^places/' || p_place_id::text || '/[A-Za-z0-9._-]{1,220}$')
      then raise exception 'Invalid media promotion path'; end if;
      if not exists (
        select 1 from storage.objects
        where bucket_id = 'kri-place-media-private' and name = old_path
      ) then raise exception 'Private media object is missing'; end if;
      if not exists (
        select 1 from storage.objects
        where bucket_id = 'kri-place-media' and name = new_path
      ) then raise exception 'Promoted public media object is missing'; end if;

      promoted_id := null;
      update public.atlas_place_photos
      set storage_bucket = 'kri-place-media', storage_path = new_path
      where id = photo_id and place_id = p_place_id
        and storage_bucket = 'kri-place-media-private' and storage_path = old_path
      returning id into promoted_id;
      if promoted_id is null then
        raise exception 'Media promotion row does not match current private data';
      end if;

      if target.cover_photo_path = old_path then
        target.cover_photo_path := new_path;
        target.cover_photo_bucket := 'kri-place-media';
      end if;
    end loop;

    if exists (
      select 1 from public.atlas_place_photos
      where place_id = p_place_id and storage_bucket = 'kri-place-media-private'
    ) then raise exception 'Every private draft photo must be promoted before approval'; end if;

    update public.atlas_places
    set cover_photo_path = target.cover_photo_path,
        cover_photo_bucket = target.cover_photo_bucket,
        review_status = 'approved', status = 'published', review_note = null,
        reviewed_by = p_reviewer_id, reviewed_at = now()
    where id = p_place_id
    returning * into result;

    insert into public.atlas_notifications(
      user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      target.created_by, target.id, 'approved',
      'شوێنەکەت پەسەند کرا', 'تمت الموافقة على مكانك', 'Your place was approved',
      target.name_ku, coalesce(target.name_ar, target.name_ku), coalesce(target.name_en, target.name_ku)
    );
  else
    if jsonb_array_length(p_media_map) <> 0 then
      raise exception 'Rejected submissions must not include media promotions';
    end if;
    update public.atlas_places
    set review_status = 'rejected', status = 'draft', review_note = note_value,
        reviewed_by = p_reviewer_id, reviewed_at = now()
    where id = p_place_id
    returning * into result;

    insert into public.atlas_notifications(
      user_id, place_id, kind, title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      target.created_by, target.id, 'rejected',
      'داواکارییەکەت پێویستی بە دەستکاری هەیە',
      'طلبك يحتاج إلى تعديل',
      'Your submission needs changes',
      target.name_ku, coalesce(target.name_ar, target.name_ku), coalesce(target.name_en, target.name_ku)
    );
  end if;
  return result;
end;
$$;

COMMIT;
