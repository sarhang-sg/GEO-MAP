import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import {
  RequestBodyError,
  bearerToken,
  handlePreflight,
  json,
  readJsonBody,
  rejectDisallowedOrigin,
  safeLogMessage,
  validUuid
} from "../_shared/http.ts";

const PUBLIC_MEDIA_BUCKET = "kri-place-media";
const PRIVATE_MEDIA_BUCKET = "kri-place-media-private";
const DELETE_CONFIRMATION = "DELETE_MY_PLACE_PERMANENTLY";
const MAX_REQUEST_BYTES = 4096;

type AdminClient = ReturnType<typeof createClient>;
type MediaBucket = typeof PUBLIC_MEDIA_BUCKET | typeof PRIVATE_MEDIA_BUCKET;

function mediaBucket(value: unknown): MediaBucket {
  return value === PRIVATE_MEDIA_BUCKET ? PRIVATE_MEDIA_BUCKET : PUBLIC_MEDIA_BUCKET;
}

function addPath(paths: Map<MediaBucket, Set<string>>, bucket: MediaBucket, value: unknown): void {
  if (typeof value !== "string" || !value.trim()) return;
  const items = paths.get(bucket) ?? new Set<string>();
  items.add(value.trim());
  paths.set(bucket, items);
}

async function listPrivatePlaceMedia(admin: AdminClient, userId: string, placeId: string): Promise<string[]> {
  const prefix = `users/${userId}/places/${placeId}`;
  const paths: string[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage.from(PRIVATE_MEDIA_BUCKET).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error(`Storage listing failed: ${safeLogMessage(error)}`);
    const page = (data ?? []).filter((entry) => Boolean(entry.name));
    for (const entry of page) paths.push(`${prefix}/${entry.name}`);
    if (page.length < pageSize) break;
  }
  return paths;
}

async function removePaths(admin: AdminClient, bucket: MediaBucket, paths: string[]): Promise<boolean> {
  let warning = false;
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    if (batch.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) {
      warning = true;
      console.error(`[NAV KURD delete-atlas-place] cleanup bucket=${bucket}`, safeLogMessage(error));
    }
  }
  return warning;
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

  const placeId = typeof payload.place_id === "string" ? payload.place_id.trim() : "";
  if (!validUuid(placeId)) return json(origin, 400, { ok: false, error: "A valid place identifier is required." });
  if (payload.confirmation !== DELETE_CONFIRMATION) {
    return json(origin, 400, { ok: false, error: "Explicit deletion confirmation is required." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json(origin, 500, { ok: false, error: "Server configuration is incomplete." });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let stage = "authenticate";
  try {
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return json(origin, 401, { ok: false, error: "Invalid or expired session." });
    const user = userData.user;

    stage = "role-check";
    const { data: ownerRow, error: ownerError } = await admin.from("atlas_owners").select("user_id").eq("user_id", user.id).maybeSingle();
    if (ownerError) throw ownerError;
    if (ownerRow) return json(origin, 403, { ok: false, error: "Administrator accounts cannot use the ordinary-user place deletion endpoint." });

    stage = "load-place";
    const { data: place, error: placeError } = await admin
      .from("atlas_places")
      .select("id,name_ku,name_ar,name_en,created_by,submission_source,cover_photo_path,cover_photo_bucket")
      .eq("id", placeId)
      .maybeSingle();
    if (placeError) throw placeError;
    if (!place) return json(origin, 404, { ok: false, error: "Place not found." });
    if (place.created_by !== user.id || place.submission_source !== "user") {
      return json(origin, 403, { ok: false, error: "You can delete only your own user-submitted places." });
    }

    stage = "collect-media";
    const pathsByBucket = new Map<MediaBucket, Set<string>>();
    addPath(pathsByBucket, mediaBucket(place.cover_photo_bucket), place.cover_photo_path);
    const { data: photos, error: photosError } = await admin
      .from("atlas_place_photos")
      .select("storage_path,storage_bucket")
      .eq("place_id", placeId);
    if (photosError) throw photosError;
    for (const row of photos ?? []) addPath(pathsByBucket, mediaBucket(row.storage_bucket), row.storage_path);
    for (const path of await listPrivatePlaceMedia(admin, user.id, placeId)) {
      addPath(pathsByBucket, PRIVATE_MEDIA_BUCKET, path);
    }

    stage = "delete-place";
    const { data: deletedRows, error: deleteError } = await admin
      .from("atlas_places")
      .delete()
      .eq("id", placeId)
      .eq("created_by", user.id)
      .eq("submission_source", "user")
      .select("id");
    if (deleteError) throw deleteError;
    if ((deletedRows ?? []).length !== 1) throw new Error("The place changed before deletion and was not removed.");

    stage = "delete-media";
    let mediaCleanupWarning = false;
    for (const [bucket, paths] of pathsByBucket) {
      mediaCleanupWarning ||= await removePaths(admin, bucket, [...paths]);
    }

    stage = "notify-admins";
    const { data: owners, error: ownersError } = await admin.from("atlas_owners").select("user_id");
    if (ownersError) throw ownersError;
    if ((owners ?? []).length > 0) {
      const rows = (owners ?? []).map((owner) => ({
        user_id: owner.user_id,
        place_id: null,
        revision_id: null,
        kind: "deleted",
        title_ku: "یوزەر شوێنی خۆی سڕییەوە",
        title_ar: "حذف مستخدم مكانه",
        title_en: "A user deleted their place",
        body_ku: place.name_ku,
        body_ar: place.name_ar,
        body_en: place.name_en
      }));
      const { error } = await admin.from("atlas_notifications").insert(rows);
      if (error) console.error("[NAV KURD delete-atlas-place] admin notification failed", safeLogMessage(error));
    }

    return json(origin, 200, {
      ok: true,
      deleted_place_id: placeId,
      media_cleanup_warning: mediaCleanupWarning
    });
  } catch (error) {
    console.error(`[NAV KURD delete-atlas-place] stage=${stage}`, safeLogMessage(error));
    return json(origin, 500, {
      ok: false,
      code: `PLACE_DELETE_${stage.toUpperCase().replace(/-/g, "_")}`,
      error: "Place deletion could not be completed safely. Please try again or contact support."
    });
  }
});
