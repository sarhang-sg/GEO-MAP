-- NAV KURD Stage 4B — READ ONLY live privilege inventory.
-- This script changes nothing. Run in Supabase SQL Editor and export the results if
-- you want to audit remaining delivery/driver/PostGIS SECURITY DEFINER warnings safely.

with functions as (
  select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef as security_definer,
    p.proconfig as function_config,
    pg_get_userbyid(p.proowner) as owner_name,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select *
from functions
where security_definer
order by function_name, identity_arguments;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public', 'storage')
  and (tablename like 'atlas_%' or tablename in ('objects', 'buckets'))
order by schemaname, tablename, policyname;

select
  c.table_schema,
  c.table_name,
  c.privilege_type,
  c.grantee
from information_schema.role_table_grants c
where c.table_schema in ('public', 'storage')
  and (c.table_name like 'atlas_%' or c.table_name in ('objects', 'buckets'))
  and c.grantee in ('anon', 'authenticated', 'service_role')
order by c.table_schema, c.table_name, c.grantee, c.privilege_type;
