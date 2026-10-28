-- NAV KURD 2027 — private user/admin workspaces and message ownership.
-- Applies after 20260716_000010_google_auth_feedback_notifications_root.sql.
-- Additive, transactional and safe to rerun.

begin;

-- Users may delete any notification addressed to their own account. Notification
-- content remains immutable; only the read state is editable.
drop policy if exists "atlas notifications own delete read" on public.atlas_notifications;
drop policy if exists "atlas notifications own delete" on public.atlas_notifications;
create policy "atlas notifications own delete" on public.atlas_notifications
for delete to authenticated
using (user_id = (select auth.uid()));

grant delete on public.atlas_notifications to authenticated;

-- A user may edit the text/category of their own feedback only while it is still
-- new. Once an administrator starts processing it, the original user message is
-- preserved and the administrator responds through admin_note.
create or replace function public.update_own_atlas_feedback(
  p_feedback_id uuid,
  p_category text,
  p_message text
)
returns public.atlas_feedback
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  category_value text := lower(btrim(coalesce(p_category, '')));
  message_value text := btrim(coalesce(p_message, ''));
  target public.atlas_feedback;
  result public.atlas_feedback;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if category_value not in ('bug','data','place','search','login','offline','gps','ui','other') then
    raise exception 'Invalid feedback category';
  end if;
  if char_length(message_value) < 20 or char_length(message_value) > 2000 then
    raise exception 'Feedback must contain between 20 and 2000 characters';
  end if;

  select * into target
  from public.atlas_feedback
  where id = p_feedback_id
  for update;

  if target.id is null or target.user_id <> uid then
    raise exception 'Feedback report not found';
  end if;
  if target.status <> 'new' then
    raise exception 'Feedback can only be edited before administrator processing begins';
  end if;

  update public.atlas_feedback
  set category = category_value,
      message = message_value
  where id = target.id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.update_own_atlas_feedback(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_own_atlas_feedback(uuid, text, text) to authenticated;

-- Users retain control of messages they authored and may remove them from the
-- private inbox. Administrators cannot invoke this function on another user's row.
create or replace function public.delete_own_atlas_feedback(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  deleted_count integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;

  delete from public.atlas_feedback
  where id = p_feedback_id
    and user_id = uid;

  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then raise exception 'Feedback report not found'; end if;
end;
$$;

revoke all on function public.delete_own_atlas_feedback(uuid) from public, anon, authenticated;
grant execute on function public.delete_own_atlas_feedback(uuid) to authenticated;

-- Administrators can remove spam, accidental duplicates or invalid reports from
-- the private management inbox. This is intentionally separate from the user RPC.
create or replace function public.delete_managed_atlas_feedback(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null or not public.is_atlas_owner() then
    raise exception 'Administrator access required';
  end if;

  delete from public.atlas_feedback where id = p_feedback_id;
  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then raise exception 'Feedback report not found'; end if;
end;
$$;

revoke all on function public.delete_managed_atlas_feedback(uuid) from public, anon, authenticated;
grant execute on function public.delete_managed_atlas_feedback(uuid) to authenticated;

-- Preserve the user's original message while allowing an administrator to edit a
-- private reply/note and move the ticket through its lifecycle. Every actual
-- status transition creates a durable user notification.
create or replace function public.review_atlas_feedback(
  p_feedback_id uuid,
  p_status text,
  p_admin_note text default null
)
returns public.atlas_feedback
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  uid uuid := auth.uid();
  status_value text := lower(btrim(coalesce(p_status, '')));
  note_value text := nullif(btrim(coalesce(p_admin_note, '')), '');
  target public.atlas_feedback;
  result public.atlas_feedback;
begin
  if uid is null or not public.is_atlas_owner() then raise exception 'Administrator access required'; end if;
  if status_value not in ('new','in_progress','resolved','closed') then raise exception 'Invalid feedback status'; end if;
  if note_value is not null and char_length(note_value) > 1200 then raise exception 'Administrator note is too long'; end if;

  select * into target from public.atlas_feedback where id = p_feedback_id for update;
  if target.id is null then raise exception 'Feedback report not found'; end if;

  update public.atlas_feedback
  set status = status_value,
      admin_note = note_value,
      reviewed_by = uid,
      reviewed_at = case when status_value in ('resolved','closed') then now() else reviewed_at end
  where id = p_feedback_id
  returning * into result;

  if target.status is distinct from status_value then
    insert into public.atlas_notifications(
      user_id, place_id, revision_id, kind,
      title_ku, title_ar, title_en, body_ku, body_ar, body_en
    ) values (
      target.user_id, null, null, 'feedback',
      case status_value
        when 'in_progress' then 'بەڕێوەبەر دەستی بە پشکنینی نامەکەت کرد'
        when 'resolved' then 'ڕاپۆرتەکەت چارەسەر کرا'
        when 'closed' then 'ڕاپۆرتەکەت داخرا'
        else 'دۆخی نامەکەت نوێ کرایەوە'
      end,
      case status_value
        when 'in_progress' then 'بدأ المشرف معالجة رسالتك'
        when 'resolved' then 'تم حل بلاغك'
        when 'closed' then 'تم إغلاق بلاغك'
        else 'تم تحديث حالة رسالتك'
      end,
      case status_value
        when 'in_progress' then 'An administrator started processing your message'
        when 'resolved' then 'Your report was resolved'
        when 'closed' then 'Your report was closed'
        else 'Your message status was updated'
      end,
      null, null, null
    );
  end if;

  return result;
end;
$$;

revoke all on function public.review_atlas_feedback(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_atlas_feedback(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
