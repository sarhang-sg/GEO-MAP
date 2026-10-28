-- The invoker validator used by place CHECK constraints calls these pure text
-- helpers. They read no tables and confer no account or storage privileges.
-- Keep SECURITY INVOKER and every existing row/storage policy unchanged.
GRANT EXECUTE ON FUNCTION public.nav_kurd_clean_text(text),
  public.nav_kurd_normalize_kurdish(text),
  public.nav_kurd_normalize_arabic(text),
  public.nav_kurd_normalize_latin(text)
TO authenticated, service_role;

DO $verify$
DECLARE helper regprocedure;
BEGIN
  FOREACH helper IN ARRAY ARRAY[
    'public.nav_kurd_clean_text(text)'::regprocedure,
    'public.nav_kurd_normalize_kurdish(text)'::regprocedure,
    'public.nav_kurd_normalize_arabic(text)'::regprocedure,
    'public.nav_kurd_normalize_latin(text)'::regprocedure
  ] LOOP
    IF NOT has_function_privilege('authenticated', helper, 'EXECUTE')
       OR NOT has_function_privilege('service_role', helper, 'EXECUTE') THEN
      RAISE EXCEPTION 'Text validation helper permissions are incomplete';
    END IF;
    IF has_function_privilege('anon', helper, 'EXECUTE') THEN
      RAISE EXCEPTION 'Text validation helpers must not be anonymous endpoints';
    END IF;
  END LOOP;
END
$verify$;

NOTIFY pgrst, 'reload schema';
