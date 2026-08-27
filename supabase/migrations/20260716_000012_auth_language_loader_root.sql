-- NAV KURD 2027 — live exact-language permission repair and auth closure.
-- Fixes authenticated place writes blocked by CHECK constraints that call the
-- exact-language validator. The validator runs with a fixed search_path and may
-- execute its private normalization helpers without exposing those helpers.

begin;

alter function public.nav_kurd_text_matches_exact_language(text, text) security definer;
alter function public.nav_kurd_text_matches_exact_language(text, text) set search_path = pg_catalog, public;
revoke all on function public.nav_kurd_text_matches_exact_language(text, text) from public, anon, authenticated;
grant execute on function public.nav_kurd_text_matches_exact_language(text, text) to authenticated, service_role;

-- Keep private helper functions unavailable to browser roles. They are reached
-- only through the security-definer validator or other security-definer triggers.
revoke all on function public.nav_kurd_clean_text(text) from public, anon, authenticated;
revoke all on function public.nav_kurd_normalize_kurdish(text) from public, anon, authenticated;
revoke all on function public.nav_kurd_normalize_arabic(text) from public, anon, authenticated;
revoke all on function public.nav_kurd_normalize_latin(text) from public, anon, authenticated;

-- Fail the migration if the effective authenticated privilege is still absent.
do $$
begin
  if not has_function_privilege('authenticated', 'public.nav_kurd_text_matches_exact_language(text,text)', 'EXECUTE') then
    raise exception 'NAV KURD exact-language validator EXECUTE privilege repair failed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
