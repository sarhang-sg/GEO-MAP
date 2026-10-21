-- Allow category-only reports. Preserve the private implementation, wrapper,
-- ownership checks, diagnostics bounds, rate limits, grants and notification text.
BEGIN;
ALTER TABLE public.atlas_feedback DROP CONSTRAINT atlas_feedback_message_limit;
ALTER TABLE public.atlas_feedback ADD CONSTRAINT atlas_feedback_message_limit
  CHECK (char_length(btrim(message)) BETWEEN 0 AND 2000);
DO $migration$
DECLARE
  definition text := pg_get_functiondef('nav_kurd_private.submit_atlas_feedback(text,text,jsonb,text,text,text)'::regprocedure);
BEGIN
  IF position('char_length(message_value) < 20 or char_length(message_value) > 2000' in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected feedback validation definition; review before applying';
  END IF;
  definition := replace(definition,
    'char_length(message_value) < 20 or char_length(message_value) > 2000',
    'char_length(message_value) > 2000');
  definition := replace(definition,
    'Feedback must contain between 20 and 2000 characters',
    'Feedback must contain at most 2000 characters');
  EXECUTE definition;
END;
$migration$;
COMMIT;
