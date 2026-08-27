-- NAV KURD owner studio root access fix.
-- Safe to run after the owner-content schema migration. It does not delete or modify Atlas data.
-- It only guarantees the normal Supabase API grants needed for the existing RLS policies.

grant usage on schema public to anon, authenticated;

grant select on table public.atlas_owners to authenticated;

grant select on table public.atlas_places to anon, authenticated;
grant insert, update, delete on table public.atlas_places to authenticated;
grant select on table public.atlas_place_photos to anon, authenticated;
grant insert, update, delete on table public.atlas_place_photos to authenticated;

grant execute on function public.is_atlas_owner() to anon, authenticated;

-- Make PostgREST pick up the verified tables, FK and policies immediately.
notify pgrst, 'reload schema';
