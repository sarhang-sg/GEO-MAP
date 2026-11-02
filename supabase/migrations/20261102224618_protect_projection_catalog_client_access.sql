-- Preserve all PostGIS data and keep projection lookups available to clients.
set local lock_timeout = '4s';

create or replace function nav_kurd_private.guard_projection_writes()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $fn$
begin
  if current_user in ('anon','authenticated') then
    raise exception using errcode = '42501', message = 'Coordinate reference definitions are read-only.';
  end if;
  -- The return value of a FOR EACH STATEMENT trigger is ignored.
  return null;
end
$fn$;
revoke all on function nav_kurd_private.guard_projection_writes() from public, anon, authenticated;

do $secure$
declare
  crs oid := to_regclass('public.spatial_ref_sys');
  proc record;
begin
  if crs is null then return; end if;
  if not exists (
    select 1 from pg_depend d join pg_extension e on e.oid=d.refobjid
    where d.classid='pg_class'::regclass and d.objid=crs and d.refclassid='pg_extension'::regclass
      and d.deptype='e' and e.extname='postgis'
  ) then raise exception 'Unexpected object at public.spatial_ref_sys'; end if;

  if (select pg_has_role(current_user,relowner,'USAGE') from pg_class where oid=crs) then
    revoke insert, update, delete, truncate, references, trigger on public.spatial_ref_sys from public, anon, authenticated;
    if current_setting('server_version_num')::integer >= 170000 then
      execute 'revoke maintain on public.spatial_ref_sys from public, anon, authenticated';
    end if;
    if not (select relrowsecurity from pg_class where oid=crs) then
      -- This policy preserves previously granted SELECT without granting new table access.
      create policy nav_kurd_coordinate_reference_read on public.spatial_ref_sys for select using (true);
      create policy nav_kurd_coordinate_reference_maintenance on public.spatial_ref_sys
        for all to postgres, service_role using (true) with check (true);
      alter table public.spatial_ref_sys enable row level security;
    end if;
  end if;

  -- Hosted projects can reserve GRANT OPTION and ownership for supabase_admin
  -- while delegating TRIGGER. Also covers TRUNCATE, which RLS alone cannot protect.
  if exists (
    select 1 from unnest(array['anon','authenticated']) as client(role_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as op(privilege_name)
    where has_table_privilege(client.role_name,crs,op.privilege_name)
  ) then
    if not exists (select 1 from pg_trigger where tgrelid=crs and tgname='nav_kurd_guard_projection_writes') then
      create trigger nav_kurd_guard_projection_writes
        before insert or update or delete or truncate on public.spatial_ref_sys
        for each statement execute function nav_kurd_private.guard_projection_writes();
    end if;
    if not exists (select 1 from pg_trigger where tgrelid=crs and tgname='nav_kurd_guard_projection_writes'
      and tgfoid='nav_kurd_private.guard_projection_writes()'::regprocedure
      and tgtype=62 and tgenabled in ('O','A') and tgqual is null)
    then raise exception 'Projection write guard is missing or disabled'; end if;
  end if;

  -- On owner-controlled installations also remove client access to the three
  -- security-definer statistics overloads. On managed installs they have
  -- multiple unnamed arguments and are unavailable as PostgREST RPCs.
  for proc in
    select p.oid, p.oid::regprocedure as signature from pg_proc p
    join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
    join pg_extension e on d.refclassid='pg_extension'::regclass and e.oid=d.refobjid and e.extname='postgis'
    where p.pronamespace='public'::regnamespace and p.proname='st_estimatedextent'
      and p.prosecdef and pg_has_role(current_user,p.proowner,'USAGE')
  loop
    if has_function_privilege('service_role',proc.oid,'EXECUTE') then
      execute format('grant execute on function %s to service_role',proc.signature);
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated',proc.signature);
  end loop;
end
$secure$;
