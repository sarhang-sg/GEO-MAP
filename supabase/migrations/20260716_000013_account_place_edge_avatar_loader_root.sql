-- NAV KURD 2027 — reliable user place create/edit lifecycle and account deletion closure.
-- Additive, transactional and safe to rerun after 20260716_000012.

begin;

-- Keep the ordinary-user table privileges and RLS contract explicit. This repairs
-- projects where an older migration or Dashboard change removed UPDATE access.
grant select, insert, update on public.atlas_places to authenticated;
grant select, insert, update on public.atlas_place_revisions to authenticated;

drop policy if exists "atlas places regular user update" on public.atlas_places;
create policy "atlas places regular user update" on public.atlas_places
for update to authenticated
using (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'draft'
  and review_status in ('pending','rejected','withdrawn')
)
with check (
  not public.is_atlas_owner()
  and created_by = (select auth.uid())
  and submission_source = 'user'
  and status = 'draft'
  and review_status in ('pending','rejected','withdrawn')
);

-- One guarded RPC owns create, draft edit, rejected resubmission and approved-place
-- revision creation. It keeps all authority checks server-side and prevents browser
-- clients from depending on fragile multi-step RLS behaviour.
create or replace function public.save_own_atlas_place_submission(
  p_place_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  target public.atlas_places;
  saved public.atlas_places;
  revision public.atlas_place_revisions;
  normalized jsonb;
  tags_value text[];
  next_revision integer;
  slug_value text;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if public.is_atlas_owner() then raise exception 'Administrator accounts cannot use ordinary-user submission workflows'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Place payload must be a JSON object'; end if;

  normalized := jsonb_build_object(
    'name_ku', btrim(coalesce(p_payload->>'name_ku', '')),
    'name_ar', btrim(coalesce(p_payload->>'name_ar', '')),
    'name_en', btrim(coalesce(p_payload->>'name_en', '')),
    'category', btrim(coalesce(p_payload->>'category', '')),
    'tags', coalesce(p_payload->'tags', '[]'::jsonb),
    'metadata', coalesce(p_payload->'metadata', '{}'::jsonb),
    'description_ku', nullif(btrim(coalesce(p_payload->>'description_ku', '')), ''),
    'description_ar', nullif(btrim(coalesce(p_payload->>'description_ar', '')), ''),
    'description_en', nullif(btrim(coalesce(p_payload->>'description_en', '')), ''),
    'longitude', p_payload->'longitude',
    'latitude', p_payload->'latitude'
  );

  perform public.atlas_assert_place_payload(normalized);
  select coalesce(array_agg(value order by ordinal), '{}'::text[])
  into tags_value
  from jsonb_array_elements_text(normalized->'tags') with ordinality as t(value, ordinal);

  if p_place_id is null then
    slug_value := nullif(btrim(coalesce(p_payload->>'slug', '')), '');
    if slug_value is null then
      slug_value := 'user-' || replace(gen_random_uuid()::text, '-', '');
    end if;

    insert into public.atlas_places(
      slug, name_ku, name_ar, name_en, category, tags, metadata,
      description_ku, description_ar, description_en,
      longitude, latitude, status, submission_source, review_status, created_by
    ) values (
      slug_value,
      normalized->>'name_ku', normalized->>'name_ar', normalized->>'name_en', normalized->>'category',
      tags_value, normalized->'metadata',
      nullif(normalized->>'description_ku', ''), nullif(normalized->>'description_ar', ''), nullif(normalized->>'description_en', ''),
      (normalized->>'longitude')::double precision, (normalized->>'latitude')::double precision,
      'draft', 'user', 'pending', uid
    ) returning * into saved;

    return jsonb_build_object('mode', 'place', 'place', to_jsonb(saved));
  end if;

  select * into target
  from public.atlas_places
  where id = p_place_id
  for update;

  if target.id is null or target.created_by is distinct from uid or target.submission_source <> 'user' then
    raise exception 'You cannot edit another user''s place';
  end if;

  if target.status = 'published' and target.review_status = 'approved' then
    if exists (
      select 1 from public.atlas_place_revisions
      where place_id = target.id and review_status = 'pending'
    ) then
      raise exception 'A revision for this place is already pending review';
    end if;

    select coalesce(max(revision_no), 0) + 1
    into next_revision
    from public.atlas_place_revisions
    where place_id = target.id;

    insert into public.atlas_place_revisions(
      place_id, revision_no, created_by, proposed_data, review_status
    ) values (
      target.id, next_revision, uid, normalized, 'pending'
    ) returning * into revision;

    return jsonb_build_object(
      'mode', 'revision',
      'place', to_jsonb(target),
      'revision', to_jsonb(revision)
    );
  end if;

  if target.status <> 'draft' or target.review_status not in ('pending','rejected','withdrawn') then
    raise exception 'This place cannot be edited in its current review state';
  end if;

  update public.atlas_places
  set name_ku = normalized->>'name_ku',
      name_ar = normalized->>'name_ar',
      name_en = normalized->>'name_en',
      category = normalized->>'category',
      tags = tags_value,
      metadata = normalized->'metadata',
      description_ku = nullif(normalized->>'description_ku', ''),
      description_ar = nullif(normalized->>'description_ar', ''),
      description_en = nullif(normalized->>'description_en', ''),
      longitude = (normalized->>'longitude')::double precision,
      latitude = (normalized->>'latitude')::double precision,
      status = 'draft',
      review_status = 'pending',
      review_note = null,
      reviewed_by = null,
      reviewed_at = null
  where id = target.id
  returning * into saved;

  return jsonb_build_object('mode', 'place', 'place', to_jsonb(saved));
end;
$$;

revoke all on function public.save_own_atlas_place_submission(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_own_atlas_place_submission(uuid, jsonb) to authenticated;

-- Keep the older RPC available for compatibility, but make its manually checked
-- ownership path independent of RLS drift.
alter function public.submit_atlas_place_revision(uuid, jsonb) security definer;
alter function public.submit_atlas_place_revision(uuid, jsonb) set search_path = pg_catalog, public;
revoke all on function public.submit_atlas_place_revision(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_atlas_place_revision(uuid, jsonb) to authenticated;

grant execute on function public.withdraw_atlas_place_submission(uuid) to authenticated;
grant execute on function public.withdraw_atlas_approved_place(uuid) to authenticated;
grant execute on function public.withdraw_atlas_place_revision(uuid) to authenticated;

-- Fail before commit if the effective live privileges are incomplete.
do $$
begin
  if not has_function_privilege('authenticated', 'public.save_own_atlas_place_submission(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Authenticated place-save RPC privilege is missing';
  end if;
  if not has_function_privilege('authenticated', 'public.submit_atlas_place_revision(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Authenticated revision RPC privilege is missing';
  end if;
  if not has_table_privilege('authenticated', 'public.atlas_places', 'SELECT,INSERT,UPDATE') then
    raise exception 'Authenticated atlas_places privileges are incomplete';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
