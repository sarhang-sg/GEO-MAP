-- NAV KURD 2027 — contribution form quality root hardening.
-- Applies after 20260714_000006_atlas_workflow_security_root.sql.
--
-- Goals:
--   * keep user-selected map coordinates canonical and valid;
--   * enforce Kurdish/Arabic vs English writing-system rules at the database boundary;
--   * reject unsafe control/bidi override characters in user-authored localized content;
--   * keep photo MIME and size limits canonical at the Storage bucket level;
--   * preserve all existing review, ownership, public-read and admin/user separation rules.

-- ---------------------------------------------------------------------------
-- 1) Canonical writing-system validator.
--    Numbers, whitespace and punctuation are allowed in every localized field.
--    Alphabetic code points must belong to the field's declared writing system.
-- ---------------------------------------------------------------------------
create or replace function public.nav_kurd_text_matches_script(
  p_value text,
  p_script text
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  i integer;
  ch text;
  codepoint integer;
begin
  if p_value is null or btrim(p_value) = '' then return true; end if;
  if p_script not in ('arabic', 'latin') then return false; end if;

  for i in 1..char_length(p_value) loop
    ch := substr(p_value, i, 1);
    codepoint := ascii(ch);

    -- Reject C0/C1-style controls except tab/newline, and bidi override/isolate controls.
    if (codepoint < 32 and codepoint not in (9, 10))
       or codepoint = 127
       or codepoint between 8234 and 8238
       or codepoint between 8294 and 8297 then
      return false;
    end if;

    -- Explicit cross-script rejection does not depend on the database locale.
    if p_script = 'arabic' and (
      codepoint between 65 and 90
      or codepoint between 97 and 122
      or codepoint between 192 and 255
      or codepoint between 256 and 591
      or codepoint between 7680 and 7935
    ) then
      return false;
    end if;

    if p_script = 'latin' and (
      codepoint between 1536 and 1791
      or codepoint between 1872 and 1919
      or codepoint between 2208 and 2303
      or codepoint between 64336 and 65023
      or codepoint between 65136 and 65279
    ) then
      return false;
    end if;

    -- For other alphabetic scripts recognized by the database locale, require the
    -- declared script rather than silently accepting mixed writing systems.
    if ch ~ '^[[:alpha:]]$' then
      if p_script = 'arabic' and not (
        codepoint between 1536 and 1791
        or codepoint between 1872 and 1919
        or codepoint between 2208 and 2303
        or codepoint between 64336 and 65023
        or codepoint between 65136 and 65279
      ) then return false; end if;
      if p_script = 'latin' and not (
        codepoint between 65 and 90
        or codepoint between 97 and 122
        or codepoint between 192 and 255
        or codepoint between 256 and 591
        or codepoint between 7680 and 7935
      ) then return false; end if;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.nav_kurd_text_matches_script(text, text) from public, anon, authenticated;
grant execute on function public.nav_kurd_text_matches_script(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) User place rows: writing systems + canonical 7-decimal coordinates.
-- ---------------------------------------------------------------------------
create or replace function public.validate_atlas_user_localized_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.submission_source = 'user' then
    if not public.nav_kurd_text_matches_script(new.name_ku, 'arabic') then
      raise exception 'Kurdish name contains letters outside the allowed Kurdish/Arabic writing system';
    end if;
    if not public.nav_kurd_text_matches_script(new.name_ar, 'arabic') then
      raise exception 'Arabic name contains letters outside the allowed Arabic writing system';
    end if;
    if not public.nav_kurd_text_matches_script(new.name_en, 'latin') then
      raise exception 'English name contains letters outside the allowed Latin writing system';
    end if;
    if not public.nav_kurd_text_matches_script(new.description_ku, 'arabic') then
      raise exception 'Kurdish description contains letters outside the allowed Kurdish/Arabic writing system';
    end if;
    if not public.nav_kurd_text_matches_script(new.description_ar, 'arabic') then
      raise exception 'Arabic description contains letters outside the allowed Arabic writing system';
    end if;
    if not public.nav_kurd_text_matches_script(new.description_en, 'latin') then
      raise exception 'English description contains letters outside the allowed Latin writing system';
    end if;
  end if;

  new.longitude := round(new.longitude::numeric, 7)::double precision;
  new.latitude := round(new.latitude::numeric, 7)::double precision;
  return new;
end;
$$;

revoke all on function public.validate_atlas_user_localized_content() from public, anon, authenticated;
drop trigger if exists atlas_places_validate_localized_content on public.atlas_places;
create trigger atlas_places_validate_localized_content
before insert or update on public.atlas_places
for each row execute function public.validate_atlas_user_localized_content();

-- ---------------------------------------------------------------------------
-- 3) Revision payloads: same writing-system rules and canonical coordinates.
-- ---------------------------------------------------------------------------
create or replace function public.validate_atlas_revision_localized_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  lon numeric;
  lat numeric;
begin
  if not public.nav_kurd_text_matches_script(new.proposed_data->>'name_ku', 'arabic') then
    raise exception 'Kurdish name contains letters outside the allowed Kurdish/Arabic writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.proposed_data->>'name_ar', 'arabic') then
    raise exception 'Arabic name contains letters outside the allowed Arabic writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.proposed_data->>'name_en', 'latin') then
    raise exception 'English name contains letters outside the allowed Latin writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.proposed_data->>'description_ku', 'arabic') then
    raise exception 'Kurdish description contains letters outside the allowed Kurdish/Arabic writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.proposed_data->>'description_ar', 'arabic') then
    raise exception 'Arabic description contains letters outside the allowed Arabic writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.proposed_data->>'description_en', 'latin') then
    raise exception 'English description contains letters outside the allowed Latin writing system';
  end if;

  lon := round((new.proposed_data->>'longitude')::numeric, 7);
  lat := round((new.proposed_data->>'latitude')::numeric, 7);
  new.proposed_data := jsonb_set(new.proposed_data, '{longitude}', to_jsonb(lon), true);
  new.proposed_data := jsonb_set(new.proposed_data, '{latitude}', to_jsonb(lat), true);
  return new;
end;
$$;

revoke all on function public.validate_atlas_revision_localized_content() from public, anon, authenticated;
drop trigger if exists atlas_place_revisions_validate_localized_content on public.atlas_place_revisions;
create trigger atlas_place_revisions_validate_localized_content
before insert or update on public.atlas_place_revisions
for each row execute function public.validate_atlas_revision_localized_content();

-- ---------------------------------------------------------------------------
-- 4) Photo captions: language-specific writing-system checks.
-- ---------------------------------------------------------------------------
create or replace function public.validate_atlas_photo_localized_content()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.nav_kurd_text_matches_script(new.caption_ku, 'arabic') then
    raise exception 'Kurdish caption contains letters outside the allowed Kurdish/Arabic writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.caption_ar, 'arabic') then
    raise exception 'Arabic caption contains letters outside the allowed Arabic writing system';
  end if;
  if not public.nav_kurd_text_matches_script(new.caption_en, 'latin') then
    raise exception 'English caption contains letters outside the allowed Latin writing system';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_atlas_photo_localized_content() from public, anon, authenticated;
drop trigger if exists atlas_place_photos_validate_localized_content on public.atlas_place_photos;
create trigger atlas_place_photos_validate_localized_content
before insert or update on public.atlas_place_photos
for each row execute function public.validate_atlas_photo_localized_content();

-- ---------------------------------------------------------------------------
-- 5) Storage root policy: only approved image MIME types, maximum 10 MiB.
-- ---------------------------------------------------------------------------
update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'kri-place-media';

notify pgrst, 'reload schema';
