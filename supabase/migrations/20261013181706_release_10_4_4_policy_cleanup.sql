-- NAV KURD 10.4.4: preserve access rules while removing overlapping policies.
-- USING and WITH CHECK are combined independently, as PostgreSQL does for
-- permissive policies. Public reads stay separate from authenticated access.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if (select array_agg(policyname::text order by policyname)
      from pg_policies where schemaname = 'public'
      and tablename = 'atlas_places')
     is distinct from array['atlas places admin delete', 'atlas places admin insert', 'atlas places admin read', 'atlas places admin update', 'atlas places published read', 'atlas places regular user insert', 'atlas places regular user own read', 'atlas places regular user update', 'atlas places regular user withdraw approved']::text[] then
    raise exception 'Unexpected atlas_places policies; review before changing access';
  end if;
end;
$guard$;

drop policy "atlas places admin delete" on public.atlas_places;
drop policy "atlas places admin insert" on public.atlas_places;
drop policy "atlas places admin read" on public.atlas_places;
drop policy "atlas places admin update" on public.atlas_places;
drop policy "atlas places published read" on public.atlas_places;
drop policy "atlas places regular user insert" on public.atlas_places;
drop policy "atlas places regular user own read" on public.atlas_places;
drop policy "atlas places regular user update" on public.atlas_places;
drop policy "atlas places regular user withdraw approved" on public.atlas_places;

create policy "atlas places anon select" on public.atlas_places
  for select to anon
  using (
    (((status = 'published'::text) AND ((submission_source = 'admin'::text) OR (review_status = 'approved'::text))))
  );

create policy "atlas places authenticated select" on public.atlas_places
  for select to authenticated
  using (
    ((select public.is_atlas_owner()))
    or (((status = 'published'::text) AND ((submission_source = 'admin'::text) OR (review_status = 'approved'::text))))
    or (((NOT (select public.is_atlas_owner())) AND (created_by = ( SELECT auth.uid() AS uid)) AND (submission_source = 'user'::text)))
  );

create policy "atlas places authenticated insert" on public.atlas_places
  for insert to authenticated
  with check (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (created_by = ( SELECT auth.uid() AS uid)) AND (submission_source = 'user'::text) AND (status = 'draft'::text) AND (review_status = 'pending'::text)))
  );

create policy "atlas places authenticated update" on public.atlas_places
  for update to authenticated
  using (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (created_by = ( SELECT auth.uid() AS uid)) AND (submission_source = 'user'::text) AND (status = 'draft'::text) AND (review_status = ANY (ARRAY['pending'::text, 'rejected'::text, 'withdrawn'::text]))))
    or (((NOT (select public.is_atlas_owner())) AND (created_by = ( SELECT auth.uid() AS uid)) AND (submission_source = 'user'::text) AND (status = 'published'::text) AND (review_status = 'approved'::text)))
  )
  with check (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (created_by = ( SELECT auth.uid() AS uid)) AND (submission_source = 'user'::text) AND (status = 'draft'::text) AND (review_status = ANY (ARRAY['pending'::text, 'rejected'::text, 'withdrawn'::text]))))
    or (((NOT (select public.is_atlas_owner())) AND (created_by = ( SELECT auth.uid() AS uid)) AND (submission_source = 'user'::text) AND (status = 'draft'::text) AND (review_status = 'withdrawn'::text)))
  );

create policy "atlas places authenticated delete" on public.atlas_places
  for delete to authenticated
  using (
    ((select public.is_atlas_owner()))
  );

do $guard$
begin
  if (select array_agg(policyname::text order by policyname)
      from pg_policies where schemaname = 'public'
      and tablename = 'atlas_place_photos')
     is distinct from array['atlas photos admin delete', 'atlas photos admin insert', 'atlas photos admin read', 'atlas photos admin update', 'atlas photos published read', 'atlas photos regular user delete', 'atlas photos regular user insert', 'atlas photos regular user own read', 'atlas photos regular user update']::text[] then
    raise exception 'Unexpected atlas_place_photos policies; review before changing access';
  end if;
end;
$guard$;

drop policy "atlas photos admin delete" on public.atlas_place_photos;
drop policy "atlas photos admin insert" on public.atlas_place_photos;
drop policy "atlas photos admin read" on public.atlas_place_photos;
drop policy "atlas photos admin update" on public.atlas_place_photos;
drop policy "atlas photos published read" on public.atlas_place_photos;
drop policy "atlas photos regular user delete" on public.atlas_place_photos;
drop policy "atlas photos regular user insert" on public.atlas_place_photos;
drop policy "atlas photos regular user own read" on public.atlas_place_photos;
drop policy "atlas photos regular user update" on public.atlas_place_photos;

create policy "atlas place photos anon select" on public.atlas_place_photos
  for select to anon
  using (
    ((EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.status = 'published'::text) AND ((p.submission_source = 'admin'::text) OR (p.review_status = 'approved'::text))))))
  );

create policy "atlas place photos authenticated select" on public.atlas_place_photos
  for select to authenticated
  using (
    ((select public.is_atlas_owner()))
    or ((EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.status = 'published'::text) AND ((p.submission_source = 'admin'::text) OR (p.review_status = 'approved'::text))))))
    or (((NOT (select public.is_atlas_owner())) AND (EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.created_by = ( SELECT auth.uid() AS uid)) AND (p.submission_source = 'user'::text))))))
  );

create policy "atlas place photos authenticated insert" on public.atlas_place_photos
  for insert to authenticated
  with check (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (storage_bucket = 'kri-place-media-private'::text) AND (EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.created_by = ( SELECT auth.uid() AS uid)) AND (p.submission_source = 'user'::text) AND (p.status = 'draft'::text) AND (p.review_status <> 'approved'::text))))))
  );

create policy "atlas place photos authenticated update" on public.atlas_place_photos
  for update to authenticated
  using (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (storage_bucket = 'kri-place-media-private'::text) AND (EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.created_by = ( SELECT auth.uid() AS uid)) AND (p.submission_source = 'user'::text) AND (p.status = 'draft'::text) AND (p.review_status <> 'approved'::text))))))
  )
  with check (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (storage_bucket = 'kri-place-media-private'::text) AND (EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.created_by = ( SELECT auth.uid() AS uid)) AND (p.submission_source = 'user'::text) AND (p.status = 'draft'::text) AND (p.review_status <> 'approved'::text))))))
  );

create policy "atlas place photos authenticated delete" on public.atlas_place_photos
  for delete to authenticated
  using (
    ((select public.is_atlas_owner()))
    or (((NOT (select public.is_atlas_owner())) AND (EXISTS ( SELECT 1
   FROM atlas_places p
  WHERE ((p.id = atlas_place_photos.place_id) AND (p.created_by = ( SELECT auth.uid() AS uid)) AND (p.submission_source = 'user'::text) AND (p.status = 'draft'::text) AND (p.review_status <> 'approved'::text))))))
  );

do $guard$
begin
  if (select array_agg(policyname::text order by policyname)
      from pg_policies where schemaname = 'public'
      and tablename = 'atlas_supporters')
     is distinct from array['atlas supporters owner manage', 'atlas supporters public read']::text[] then
    raise exception 'Unexpected atlas_supporters policies; review before changing access';
  end if;
end;
$guard$;

drop policy "atlas supporters owner manage" on public.atlas_supporters;
drop policy "atlas supporters public read" on public.atlas_supporters;

create policy "atlas supporters anon select" on public.atlas_supporters
  for select to anon
  using (
    ((is_visible = true))
  );

create policy "atlas supporters authenticated select" on public.atlas_supporters
  for select to authenticated
  using (
    ((select public.is_atlas_owner()))
    or ((is_visible = true))
  );

create policy "atlas supporters authenticated insert" on public.atlas_supporters
  for insert to authenticated
  with check (
    ((select public.is_atlas_owner()))
  );

create policy "atlas supporters authenticated update" on public.atlas_supporters
  for update to authenticated
  using (
    ((select public.is_atlas_owner()))
  )
  with check (
    ((select public.is_atlas_owner()))
  );

create policy "atlas supporters authenticated delete" on public.atlas_supporters
  for delete to authenticated
  using (
    ((select public.is_atlas_owner()))
  );

do $guard$
begin
  if (select array_agg(policyname::text order by policyname)
      from pg_policies where schemaname = 'public'
      and tablename = 'atlas_user_profiles' and cmd = 'SELECT')
     is distinct from array['atlas profiles admin read', 'atlas profiles regular user own read']::text[] then
    raise exception 'Unexpected atlas_user_profiles policies; review before changing access';
  end if;
end;
$guard$;

drop policy "atlas profiles admin read" on public.atlas_user_profiles;
drop policy "atlas profiles regular user own read" on public.atlas_user_profiles;

create policy "atlas user profiles authenticated select" on public.atlas_user_profiles
  for select to authenticated
  using (
    ((select public.is_atlas_owner()))
    or (((user_id = ( SELECT auth.uid() AS uid)) AND (NOT (select public.is_atlas_owner()))))
  );

-- The owner lookup is constant within a statement, not per result row.
alter policy "atlas owners self read" on public.atlas_owners
  using (user_id = (select auth.uid()));

-- Referencing-side indexes avoid scans during review and account deletion.
create index atlas_activity_audit_actor_id_idx on public.atlas_activity_audit (actor_id);
create index atlas_feedback_reviewed_by_idx on public.atlas_feedback (reviewed_by);
create index atlas_notifications_place_id_idx on public.atlas_notifications (place_id);
create index atlas_notifications_revision_id_idx on public.atlas_notifications (revision_id);
create index atlas_place_revisions_reviewed_by_idx on public.atlas_place_revisions (reviewed_by);
create index atlas_places_category_idx on public.atlas_places (category);
create index atlas_places_reviewed_by_idx on public.atlas_places (reviewed_by);

-- This partial index repeats the existing directory index, with a leading
-- boolean that is always true under the identical predicate. Keep the smaller
-- (last_seen_at DESC, user_id) index used by the same ordered directory query.
drop index public.atlas_user_profiles_public_directory_online_idx;

commit;
