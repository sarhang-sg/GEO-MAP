-- App release identity and private privileged RPC implementations. No map,
-- account, photo, activity, storage or migration-history data is removed.
CREATE SCHEMA IF NOT EXISTS nav_kurd_private;
REVOKE ALL ON SCHEMA nav_kurd_private FROM PUBLIC;
GRANT USAGE ON SCHEMA nav_kurd_private TO anon, authenticated, service_role;

DO $hardening$
DECLARE
  item record;
  permission record;
  original_acl aclitem[];
  arguments text;
  identity_arguments text;
  result_type text;
  parameters text;
  options text;
  role_name text;
BEGIN
  FOR item IN
    SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
      AND p.proname = ANY(ARRAY[
        'count_public_online_users', 'delete_managed_atlas_feedback',
        'delete_own_atlas_feedback', 'get_atlas_public_directory_visibility',
        'list_public_recent_activity', 'list_public_supporters',
        'list_public_visitor_directory', 'record_atlas_activity',
        'review_atlas_feedback', 'review_atlas_place_with_media',
        'save_own_atlas_place_submission', 'set_atlas_public_directory_visibility',
        'submit_atlas_feedback', 'submit_atlas_place_revision',
        'update_own_atlas_feedback'
      ])
  LOOP
    IF pg_get_userbyid(item.proowner) <> current_user THEN
      RAISE EXCEPTION 'RPC % has an unexpected owner; no privilege bypass attempted', item.proname;
    END IF;
    arguments := pg_get_function_arguments(item.oid);
    identity_arguments := pg_get_function_identity_arguments(item.oid);
    result_type := pg_get_function_result(item.oid);
    original_acl := coalesce(item.proacl, acldefault('f', item.proowner));
    SELECT coalesce(string_agg('$' || i::text, ', ' ORDER BY i), '') INTO parameters
      FROM generate_series(1, item.pronargs) i;
    options := CASE item.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END
      || CASE WHEN item.proisstrict THEN ' STRICT' ELSE '' END
      || ' PARALLEL ' || CASE item.proparallel WHEN 's' THEN 'SAFE' WHEN 'r' THEN 'RESTRICTED' ELSE 'UNSAFE' END;
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA nav_kurd_private', item.proname, identity_arguments);
    EXECUTE format('ALTER FUNCTION nav_kurd_private.%I(%s) SET search_path = pg_catalog, public, auth, extensions, pg_temp', item.proname, identity_arguments);
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql SECURITY INVOKER %s SET search_path = pg_catalog, public, auth, extensions, pg_temp AS %L',
      item.proname, arguments, result_type, options,
      format('SELECT * FROM nav_kurd_private.%I(%s)', item.proname, parameters));
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role', item.proname, identity_arguments);
    EXECUTE format('REVOKE ALL ON FUNCTION nav_kurd_private.%I(%s) FROM PUBLIC, anon, authenticated, service_role', item.proname, identity_arguments);
    FOR permission IN SELECT * FROM aclexplode(original_acl) WHERE privilege_type = 'EXECUTE' LOOP
      role_name := CASE WHEN permission.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(permission.grantee)) END;
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %s%s', item.proname, identity_arguments, role_name,
        CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
      EXECUTE format('GRANT EXECUTE ON FUNCTION nav_kurd_private.%I(%s) TO %s%s', item.proname, identity_arguments, role_name,
        CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
  END LOOP;
  FOR item IN
    SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
      'get_atlas_server_clock', 'nav_kurd_text_matches_exact_language', 'touch_atlas_presence'
    ]) AND p.prokind = 'f'
  LOOP
    IF pg_get_userbyid(item.proowner) <> current_user THEN
      RAISE EXCEPTION 'Helper % has an unexpected owner', item.proname;
    END IF;
    EXECUTE format('ALTER FUNCTION public.%I(%s) SECURITY INVOKER', item.proname, pg_get_function_identity_arguments(item.oid));
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = pg_catalog, public, auth, extensions, pg_temp', item.proname, pg_get_function_identity_arguments(item.oid));
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='rls_auto_enable' AND pg_get_userbyid(p.proowner)=current_user) THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END
$hardening$;

CREATE TABLE IF NOT EXISTS public.nav_kurd_app_release (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  app_version text NOT NULL,
  android_version_code integer NOT NULL CHECK(android_version_code > 0),
  release_id text NOT NULL,
  web_source_commit text CHECK(web_source_commit IS NULL OR web_source_commit ~ '^[0-9a-f]{40}$'),
  android_source_commit text CHECK(android_source_commit IS NULL OR android_source_commit ~ '^[0-9a-f]{40}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nav_kurd_app_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nav_kurd_app_release FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nav_kurd_app_release TO anon, authenticated;
GRANT ALL ON public.nav_kurd_app_release TO service_role;
DROP POLICY IF EXISTS nav_kurd_release_read ON public.nav_kurd_app_release;
CREATE POLICY nav_kurd_release_read ON public.nav_kurd_app_release FOR SELECT TO anon, authenticated USING(singleton);
INSERT INTO public.nav_kurd_app_release(singleton, app_version, android_version_code, release_id)
VALUES(true, '10.4.4', 100404, '2026-10-13-nav-kurd-v10.4.4')
ON CONFLICT(singleton) DO UPDATE SET app_version=excluded.app_version,
  android_version_code=excluded.android_version_code, release_id=excluded.release_id, updated_at=now();
NOTIFY pgrst, 'reload schema';
