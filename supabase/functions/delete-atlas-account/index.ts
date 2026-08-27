import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import {
  RequestBodyError,
  bearerToken,
  handlePreflight,
  json,
  readJsonBody,
  rejectDisallowedOrigin,
  safeLogMessage
} from "../_shared/http.ts";

const PUBLIC_MEDIA_BUCKET = "kri-place-media";
const PRIVATE_MEDIA_BUCKET = "kri-place-media-private";
const DELETE_CONFIRMATION = "DELETE_MY_ACCOUNT_AND_DATA";
const MAX_REQUEST_BYTES = 4096;

type SupabaseAdmin = ReturnType<typeof createClient>;
type MediaBucket = typeof PUBLIC_MEDIA_BUCKET | typeof PRIVATE_MEDIA_BUCKET;

function mediaBucket(value: unknown): MediaBucket {
  return value === PRIVATE_MEDIA_BUCKET ? PRIVATE_MEDIA_BUCKET : PUBLIC_MEDIA_BUCKET;
}

function addMediaPath(paths: Map<MediaBucket, Set<string>>, bucket: MediaBucket, path: unknown): void {
  if (typeof path !== "string" || !path.trim()) return;
  const items = paths.get(bucket) ?? new Set<string>();
  items.add(path.trim());
  paths.set(bucket, items);
}

async function listStorageEntries(admin: SupabaseAdmin, bucket: MediaBucket, prefix: string): Promise<Array<{ name: string }>> {
  const entries: Array<{ name: string }> = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error(`Storage listing failed: ${safeLogMessage(error)}`);
    const page = (data ?? []).filter((entry): entry is typeof entry & { name: string } => Boolean(entry.name));
    entries.push(...page);
    if (page.length < pageSize) break;
  }
  return entries;
}

async function listPrivateUserMediaPaths(admin: SupabaseAdmin, userId: string): Promise<string[]> {
  const paths = new Set<string>();
  const root = `users/${userId}/places`;
  const placeFolders = await listStorageEntries(admin, PRIVATE_MEDIA_BUCKET, root);
  for (const entry of placeFolders) {
    const files = await listStorageEntries(admin, PRIVATE_MEDIA_BUCKET, `${root}/${entry.name}`);
    for (const file of files) paths.add(`${root}/${entry.name}/${file.name}`);
  }
  return [...paths];
}

async function removeStoragePaths(admin: SupabaseAdmin, bucket: MediaBucket, paths: string[]): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    if (batch.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`Storage cleanup failed for ${bucket}: ${safeLogMessage(error)}`);
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const blockedOrigin = rejectDisallowedOrigin(request);
  if (blockedOrigin) return blockedOrigin;

  const origin = request.headers.get("origin");
  if (request.method !== "POST") return json(origin, 405, { ok: false, error: "Method not allowed." });

  const jwt = bearerToken(request);
  if (!jwt) return json(origin, 401, { ok: false, error: "Authentication required." });

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) return json(origin, error.status, { ok: false, error: error.message });
    return json(origin, 400, { ok: false, error: "Invalid JSON request." });
  }
  if (payload.confirmation !== DELETE_CONFIRMATION) {
    return json(origin, 400, { ok: false, error: "Explicit deletion confirmation is required." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json(origin, 500, { ok: false, error: "Server configuration is incomplete." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let stage = "authenticate";
  try {
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return json(origin, 401, { ok: false, error: "Invalid or expired session." });
    const user = userData.user;

    stage = "role-check";
    const { data: ownerRow, error: ownerError } = await admin.from("atlas_owners").select("user_id").eq("user_id", user.id).maybeSingle();
    if (ownerError) throw ownerError;
    if (ownerRow) return json(origin, 403, { ok: false, error: "Administrator accounts cannot be deleted through the ordinary-user endpoint." });

    stage = "collect-user-data";
    const { data: places, error: placesError } = await admin
      .from("atlas_places")
      .select("id,cover_photo_path,cover_photo_bucket")
      .eq("created_by", user.id)
      .eq("submission_source", "user");
    if (placesError) throw placesError;
    const placeIds = (places ?? []).map((place) => String(place.id));
    const pathsByBucket = new Map<MediaBucket, Set<string>>();
    for (const place of places ?? []) addMediaPath(pathsByBucket, mediaBucket(place.cover_photo_bucket), place.cover_photo_path);

    if (placeIds.length > 0) {
      const { data: photoRows, error: photoError } = await admin
        .from("atlas_place_photos")
        .select("storage_path,storage_bucket")
        .in("place_id", placeIds);
      if (photoError) throw photoError;
      for (const row of photoRows ?? []) addMediaPath(pathsByBucket, mediaBucket(row.storage_bucket), row.storage_path);
    }
    for (const path of await listPrivateUserMediaPaths(admin, user.id)) {
      addMediaPath(pathsByBucket, PRIVATE_MEDIA_BUCKET, path);
    }

    // Storage cleanup is strict for full-account deletion. A successful response
    // therefore guarantees that no known user media was intentionally left behind.
    stage = "delete-storage";
    for (const [bucket, paths] of pathsByBucket) {
      await removeStoragePaths(admin, bucket, [...paths]);
    }

    stage = "delete-database-data";
    const { error: placeDeleteError } = await admin
      .from("atlas_places")
      .delete()
      .eq("created_by", user.id)
      .eq("submission_source", "user");
    if (placeDeleteError) throw placeDeleteError;

    for (const table of ["atlas_feedback", "atlas_notifications", "atlas_account_deletion_requests", "atlas_user_profiles"]) {
      const { error } = await admin.from(table).delete().eq("user_id", user.id);
      if (error && !["42P01", "42703"].includes(String((error as { code?: string }).code ?? ""))) throw error;
    }

    stage = "delete-auth-user";
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(user.id, false);
    if (authDeleteError) throw authDeleteError;

    stage = "notify-admins";
    const { data: owners, error: adminsError } = await admin.from("atlas_owners").select("user_id");
    if (adminsError) {
      console.error("[NAV KURD delete-atlas-account] owner lookup after deletion failed", safeLogMessage(adminsError));
    } else if ((owners ?? []).length > 0) {
      const notifications = (owners ?? []).map((owner) => ({
        user_id: owner.user_id,
        place_id: null,
        revision_id: null,
        kind: "account_deleted",
        title_ku: "یوزەرێک هەژمار و داتای خۆی سڕییەوە",
        title_ar: "حذف مستخدم حسابه وبياناته",
        title_en: "A user deleted their account and data",
        body_ku: "سڕینەوەکە بە تەواوی جێبەجێ کرا.",
        body_ar: "تم تنفيذ الحذف بالكامل.",
        body_en: "The deletion was completed."
      }));
      const { error: notificationError } = await admin.from("atlas_notifications").insert(notifications);
      if (notificationError) console.error("[NAV KURD delete-atlas-account] admin notification failed", safeLogMessage(notificationError));
    }

    return json(origin, 200, {
      ok: true,
      deleted_places: placeIds.length,
      media_cleanup_warning: false
    });
  } catch (error) {
    console.error(`[NAV KURD delete-atlas-account] stage=${stage}`, safeLogMessage(error));
    return json(origin, 500, {
      ok: false,
      code: `ACCOUNT_DELETE_${stage.toUpperCase().replace(/-/g, "_")}`,
      error: "Account deletion could not be completed safely. Please try again or contact support."
    });
  }
});
