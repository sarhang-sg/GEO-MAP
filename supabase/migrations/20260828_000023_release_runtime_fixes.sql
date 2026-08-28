-- NAV KURD 8.0.4 — release runtime fixes.
-- Repairs trusted moderation and makes translated place fields genuinely optional.

begin;

-- Empty translations carry no information. Normalize legacy empty values before
-- replacing the all-three-languages constraint with an independent-field contract.
update public.atlas_places
set name_ar = nullif(btrim(name_ar), ''),
    name_en = nullif(btrim(name_en), '')
where btrim(coalesce(name_ar, '')) = ''
   or btrim(coalesce(name_en, '')) = '';

alter table public.atlas_places alter column name_ar drop not null;
alter table public.atlas_places alter column name_en drop not null;

alter table public.atlas_places drop constraint if exists atlas_places_exact_language_names;
alter table public.atlas_places add constraint atlas_places_exact_language_names check (
  name_ku is not null
  and btrim(name_ku) <> ''
  and public.nav_kurd_text_matches_exact_language(name_ku, 'kurdish')
  and (name_ar is null or (
    btrim(name_ar) <> ''
    and public.nav_kurd_text_matches_exact_language(name_ar, 'arabic')
  ))
  and (name_en is null or (
    btrim(name_en) <> ''
    and public.nav_kurd_text_matches_exact_language(name_en, 'latin')
  ))
);

alter table public.atlas_places drop constraint if exists atlas_places_exact_language_descriptions;
alter table public.atlas_places add constraint atlas_places_exact_language_descriptions check (
  (description_ku is null or (
    btrim(description_ku) <> ''
    and public.nav_kurd_text_matches_exact_language(description_ku, 'kurdish')
  ))
  and (description_ar is null or (
    btrim(description_ar) <> ''
    and public.nav_kurd_text_matches_exact_language(description_ar, 'arabic')
  ))
  and (description_en is null or (
    btrim(description_en) <> ''
    and public.nav_kurd_text_matches_exact_language(description_en, 'latin')
  ))
);

create or replace function public.atlas_place_payload_is_valid(p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, nav_kurd_private, public
as $$
declare
  category_value text;
  tags_value jsonb;
  metadata_value jsonb;
  longitude_value double precision;
  latitude_value double precision;
  field_key text;
  field_value text;
  field_language text;
  tag_value text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(p_data) as k(key)
    where k.key not in (
      'name_ku','name_ar','name_en','category','tags','metadata',
      'description_ku','description_ar','description_en','longitude','latitude'
    )
  ) then return false; end if;

  if jsonb_typeof(p_data->'name_ku') <> 'string' then return false; end if;
  field_value := btrim(coalesce(p_data->>'name_ku', ''));
  if char_length(field_value) not between 1 and 120
     or public.atlas_word_count(field_value) > 18
     or not public.nav_kurd_text_matches_exact_language(field_value, 'kurdish')
  then return false; end if;

  foreach field_key in array array['name_ar','name_en'] loop
    if p_data ? field_key and jsonb_typeof(p_data->field_key) not in ('string','null') then return false; end if;
    field_value := btrim(coalesce(p_data->>field_key, ''));
    if field_value <> '' then
      if char_length(field_value) > 120 or public.atlas_word_count(field_value) > 18 then return false; end if;
      field_language := case field_key when 'name_ar' then 'arabic' else 'latin' end;
      if not public.nav_kurd_text_matches_exact_language(field_value, field_language) then return false; end if;
    end if;
  end loop;

  foreach field_key in array array['description_ku','description_ar','description_en'] loop
    if p_data ? field_key and jsonb_typeof(p_data->field_key) not in ('string','null') then return false; end if;
    field_value := btrim(coalesce(p_data->>field_key, ''));
    if field_value <> '' then
      if char_length(field_value) > 1200 or public.atlas_word_count(field_value) > 220 then return false; end if;
      field_language := case field_key
        when 'description_ku' then 'kurdish'
        when 'description_ar' then 'arabic'
        else 'latin'
      end;
      if not public.nav_kurd_text_matches_exact_language(field_value, field_language) then return false; end if;
    end if;
  end loop;

  if jsonb_typeof(p_data->'category') <> 'string' then return false; end if;
  category_value := btrim(p_data->>'category');
  if not exists (
    select 1 from nav_kurd_private.atlas_category_metadata_rules
    where category = category_value
  ) then return false; end if;

  tags_value := coalesce(p_data->'tags', '[]'::jsonb);
  if jsonb_typeof(tags_value) <> 'array' or jsonb_array_length(tags_value) > 24 then return false; end if;
  for tag_value in select jsonb_array_elements_text(tags_value) loop
    if char_length(btrim(tag_value)) not between 1 and 40 then return false; end if;
  end loop;
  if (select count(*) from jsonb_array_elements_text(tags_value))
     <> (select count(distinct value) from jsonb_array_elements_text(tags_value) as t(value))
  then return false; end if;

  metadata_value := coalesce(p_data->'metadata', '{}'::jsonb);
  if not public.atlas_metadata_is_valid(category_value, metadata_value) then return false; end if;

  if jsonb_typeof(p_data->'longitude') <> 'number'
     or jsonb_typeof(p_data->'latitude') <> 'number'
  then return false; end if;
  begin
    longitude_value := (p_data->>'longitude')::double precision;
    latitude_value := (p_data->>'latitude')::double precision;
  exception when others then
    return false;
  end;
  if not public.atlas_point_inside_operational_boundary(longitude_value, latitude_value) then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.atlas_place_payload_is_valid(jsonb) from public, anon, authenticated;

create or replace function public.validate_atlas_photo_localized_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.caption_ku := public.nav_kurd_normalize_kurdish(new.caption_ku);
  new.caption_ar := public.nav_kurd_normalize_arabic(new.caption_ar);
  new.caption_en := public.nav_kurd_normalize_latin(new.caption_en);

  if new.caption_ku is not null
     and not public.nav_kurd_text_matches_exact_language(new.caption_ku, 'kurdish')
  then raise exception 'Kurdish caption contains invalid script'; end if;
  if new.caption_ar is not null
     and not public.nav_kurd_text_matches_exact_language(new.caption_ar, 'arabic')
  then raise exception 'Arabic caption contains invalid script'; end if;
  if new.caption_en is not null
     and not public.nav_kurd_text_matches_exact_language(new.caption_en, 'latin')
  then raise exception 'English caption contains invalid script'; end if;
  return new;
end;
$$;

revoke all on function public.validate_atlas_photo_localized_content() from public, anon, authenticated;

-- The moderation Edge Function intentionally calls the RPC with service_role,
-- where auth.uid() is null. Accept only the tightly validated review workflow
-- before applying ordinary-user write rules.
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
  if workflow = 'review_place' then
    if tg_op <> 'UPDATE'
       or old.submission_source <> 'user'
       or old.review_status <> 'pending'
       or new.submission_source is distinct from old.submission_source
       or new.created_by is distinct from old.created_by
       or new.review_status not in ('approved','rejected')
       or new.reviewed_by is null
       or not exists (select 1 from public.atlas_owners where user_id = new.reviewed_by)
       or (new.review_status = 'approved' and new.status <> 'published')
       or (new.review_status = 'rejected' and new.status <> 'draft')
    then
      raise exception 'Invalid trusted place-review transition';
    end if;
    return new;
  end if;

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
  if target.id is null then raise exception 'Place not found'; end if;
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

revoke all on function public.review_atlas_place_with_media(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.review_atlas_place_with_media(uuid, uuid, text, text, jsonb)
  to service_role;

do $$
begin
  if not has_function_privilege(
    'service_role',
    'public.review_atlas_place_with_media(uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Service-role moderation privilege is missing';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
