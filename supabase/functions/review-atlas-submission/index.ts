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
const MAX_REQUEST_BYTES = 8192;

type AdminClient = ReturnType<typeof createClient>;
type MediaMapRow = { photo_id: string; old_path: string; new_path: string };

function safeFileName(path: string): string {
  const value = path.split("/").filter(Boolean).at(-1) ?? "";
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(value)) throw new Error("Private media filename is invalid.");
  return value;
}

function fileExtension(name: string): string {
  const match = /(?:\.([A-Za-z0-9]{1,10}))$/.exec(name);
  return match ? `.${match[1].toLowerCase()}` : "";
}

async function removeObjects(client: AdminClient, bucket: string, paths: string[]): Promise<boolean> {
  let warning = false;
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    if (batch.length === 0) continue;
    const { error } = await client.storage.from(bucket).remove(batch);
    if (error) {
      warning = true;
      console.error(`[NAV KURD review-atlas-submission] cleanup bucket=${bucket}`, safeLogMessage(error));
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
  const decision = typeof payload.decision === "string" ? payload.decision.trim().toLowerCase() : "";
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  if (!validUuid(placeId)) return json(origin, 400, { ok: false, error: "A valid place identifier is required." });
  if (decision !== "approve" && decision !== "reject") {
    return json(origin, 400, { ok: false, error: "Decision must be approve or reject." });
  }
  if (note.length > 1200) return json(origin, 400, { ok: false, error: "Review note is too long." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json(origin, 500, { ok: false, error: "Server configuration is incomplete." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const promotionId = crypto.randomUUID();
  const uploadedPublicPaths: string[] = [];
  const privatePaths: string[] = [];
  let stage = "authenticate";
  try {
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return json(origin, 401, { ok: false, error: "Invalid or expired session." });
    const reviewer = userData.user;

    stage = "authorize";
    const { data: owner, error: ownerError } = await admin
      .from("atlas_owners")
      .select("user_id")
      .eq("user_id", reviewer.id)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) return json(origin, 403, { ok: false, error: "Administrator access required." });

    stage = "load-place";
    const { data: place, error: placeError } = await admin
      .from("atlas_places")
      .select("id,created_by,submission_source,review_status")
      .eq("id", placeId)
      .maybeSingle();
    if (placeError) throw placeError;
    if (!place) return json(origin, 404, { ok: false, error: "Place not found." });
    if (place.submission_source !== "user" || place.review_status !== "pending") {
      return json(origin, 409, { ok: false, error: "Only pending user submissions can be reviewed." });
    }
    const creatorId = typeof place.created_by === "string" ? place.created_by : "";
    if (!validUuid(creatorId)) throw new Error("The pending place has no valid creator identity.");

    const mediaMap: MediaMapRow[] = [];
    if (decision === "approve") {
      stage = "load-private-media";
      const { data: photos, error: photoError } = await admin
        .from("atlas_place_photos")
        .select("id,storage_path,storage_bucket")
        .eq("place_id", placeId)
        .eq("storage_bucket", PRIVATE_MEDIA_BUCKET)
        .order("sort_order", { ascending: true });
      if (photoError) throw photoError;

      stage = "copy-private-media";
      const expectedPrefix = `users/${creatorId}/places/${placeId}/`;
      for (const photo of photos ?? []) {
        const oldPath = typeof photo.storage_path === "string" ? photo.storage_path : "";
        const photoId = typeof photo.id === "string" ? photo.id : "";
        if (!validUuid(photoId) || !oldPath.startsWith(expectedPrefix)) {
          throw new Error("Private media row does not match the place creator/path contract.");
        }

        const originalName = safeFileName(oldPath);
        const newPath = `places/${placeId}/${photoId}-${promotionId}${fileExtension(originalName)}`;
        const { data: blob, error: downloadError } = await admin.storage.from(PRIVATE_MEDIA_BUCKET).download(oldPath);
        if (downloadError || !blob) throw new Error(`Private media download failed: ${safeLogMessage(downloadError)}`);
        if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(blob.type)) {
          throw new Error("Private media type is not allowed for publication.");
        }

        const { error: uploadError } = await admin.storage.from(PUBLIC_MEDIA_BUCKET).upload(newPath, blob, {
          cacheControl: "31536000",
          contentType: blob.type,
          upsert: false
        });
        if (uploadError) throw new Error(`Public media upload failed: ${safeLogMessage(uploadError)}`);

        privatePaths.push(oldPath);
        uploadedPublicPaths.push(newPath);
        mediaMap.push({ photo_id: photoId, old_path: oldPath, new_path: newPath });
      }
    }

    stage = "commit-review";
    const { data: reviewedPlace, error: reviewError } = await admin.rpc("review_atlas_place_with_media", {
      p_reviewer_id: reviewer.id,
      p_place_id: placeId,
      p_decision: decision,
      p_note: note || null,
      p_media_map: mediaMap
    });
    if (reviewError) throw reviewError;

    stage = "remove-private-media";
    const mediaCleanupWarning = privatePaths.length > 0
      ? await removeObjects(admin, PRIVATE_MEDIA_BUCKET, privatePaths)
      : false;

    return json(origin, 200, {
      ok: true,
      place: reviewedPlace,
      promoted_media: mediaMap.length,
      media_cleanup_warning: mediaCleanupWarning
    });
  } catch (error) {
    if (uploadedPublicPaths.length > 0) await removeObjects(admin, PUBLIC_MEDIA_BUCKET, uploadedPublicPaths);
    console.error(`[NAV KURD review-atlas-submission] stage=${stage}`, safeLogMessage(error));
    return json(origin, 500, {
      ok: false,
      code: `REVIEW_${stage.toUpperCase().replace(/-/g, "_")}`,
      error: "Review could not be completed safely. Please retry after confirming the submission and media state."
    });
  }
});
