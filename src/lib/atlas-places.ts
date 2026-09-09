import { createClient, type AuthChangeEvent, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { atlasTaxonomyEntry, atlasPlaceTypeSections, type AtlasPlaceTypeId } from "./atlas-taxonomy";
import { ATLAS_MEDIA_POLICY, ATLAS_TEXT_LIMITS, assertAtlasLocalizedText, assertAtlasText, atlasMetadataTextLimit, atlasNumericPolicy, normalizeAtlasTags, parseAtlasNumber } from "./atlas-content-policy";
import { atlasMetadataFieldsForSections } from "./atlas-editor-fields";
import { browserEnv, isCanonicalSupabaseConfigured } from "./runtime-env";

declare global {
  interface Window {
    __NAV_KURD_FLUTTER__?: boolean;
    navKurdAndroid?: {
      openExternal: (url: string) => Promise<boolean>;
    };
  }
}

export type AtlasCategory = AtlasPlaceTypeId;
export type AtlasPlaceMetadata = Record<string, string | number | boolean | null>;
export type AtlasPlaceStatus = "draft" | "published" | "hidden";
export type AtlasReviewStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type AtlasSubmissionSource = "admin" | "user";
export type AtlasAuthRole = "admin" | "user";
export type AtlasAuthIntent = "user" | "admin" | "feedback";
export type AtlasMediaBucket = "kri-place-media" | "kri-place-media-private";

export type AtlasPlaceRevisionPayload = {
  name_ku: string;
  name_ar: string | null;
  name_en: string | null;
  category: AtlasCategory | string;
  tags: string[];
  metadata: AtlasPlaceMetadata;
  description_ku: string | null;
  description_ar: string | null;
  description_en: string | null;
  longitude: number;
  latitude: number;
};

export type AtlasPlaceRevision = {
  id: string;
  place_id: string;
  revision_no: number;
  created_by: string;
  proposed_data: AtlasPlaceRevisionPayload;
  review_status: AtlasReviewStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AtlasPhoto = {
  id: string;
  storage_path: string;
  storage_bucket: AtlasMediaBucket;
  media_url?: string | null;
  caption_ku: string | null;
  caption_ar: string | null;
  caption_en: string | null;
  sort_order: number;
  created_at?: string;
};

export type AtlasPlace = {
  id: string;
  slug: string;
  name_ku: string;
  name_ar: string | null;
  name_en: string | null;
  category: AtlasCategory | string;
  tags: string[];
  metadata: AtlasPlaceMetadata;
  description_ku: string | null;
  description_ar: string | null;
  description_en: string | null;
  longitude: number;
  latitude: number;
  cover_photo_path: string | null;
  cover_photo_bucket: AtlasMediaBucket;
  status: AtlasPlaceStatus;
  submission_source: AtlasSubmissionSource;
  review_status: AtlasReviewStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_profile?: AtlasContributorProfile | null;
  atlas_place_photos?: AtlasPhoto[];
  active_revision?: AtlasPlaceRevision | null;
};

export type AtlasAuthIdentity = {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: AtlasAuthRole;
};

export type AtlasOwnerIdentity = AtlasAuthIdentity & { role: "admin" };

export type AtlasContributorProfile = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type AtlasNotification = {
  id: string;
  user_id: string;
  place_id: string | null;
  revision_id: string | null;
  kind: "submitted" | "revision_submitted" | "approved" | "rejected" | "withdrawn" | "deleted" | "account_deleted" | "feedback" | "system";
  title_ku: string;
  title_ar: string;
  title_en: string;
  body_ku: string | null;
  body_ar: string | null;
  body_en: string | null;
  is_read: boolean;
  created_at: string;
};


export type AtlasFeedbackCategory = "bug" | "data" | "place" | "search" | "login" | "offline" | "gps" | "ui" | "other";
export type AtlasFeedbackStatus = "new" | "in_progress" | "resolved" | "closed";

export type AtlasFeedback = {
  id: string;
  user_id: string;
  category: AtlasFeedbackCategory;
  message: string;
  diagnostics: Record<string, unknown>;
  locale: "ku" | "ar" | "en";
  app_version: string;
  map_data_version: string;
  status: AtlasFeedbackStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

export type AtlasUserProfile = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  locale: "ku" | "ar" | "en";
  terms_accepted_at: string | null;
  privacy_accepted_at: string | null;
};

export type AtlasNavigationHistory = {
  user_id: string;
  id: string;
  status: "arrived" | "cancelled";
  started_at: string;
  ended_at: string;
  destination: string;
  destination_longitude: number | null;
  destination_latitude: number | null;
  travel_mode: "car" | "bicycle" | "walking";
  planned_distance_meters: number;
  remaining_distance_meters: number;
  planned_duration_seconds: number;
  elapsed_seconds: number;
  created_at: string;
};

export type AtlasNavigationHistoryInput = {
  id: string;
  status: "arrived" | "cancelled";
  startedAt: number;
  endedAt: number;
  destination: string;
  coordinate: [number, number] | null;
  travelMode: "car" | "bicycle" | "walking";
  plannedDistanceMeters: number;
  remainingDistanceMeters: number;
  plannedDurationSeconds: number;
  elapsedSeconds: number;
};

export type AtlasPlaceWriteInput = {
  id?: string;
  slug?: string;
  name_ku: string;
  name_ar?: string;
  name_en?: string;
  category: AtlasCategory;
  tags?: string[];
  metadata?: AtlasPlaceMetadata;
  description_ku?: string;
  description_ar?: string;
  description_en?: string;
  longitude: number;
  latitude: number;
  status: AtlasPlaceStatus;
};

export type AtlasPhotoWriteInput = {
  caption_ku?: string;
  caption_ar?: string;
  caption_en?: string;
};

export type AtlasDeletePlaceResult = {
  mediaCleanupWarning: boolean;
};

export type AtlasUploadProgress = (percent: number) => void;

const url = browserEnv.supabaseUrl;
const key = browserEnv.supabasePublishableKey;
const publicMediaBucket = browserEnv.publicMediaBucket;
const privateMediaBucket = browserEnv.privateMediaBucket;
const PRIVATE_MEDIA_URL_TTL_SECONDS = 60 * 60;

const ALLOWED_MEDIA_TYPES = new Set<string>(ATLAS_MEDIA_POLICY.allowedMimeTypes);
const MANAGED_PLACE_CACHE_KEY = "nav-kurd-managed-place-cache-v2";
const MANAGED_PLACE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const configuredPublicAppUrl = browserEnv.publicAppUrl;
const ATLAS_CANONICAL_APP_URL = `${configuredPublicAppUrl || "https://geo-map-kappa.vercel.app"}/`;
const ATLAS_TRUSTED_APP_HOSTS = new Set([new URL(ATLAS_CANONICAL_APP_URL).hostname]);
const ATLAS_AUTH_ERROR_PARAMS = ["error", "error_code", "error_description"] as const;
const ATLAS_AUTH_INTENT_KEY = "nav-kurd-auth-intent-v1";
const ATLAS_AUTH_INTENT_MAX_AGE_MS = 5 * 60 * 1000;

type StoredAtlasAuthIntent = {
  intent: AtlasAuthIntent;
  createdAt: number;
};

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function setAtlasAuthIntent(intent: AtlasAuthIntent): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredAtlasAuthIntent = { intent, createdAt: Date.now() };
    window.sessionStorage.setItem(ATLAS_AUTH_INTENT_KEY, JSON.stringify(payload));
  } catch {
    /* storage may be unavailable */
  }
}

export function consumeAtlasAuthIntent(): AtlasAuthIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ATLAS_AUTH_INTENT_KEY);
    window.sessionStorage.removeItem(ATLAS_AUTH_INTENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed as Partial<StoredAtlasAuthIntent>;
    if (payload.intent !== "admin" && payload.intent !== "feedback" && payload.intent !== "user") return null;
    if (typeof payload.createdAt !== "number" || !Number.isFinite(payload.createdAt)) return null;
    if (Date.now() - payload.createdAt > ATLAS_AUTH_INTENT_MAX_AGE_MS) return null;
    return payload.intent;
  } catch {
    return null;
  }
}

function clearAtlasAuthNavigationState(): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(ATLAS_AUTH_INTENT_KEY); } catch { /* best effort */ }
  const current = new URL(window.location.href);
  current.searchParams.delete("admin");
  for (const key of ATLAS_AUTH_ERROR_PARAMS) current.searchParams.delete(key);
  if (`${current.pathname}${current.search}${current.hash}` !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
  }
}

function clearAtlasLocalAuthStorage(): void {
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (storageKey && (/^sb-[a-z0-9]+-auth-token$/iu.test(storageKey) || storageKey.includes("auth-token-code-verifier"))) {
          keys.push(storageKey);
        }
      }
      for (const storageKey of keys) storage.removeItem(storageKey);
      storage.removeItem(ATLAS_AUTH_INTENT_KEY);
    } catch { /* local storage may be unavailable */ }
  }
}

export function atlasOAuthRedirectUrl(): string {
  if (typeof window === "undefined") return ATLAS_CANONICAL_APP_URL;
  // Keep the Android callback on the exact production URL that is already in
  // Supabase's redirect allow-list. Android App Links (with a custom-scheme
  // fallback in bootstrap.ts) return the one-time PKCE code to the WebView.
  if (window.__NAV_KURD_FLUTTER__ === true) {
    const nativeRedirect = new URL(ATLAS_CANONICAL_APP_URL);
    nativeRedirect.searchParams.set("nav_kurd_native_auth", "1");
    return nativeRedirect.toString();
  }
  const host = window.location.hostname.toLocaleLowerCase("en-US");
  if (isLocalDevelopmentHost(host) || ATLAS_TRUSTED_APP_HOSTS.has(host)) {
    return `${window.location.origin}${window.location.pathname}`;
  }
  return ATLAS_CANONICAL_APP_URL;
}

export function consumeAtlasOAuthCallbackError(): string | null {
  if (typeof window === "undefined") return null;
  const current = new URL(window.location.href);
  const hashParams = current.hash.startsWith("#") ? new URLSearchParams(current.hash.slice(1)) : new URLSearchParams();
  const message = current.searchParams.get("error_description")
    ?? hashParams.get("error_description")
    ?? current.searchParams.get("error")
    ?? hashParams.get("error");
  if (!message) return null;
  for (const key of ATLAS_AUTH_ERROR_PARAMS) {
    current.searchParams.delete(key);
    hashParams.delete(key);
  }
  current.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
  window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
  return message;
}
// Keep place and photo reads separate. This avoids relying on PostgREST embedded-relation
// discovery in the owner panel, while preserving the same AtlasPlace shape for the UI.
const placeSelect = "*";
const photoSelect = "id,place_id,storage_path,storage_bucket,caption_ku,caption_ar,caption_en,sort_order,created_at";

export const isAtlasBackendConfigured = isCanonicalSupabaseConfigured();
export const atlasSupabase: SupabaseClient | null = isAtlasBackendConfigured
  ? createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

const AUTH_IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
let authIdentityCache: { userId: string; identity: AtlasAuthIdentity; expiresAt: number } | null = null;
let authIdentityInFlight: { userId: string; promise: Promise<AtlasAuthIdentity> } | null = null;

function clearAtlasAuthIdentityCache(): void {
  authIdentityCache = null;
  authIdentityInFlight = null;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

function isLikelyNetworkError(error: unknown): boolean {
  const message = atlasErrorMessage(error, "").toLocaleLowerCase("en-US");
  return /fetch|network|networkerror|failed to fetch|load failed|connection|timeout|offline/.test(message);
}

function writeManagedPlaceCache(places: AtlasPlace[]): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(MANAGED_PLACE_CACHE_KEY, JSON.stringify({ version: 2, savedAt: Date.now(), places }));
  } catch { /* cache is best effort only */ }
}

function readManagedPlaceCache(): AtlasPlace[] {
  const storage = browserStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(MANAGED_PLACE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; savedAt?: number; places?: unknown[] };
    if (parsed.version !== 2 || !Array.isArray(parsed.places)) return [];
    if (Date.now() - Number(parsed.savedAt ?? 0) > MANAGED_PLACE_CACHE_MAX_AGE_MS) return [];
    return parsed.places.map((row) => normalizeAtlasPlace(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

function optionalText(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length ? text : null;
}

function normalizeTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_"))
    .filter(Boolean)))
    .slice(0, 40);
}

function normalizeMetadata(value: unknown): AtlasPlaceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: AtlasPlaceMetadata = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(key)) continue;
    if (typeof raw === "string") {
      const cleaned = raw.trim();
      if (cleaned) output[key] = cleaned.slice(0, 1000);
    } else if (typeof raw === "number" && Number.isFinite(raw)) output[key] = raw;
    else if (typeof raw === "boolean") output[key] = raw;
    else if (raw === null) output[key] = null;
  }
  return output;
}

function normalizeAtlasMediaBucket(value: unknown): AtlasMediaBucket {
  return value === privateMediaBucket ? "kri-place-media-private" : "kri-place-media";
}

function publicMediaUrl(path: string): string | null {
  if (!atlasSupabase || !path) return null;
  const { data } = atlasSupabase.storage.from(publicMediaBucket).getPublicUrl(path);
  return data.publicUrl || null;
}

function normalizeAtlasPlace(row: Record<string, unknown>): AtlasPlace {
  const reviewStatus = ["pending", "approved", "rejected", "withdrawn"].includes(String(row.review_status))
    ? String(row.review_status) as AtlasReviewStatus
    : "approved";
  const submissionSource = row.submission_source === "user" ? "user" : "admin";
  return {
    ...(row as unknown as AtlasPlace),
    submission_source: submissionSource,
    review_status: reviewStatus,
    review_note: typeof row.review_note === "string" ? row.review_note : null,
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    cover_photo_bucket: normalizeAtlasMediaBucket(row.cover_photo_bucket),
    tags: normalizeTags(row.tags),
    metadata: normalizeMetadata(row.metadata)
  };
}

function normalizeRevisionPayload(value: unknown): AtlasPlaceRevisionPayload {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    name_ku: typeof source.name_ku === "string" ? source.name_ku : "",
    name_ar: typeof source.name_ar === "string" ? source.name_ar : null,
    name_en: typeof source.name_en === "string" ? source.name_en : null,
    category: typeof source.category === "string" ? source.category : "other",
    tags: normalizeTags(source.tags),
    metadata: normalizeMetadata(source.metadata),
    description_ku: typeof source.description_ku === "string" ? source.description_ku : null,
    description_ar: typeof source.description_ar === "string" ? source.description_ar : null,
    description_en: typeof source.description_en === "string" ? source.description_en : null,
    longitude: Number(source.longitude),
    latitude: Number(source.latitude)
  };
}

function normalizeAtlasRevision(row: Record<string, unknown>): AtlasPlaceRevision {
  const reviewStatus = ["pending", "approved", "rejected", "withdrawn"].includes(String(row.review_status))
    ? String(row.review_status) as AtlasReviewStatus
    : "pending";
  return {
    ...(row as unknown as AtlasPlaceRevision),
    revision_no: Number(row.revision_no),
    proposed_data: normalizeRevisionPayload(row.proposed_data),
    review_status: reviewStatus,
    review_note: typeof row.review_note === "string" ? row.review_note : null,
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null
  };
}

export function atlasPlaceWithRevisionPreview(place: AtlasPlace): AtlasPlace {
  const revision = place.active_revision;
  if (!revision || !["pending", "rejected", "withdrawn"].includes(revision.review_status)) return place;
  const proposed = revision.proposed_data;
  return {
    ...place,
    name_ku: proposed.name_ku,
    name_ar: proposed.name_ar,
    name_en: proposed.name_en,
    category: proposed.category,
    tags: proposed.tags,
    metadata: proposed.metadata,
    description_ku: proposed.description_ku,
    description_ar: proposed.description_ar,
    description_en: proposed.description_en,
    longitude: proposed.longitude,
    latitude: proposed.latitude
  };
}

function taxonomySchemaMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const source = error as AtlasErrorRecord;
  const message = [source.message, source.details, source.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("en-US");
  const code = typeof source.code === "string" ? source.code : "";
  if (code === "42703" || code === "23514" || /column .*tags|column .*metadata|category.*check constraint|atlas_places_category_check/.test(message)) {
    return "NAV KURD taxonomy schema migration is required before saving expanded place types. Apply supabase/migrations/20260712_000003_atlas_taxonomy_metadata.sql in Supabase SQL Editor.";
  }
  return null;
}

function requireAtlasBackend(): SupabaseClient {
  if (!atlasSupabase) throw new Error("Supabase is not configured for this deployment.");
  return atlasSupabase;
}

function assertPlaceInput(input: AtlasPlaceWriteInput): void {
  if (!String(input.name_ku ?? "").trim()) throw new Error("Kurdish place name is required.");
  assertAtlasLocalizedText(input.name_ku, ATLAS_TEXT_LIMITS.name, "Kurdish name", "kurdish");
  assertAtlasLocalizedText(input.name_ar, ATLAS_TEXT_LIMITS.name, "Arabic name", "arabic");
  assertAtlasLocalizedText(input.name_en, ATLAS_TEXT_LIMITS.name, "English name", "latin");
  assertAtlasLocalizedText(input.description_ku, ATLAS_TEXT_LIMITS.description, "Kurdish description", "kurdish");
  assertAtlasLocalizedText(input.description_ar, ATLAS_TEXT_LIMITS.description, "Arabic description", "arabic");
  assertAtlasLocalizedText(input.description_en, ATLAS_TEXT_LIMITS.description, "English description", "latin");
  if (!atlasTaxonomyEntry(input.category)) throw new Error("Choose a valid NAV KURD place type.");
  normalizeAtlasTags(input.tags ?? []);
  const allowedFields = atlasMetadataFieldsForSections(atlasPlaceTypeSections(input.category));
  const allowedKeys = new Set(allowedFields.map((field) => field.key));
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (!allowedKeys.has(key)) throw new Error(`Metadata field ${key} is not valid for this place type.`);
    const field = allowedFields.find((candidate) => candidate.key === key);
    if (!field || value === null) continue;
    const label = field.label.en;
    const numericPolicy = atlasNumericPolicy(field);
    if (numericPolicy) { parseAtlasNumber(value, numericPolicy, label); continue; }
    const textLimit = atlasMetadataTextLimit(field);
    if (textLimit) assertAtlasText(String(value), textLimit, label);
  }
  if (!Number.isFinite(input.longitude) || input.longitude < 42.18 || input.longitude > 46.5) throw new Error("Longitude must be inside the Kurdistan project boundary.");
  if (!Number.isFinite(input.latitude) || input.latitude < 34.22 || input.latitude > 37.47) throw new Error("Latitude must be inside the Kurdistan project boundary.");
}

function assertUserLocalizedPlaceInput(input: AtlasPlaceWriteInput): void {
  assertPlaceInput(input);
}

function assertUserLocalizedPhotoInput(input: AtlasPhotoWriteInput): void {
  assertAtlasLocalizedText(input.caption_ku, ATLAS_TEXT_LIMITS.caption, "Kurdish caption", "kurdish");
  assertAtlasLocalizedText(input.caption_ar, ATLAS_TEXT_LIMITS.caption, "Arabic caption", "arabic");
  assertAtlasLocalizedText(input.caption_en, ATLAS_TEXT_LIMITS.caption, "English caption", "latin");
}

function assertPhotoFile(file: File): void {
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) throw new Error("Use a JPEG, PNG or WebP image.");
  if (file.size <= 0) throw new Error("The selected image is empty.");
  if (file.size > ATLAS_MEDIA_POLICY.maxBytes) throw new Error("Each image must be 10 MB or smaller.");
}

function generatedSlug(category: string): string {
  const categoryToken = category.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "place";
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${categoryToken}-${Date.now().toString(36)}-${random}`;
}

function uniqueMediaPath(placeId: string, file: File, userId?: string): string {
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const token = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const prefix = userId ? `users/${userId}/places` : "places";
  return `${prefix}/${placeId}/${token}.${extension}`;
}

function sortedPhotos(place: AtlasPlace): AtlasPhoto[] {
  return [...(place.atlas_place_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

type AtlasPhotoRow = AtlasPhoto & { place_id: string };

type AtlasErrorRecord = {
  message?: unknown;
  error_description?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  status?: unknown;
};

/**
 * Supabase/PostgREST errors are plain objects in some browser runtimes.
 * Never pass them through String(error), which renders the unhelpful "[object Object]".
 */
function isAuthSessionMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const source = error as AtlasErrorRecord;
  const name = typeof (source as { name?: unknown }).name === "string" ? String((source as { name?: unknown }).name) : "";
  const message = atlasErrorMessage(error, "").toLocaleLowerCase("en-US");
  const status = Number(source.status ?? 0);
  return name === "AuthSessionMissingError"
    || status === 400 && /auth session missing|session.*missing|no session/.test(message)
    || /auth session missing|session.*missing|no session/.test(message);
}

export function atlasErrorMessage(error: unknown, fallback = "An unexpected Atlas backend error occurred."): string {
  const inspect = error instanceof Error ? error.message : error && typeof error === "object"
    ? [String((error as AtlasErrorRecord).message ?? ""), String((error as AtlasErrorRecord).details ?? ""), String((error as AtlasErrorRecord).code ?? "")].join(" ")
    : String(error ?? "");
  if (/nav_kurd_text_matches_exact_language|permission denied.*function/i.test(inspect)) {
    return "NAV KURD language validation is being synchronized. Apply the latest Supabase migration, then refresh and retry; your form data remains saved.";
  }
  if (/failed to send a request to the edge function|failed to fetch|functionshttperror|origin is not allowed/i.test(inspect)) {
    return "NAV KURD could not reach the secure account service. Refresh once and retry; if it continues, the latest Edge Function update must be deployed.";
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const source = error as AtlasErrorRecord;
    const primary = [source.message, source.error_description, source.details]
      .find((value) => typeof value === "string" && value.trim());
    const code = typeof source.code === "string" && source.code.trim() ? source.code.trim() : "";
    if (typeof primary === "string") return code ? `${primary.trim()} (${code})` : primary.trim();
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to a safe generic message.
    }
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

async function atlasFunctionError(error: unknown, fallback: string): Promise<Error> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (typeof Response !== "undefined" && context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown; message?: unknown; code?: unknown };
        const message = typeof payload.error === "string" && payload.error.trim()
          ? payload.error.trim()
          : typeof payload.message === "string" && payload.message.trim()
            ? payload.message.trim()
            : "";
        if (message) return new Error(message);
      } catch {
        try {
          const text = await context.clone().text();
          if (text.trim()) return new Error(text.trim());
        } catch { /* safe fallback below */ }
      }
    }
  }
  return new Error(atlasErrorMessage(error, fallback));
}

async function invokeAuthenticatedAtlasFunction<T extends Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<T> {
  const client = requireAtlasBackend();
  const invoke = async (refresh: boolean) => {
    const sessionResult = refresh ? await client.auth.refreshSession() : await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    const accessToken = sessionResult.data.session?.access_token ?? "";
    if (!accessToken) throw new Error("Your sign-in session has expired. Sign in again and retry.");
    return client.functions.invoke(functionName, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  };

  let result = await invoke(false);
  const response = result.error && typeof result.error === "object" && "context" in result.error
    ? (result.error as { context?: unknown }).context
    : null;
  if (result.error && typeof Response !== "undefined" && response instanceof Response && response.status === 401) {
    result = await invoke(true);
  }
  if (result.error) throw await atlasFunctionError(result.error, fallback);
  if (!result.data || typeof result.data !== "object") throw new Error(`${fallback} The service returned an invalid response.`);
  return result.data as T;
}

function encodedStoragePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function uploadAtlasStorageObject(
  storageBucket: AtlasMediaBucket,
  storagePath: string,
  file: File,
  onProgress?: AtlasUploadProgress
): Promise<void> {
  const client = requireAtlasBackend();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token ?? "";

  if (!accessToken || typeof XMLHttpRequest === "undefined") {
    const { error } = await client.storage.from(storageBucket).upload(storagePath, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false
    });
    if (error) throw error;
    onProgress?.(100);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${url}/storage/v1/object/${encodeURIComponent(storageBucket)}/${encodedStoragePath(storagePath)}`, true);
    request.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    request.setRequestHeader("apikey", key);
    request.setRequestHeader("x-upsert", "false");
    request.setRequestHeader("cache-control", "31536000");
    request.setRequestHeader("Content-Type", file.type);
    request.timeout = 120000;
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
    });
    request.addEventListener("error", () => reject(new Error("Image upload failed because the network connection was interrupted.")));
    request.addEventListener("abort", () => reject(new Error("Image upload was cancelled.")));
    request.addEventListener("timeout", () => reject(new Error("Image upload timed out. Please retry.")));
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      let message = `Image upload failed (${request.status}).`;
      try {
        const payload = JSON.parse(request.responseText) as { message?: unknown; error?: unknown };
        const candidate = typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : "";
        if (candidate.trim()) message = candidate.trim();
      } catch { /* use safe status message */ }
      reject(new Error(message));
    });
    request.send(file);
  });
}

async function hydrateAtlasPlaces(client: SupabaseClient, places: AtlasPlace[]): Promise<AtlasPlace[]> {
  if (places.length === 0) return [];
  const placeIds = places.map((place) => place.id);
  const { data, error } = await client
    .from("atlas_place_photos")
    .select(photoSelect)
    .in("place_id", placeIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const privatePaths = Array.from(new Set(
    ((data ?? []) as AtlasPhotoRow[])
      .filter((row) => normalizeAtlasMediaBucket(row.storage_bucket) === "kri-place-media-private")
      .map((row) => row.storage_path)
      .filter(Boolean)
  ));
  const signedByPath = new Map<string, string>();
  if (privatePaths.length > 0) {
    const { data: signedRows, error: signedError } = await client.storage
      .from(privateMediaBucket)
      .createSignedUrls(privatePaths, PRIVATE_MEDIA_URL_TTL_SECONDS);
    if (signedError) throw signedError;
    for (const row of signedRows ?? []) {
      if (row.path && row.signedUrl) signedByPath.set(row.path, row.signedUrl);
    }
  }

  const photosByPlace = new Map<string, AtlasPhoto[]>();
  for (const row of (data ?? []) as AtlasPhotoRow[]) {
    const photos = photosByPlace.get(row.place_id) ?? [];
    const storageBucket = normalizeAtlasMediaBucket(row.storage_bucket);
    photos.push({
      id: row.id,
      storage_path: row.storage_path,
      storage_bucket: storageBucket,
      media_url: storageBucket === "kri-place-media-private"
        ? signedByPath.get(row.storage_path) ?? null
        : publicMediaUrl(row.storage_path),
      caption_ku: row.caption_ku,
      caption_ar: row.caption_ar,
      caption_en: row.caption_en,
      sort_order: row.sort_order,
      created_at: row.created_at
    });
    photosByPlace.set(row.place_id, photos);
  }

  return places.map((place) => ({
    ...place,
    tags: normalizeTags(place.tags),
    metadata: normalizeMetadata(place.metadata),
    atlas_place_photos: photosByPlace.get(place.id) ?? []
  }));
}

async function attachAtlasRevisions(client: SupabaseClient, places: AtlasPlace[]): Promise<AtlasPlace[]> {
  if (places.length === 0) return places;
  const { data, error } = await client
    .from("atlas_place_revisions")
    .select("id,place_id,revision_no,created_by,proposed_data,review_status,review_note,reviewed_by,reviewed_at,created_at,updated_at")
    .in("place_id", places.map((place) => place.id))
    .order("revision_no", { ascending: false });
  if (error) {
    if ((error as { code?: string }).code === "42P01") return places;
    throw error;
  }
  const latestByPlace = new Map<string, AtlasPlaceRevision>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const revision = normalizeAtlasRevision(row);
    const current = latestByPlace.get(revision.place_id);
    if (!current || revision.review_status === "pending" || (current.review_status !== "pending" && revision.revision_no > current.revision_no)) {
      latestByPlace.set(revision.place_id, revision);
    }
  }
  return places.map((place) => ({ ...place, active_revision: latestByPlace.get(place.id) ?? null }));
}

async function attachAtlasContributorProfiles(client: SupabaseClient, places: AtlasPlace[]): Promise<AtlasPlace[]> {
  const userIds = Array.from(new Set(places
    .filter((place) => place.submission_source === "user" && Boolean(place.created_by))
    .map((place) => String(place.created_by))));
  if (userIds.length === 0) return places;

  const { data, error } = await client
    .from("atlas_user_profiles")
    .select("user_id,display_name,avatar_url")
    .in("user_id", userIds);
  if (error) {
    // Keep the owner panel functional during the short window before the matching
    // migration is applied. Contributor identity is an enhancement, never a blocker.
    if (["42501", "42P01"].includes(String((error as { code?: string }).code ?? ""))) return places;
    throw error;
  }
  const byId = new Map<string, AtlasContributorProfile>();
  for (const row of (data ?? []) as AtlasContributorProfile[]) byId.set(row.user_id, row);
  return places.map((place) => ({
    ...place,
    created_by_profile: place.created_by ? byId.get(place.created_by) ?? null : null
  }));
}

export async function loadPublishedAtlasPlaces(): Promise<AtlasPlace[]> {
  if (!atlasSupabase) return [];
  const { data, error } = await atlasSupabase
    .from("atlas_places")
    .select(placeSelect)
    .eq("status", "published")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return hydrateAtlasPlaces(atlasSupabase, ((data ?? []) as Record<string, unknown>[]).map(normalizeAtlasPlace));
}

export async function loadManagedAtlasPlaces(): Promise<AtlasPlace[]> {
  if (!atlasSupabase) return readManagedPlaceCache();
  try {
    const { data, error } = await atlasSupabase
      .from("atlas_places")
      .select(placeSelect)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const hydrated = await hydrateAtlasPlaces(atlasSupabase, ((data ?? []) as Record<string, unknown>[]).map(normalizeAtlasPlace));
    const revised = await attachAtlasRevisions(atlasSupabase, hydrated);
    const places = await attachAtlasContributorProfiles(atlasSupabase, revised);
    writeManagedPlaceCache(places);
    return places;
  } catch (error) {
    const cached = readManagedPlaceCache();
    if (cached.length && isLikelyNetworkError(error)) return cached;
    throw error;
  }
}

export async function loadManagedAtlasPlace(id: string): Promise<AtlasPlace | null> {
  const cached = readManagedPlaceCache().find((place) => place.id === id) ?? null;
  if (!atlasSupabase) return cached;
  try {
    const { data, error } = await atlasSupabase.from("atlas_places").select(placeSelect).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const hydrated = await hydrateAtlasPlaces(atlasSupabase, [normalizeAtlasPlace(data as Record<string, unknown>)]);
    const revised = await attachAtlasRevisions(atlasSupabase, hydrated);
    const [place] = await attachAtlasContributorProfiles(atlasSupabase, revised);
    if (!place) return null;
    const remainingCache = readManagedPlaceCache().filter((candidate) => candidate.id !== place.id);
    writeManagedPlaceCache([place, ...remainingCache]);
    return place;
  } catch (error) {
    if (cached && isLikelyNetworkError(error)) return cached;
    throw error;
  }
}

async function currentAtlasAuthUser(): Promise<User | null> {
  if (!atlasSupabase) return null;
  // Session restoration is local and immediate after an OAuth redirect. Using it
  // first prevents the account panel from briefly rendering the signed-out copy
  // while getUser() is still waiting on the network.
  const { data: sessionData, error: sessionError } = await atlasSupabase.auth.getSession();
  if (sessionError && !isAuthSessionMissing(sessionError)) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;
  const { data: userData, error: userError } = await atlasSupabase.auth.getUser();
  if (userError) {
    if (isAuthSessionMissing(userError)) return null;
    throw userError;
  }
  return userData.user ?? null;
}

export async function getAtlasAuthIdentity(): Promise<AtlasAuthIdentity | null> {
  if (!atlasSupabase) return null;
  const user = await currentAtlasAuthUser();
  if (!user) {
    clearAtlasAuthIdentityCache();
    return null;
  }
  const cached = authIdentityCache;
  if (cached && cached.userId === user.id && cached.expiresAt > Date.now()) return cached.identity;
  const inFlight = authIdentityInFlight;
  if (inFlight && inFlight.userId === user.id) return inFlight.promise;

  const promise = (async (): Promise<AtlasAuthIdentity> => {
    const loadOwnerRole = () => atlasSupabase
      .from("atlas_owners")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    let { data: ownerRow, error: ownerError } = await loadOwnerRole();
    if (ownerError && isLikelyNetworkError(ownerError)) {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      ({ data: ownerRow, error: ownerError } = await loadOwnerRole());
    }
    const metadata = user.user_metadata ?? {};
    const displayName = typeof metadata.full_name === "string" ? metadata.full_name
      : typeof metadata.name === "string" ? metadata.name
      : null;
    const avatarUrl = typeof metadata.avatar_url === "string" ? metadata.avatar_url
      : typeof metadata.picture === "string" ? metadata.picture
      : null;
    if (ownerError && cached?.userId === user.id && isLikelyNetworkError(ownerError)) {
      authIdentityCache = { ...cached, expiresAt: Date.now() + 60_000 };
      return cached.identity;
    }
    if (ownerError && isLikelyNetworkError(ownerError)) {
      // A short owner-role lookup outage must not strand a newly authenticated
      // mobile user on the loading screen. Fail closed to the ordinary-user
      // role; protected admin actions remain enforced by Supabase/Edge RLS and
      // a later refresh can promote the cached identity after verification.
      const identity: AtlasAuthIdentity = {
        userId: user.id,
        email: user.email ?? null,
        displayName,
        avatarUrl,
        role: "user"
      };
      authIdentityCache = { userId: user.id, identity, expiresAt: Date.now() + 60_000 };
      return identity;
    }
    if (ownerError) throw new Error("NAV KURD could not verify the account role. Access is blocked until role verification succeeds.");
    const identity: AtlasAuthIdentity = {
      userId: user.id,
      email: user.email ?? null,
      displayName,
      avatarUrl,
      role: ownerRow ? "admin" : "user"
    };
    authIdentityCache = { userId: user.id, identity, expiresAt: Date.now() + AUTH_IDENTITY_CACHE_TTL_MS };
    return identity;
  })().finally(() => {
    if (authIdentityInFlight?.promise === promise) authIdentityInFlight = null;
  });
  authIdentityInFlight = { userId: user.id, promise };
  return promise;
}


export async function signInAtlasWithGoogle(intent: AtlasAuthIntent = "user"): Promise<void> {
  const client = requireAtlasBackend();
  setAtlasAuthIntent(intent);
  const redirectTo = atlasOAuthRedirectUrl();
  const isFlutterAndroid = typeof window !== "undefined" && window.__NAV_KURD_FLUTTER__ === true;
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
      skipBrowserRedirect: isFlutterAndroid
    }
  });
  if (error) throw error;
  if (isFlutterAndroid) {
    const authUrl = data.url;
    if (!authUrl || !window.navKurdAndroid?.openExternal) {
      throw new Error("NAV KURD could not open the secure Google sign-in page.");
    }
    const opened = await window.navKurdAndroid.openExternal(authUrl);
    if (!opened) throw new Error("No secure browser is available for Google sign-in.");
  }
}

export type AtlasActivityKind = "sign_in" | "active" | "heartbeat" | "resume" | "gps";

/** Records authenticated activity using the database server clock. */
export async function recordAtlasUserActivity(kind: AtlasActivityKind = "active"): Promise<string | null> {
  if (!atlasSupabase || document.hidden || !navigator.onLine) return null;
  try {
    const { data: sessionData, error: sessionError } = await atlasSupabase.auth.getSession();
    if (sessionError && !isAuthSessionMissing(sessionError)) return null;
    if (!sessionData.session?.access_token) return null;
    const result = await atlasSupabase.rpc("record_atlas_activity", { p_event: kind });
    return !result.error && typeof result.data === "string" ? result.data : null;
  } catch {
    return null;
  }
}

export async function signOutAtlasUser(): Promise<void> {
  clearAtlasAuthIdentityCache();
  clearAtlasAuthNavigationState();
  if (!atlasSupabase) return;
  const { error } = await atlasSupabase.auth.signOut({ scope: "local" });
  if (error && !isAuthSessionMissing(error)) throw error;
}

export async function getAtlasUserProfile(identityOverride?: AtlasAuthIdentity): Promise<AtlasUserProfile | null> {
  const identity = identityOverride ?? await getAtlasAuthIdentity();
  if (!identity || !atlasSupabase) return null;
  const { data, error } = await atlasSupabase
    .from("atlas_user_profiles")
    .select("user_id,display_name,avatar_url,locale,terms_accepted_at,privacy_accepted_at")
    .eq("user_id", identity.userId)
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
  return data as AtlasUserProfile | null;
}

function navigationHistoryRow(input: AtlasNavigationHistoryInput, userId: string): Omit<AtlasNavigationHistory, "created_at"> {
  const nonNegativeInteger = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const startedAt = Number.isFinite(input.startedAt) ? input.startedAt : Date.now();
  const endedAt = Number.isFinite(input.endedAt) ? Math.max(startedAt, input.endedAt) : startedAt;
  const longitude = input.coordinate && Number.isFinite(input.coordinate[0]) && input.coordinate[0] >= -180 && input.coordinate[0] <= 180
    ? input.coordinate[0] : null;
  const latitude = input.coordinate && Number.isFinite(input.coordinate[1]) && input.coordinate[1] >= -90 && input.coordinate[1] <= 90
    ? input.coordinate[1] : null;
  return {
    user_id: userId,
    id: input.id.trim().slice(0, 160),
    status: input.status,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    destination: input.destination.trim().slice(0, 300) || "Destination",
    destination_longitude: longitude,
    destination_latitude: latitude,
    travel_mode: input.travelMode,
    planned_distance_meters: nonNegativeInteger(input.plannedDistanceMeters),
    remaining_distance_meters: nonNegativeInteger(input.remainingDistanceMeters),
    planned_duration_seconds: nonNegativeInteger(input.plannedDurationSeconds),
    elapsed_seconds: nonNegativeInteger(input.elapsedSeconds)
  };
}

export async function loadAtlasNavigationHistory(limit = 100, expectedUserId?: string): Promise<AtlasNavigationHistory[]> {
  if (!atlasSupabase) return [];
  const identity = await getAtlasAuthIdentity();
  if (expectedUserId && identity?.userId !== expectedUserId) throw new Error("Navigation history account changed before synchronization.");
  if (!identity) return [];
  const { data, error } = await atlasSupabase
    .from("atlas_navigation_history")
    .select("user_id,id,status,started_at,ended_at,destination,destination_longitude,destination_latitude,travel_mode,planned_distance_meters,remaining_distance_meters,planned_duration_seconds,elapsed_seconds,created_at")
    .eq("user_id", identity.userId)
    .order("ended_at", { ascending: false })
    .limit(Math.max(1, Math.min(250, Math.round(limit))));
  if (error) throw error;
  return (data ?? []) as AtlasNavigationHistory[];
}

export async function syncAtlasNavigationHistory(inputs: readonly AtlasNavigationHistoryInput[], expectedUserId?: string): Promise<number> {
  if (!atlasSupabase || inputs.length === 0) return 0;
  const identity = await getAtlasAuthIdentity();
  if (expectedUserId && identity?.userId !== expectedUserId) throw new Error("Navigation history account changed before synchronization.");
  if (!identity) return 0;
  const rows = inputs.filter((input) => input.id.trim()).map((input) => navigationHistoryRow(input, identity.userId));
  if (rows.length === 0) return 0;
  const { error } = await atlasSupabase
    .from("atlas_navigation_history")
    .upsert(rows, { onConflict: "user_id,id" });
  if (error) throw error;
  return rows.length;
}

export async function deleteAtlasNavigationHistory(id: string): Promise<void> {
  if (!atlasSupabase) return;
  const identity = await getAtlasAuthIdentity();
  if (!identity) return;
  const { error } = await atlasSupabase.from("atlas_navigation_history").delete().eq("user_id", identity.userId).eq("id", id);
  if (error) throw error;
}

export async function clearAtlasNavigationHistory(): Promise<number> {
  if (!atlasSupabase) return 0;
  const identity = await getAtlasAuthIdentity();
  if (!identity) return 0;
  const { data, error } = await atlasSupabase
    .from("atlas_navigation_history")
    .delete()
    .eq("user_id", identity.userId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function acceptAtlasLegalTerms(language: "ku" | "ar" | "en", identity: AtlasAuthIdentity): Promise<AtlasUserProfile> {
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("accept_atlas_legal_terms", {
    p_locale: language,
    p_display_name: identity.displayName,
    p_avatar_url: identity.avatarUrl
  });
  if (error) throw error;
  return data as AtlasUserProfile;
}

export async function deleteAtlasAccountAndData(identity: AtlasAuthIdentity): Promise<void> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot be deleted through the ordinary-user account flow.");
  const client = requireAtlasBackend();
  const data = await invokeAuthenticatedAtlasFunction<{ ok?: unknown; error?: unknown }>(
    "delete-atlas-account",
    { confirmation: "DELETE_MY_ACCOUNT_AND_DATA" },
    "Account deletion could not be completed."
  );
  if (data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "Account deletion did not complete.");

  // The server has permanently removed the Auth user. Local logout must never turn a
  // completed deletion into a false failure if the now-invalid token is rejected.
  clearAtlasAuthIdentityCache();
  clearAtlasAuthNavigationState();
  try { await client.auth.signOut({ scope: "local" }); } catch { /* account is already gone */ }
  clearAtlasLocalAuthStorage();
}

export async function deleteUserAtlasPlace(placeId: string, identity: AtlasAuthIdentity): Promise<AtlasDeletePlaceResult> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot use the ordinary-user place deletion workflow.");
  const data = await invokeAuthenticatedAtlasFunction<{ ok?: unknown; error?: unknown; media_cleanup_warning?: unknown }>(
    "delete-atlas-place",
    { place_id: placeId, confirmation: "DELETE_MY_PLACE_PERMANENTLY" },
    "The place could not be deleted."
  );
  if (data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "The place could not be deleted.");
  return { mediaCleanupWarning: Boolean(data.media_cleanup_warning) };
}

export async function loadAtlasNotifications(): Promise<AtlasNotification[]> {
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_notifications")
    .select("id,user_id,place_id,revision_id,kind,title_ku,title_ar,title_en,body_ku,body_ar,body_en,is_read,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as AtlasNotification[];
}

export async function markAtlasNotificationRead(id: string): Promise<void> {
  const client = requireAtlasBackend();
  const { error } = await client.from("atlas_notifications").update({ is_read: true }).eq("id", id).eq("is_read", false);
  if (error) throw error;
}

export async function markAllAtlasNotificationsRead(): Promise<number> {
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_notifications")
    .update({ is_read: true })
    .eq("is_read", false)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function deleteReadAtlasNotifications(): Promise<number> {
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_notifications")
    .delete()
    .eq("is_read", true)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function deleteAtlasNotification(id: string): Promise<void> {
  const client = requireAtlasBackend();
  const { error } = await client
    .from("atlas_notifications")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function loadUserAtlasFeedback(): Promise<AtlasFeedback[]> {
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_feedback")
    .select("id,user_id,category,message,diagnostics,locale,app_version,map_data_version,status,admin_note,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as AtlasFeedback[];
}

export async function updateOwnAtlasFeedback(
  feedbackId: string,
  category: AtlasFeedbackCategory,
  message: string
): Promise<AtlasFeedback> {
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("update_own_atlas_feedback", {
    p_feedback_id: feedbackId,
    p_category: category,
    p_message: message.trim()
  });
  if (error) throw error;
  return data as AtlasFeedback;
}

export async function deleteOwnAtlasFeedback(feedbackId: string): Promise<void> {
  const client = requireAtlasBackend();
  const { error } = await client.rpc("delete_own_atlas_feedback", {
    p_feedback_id: feedbackId
  });
  if (error) throw error;
}

export async function deleteManagedAtlasFeedback(feedbackId: string): Promise<void> {
  const client = requireAtlasBackend();
  const { error } = await client.rpc("delete_managed_atlas_feedback", {
    p_feedback_id: feedbackId
  });
  if (error) throw error;
}

export async function submitAtlasFeedback(input: {
  category: AtlasFeedbackCategory;
  message: string;
  diagnostics: Record<string, unknown>;
  locale: "ku" | "ar" | "en";
  appVersion: string;
  mapDataVersion: string;
}): Promise<AtlasFeedback> {
  const client = requireAtlasBackend();
  const message = input.message.trim();
  if (message.length < 20 || message.length > 2000) throw new Error("Feedback must contain between 20 and 2000 characters.");
  const { data, error } = await client.rpc("submit_atlas_feedback", {
    p_category: input.category,
    p_message: message,
    p_diagnostics: input.diagnostics,
    p_locale: input.locale,
    p_app_version: input.appVersion,
    p_map_data_version: input.mapDataVersion
  });
  if (error) throw error;
  return data as AtlasFeedback;
}

export async function loadManagedAtlasFeedback(): Promise<AtlasFeedback[]> {
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_feedback")
    .select("id,user_id,category,message,diagnostics,locale,app_version,map_data_version,status,admin_note,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as AtlasFeedback[];
}

export async function updateManagedAtlasFeedback(
  feedbackId: string,
  status: AtlasFeedbackStatus,
  adminNote = ""
): Promise<AtlasFeedback> {
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("review_atlas_feedback", {
    p_feedback_id: feedbackId,
    p_status: status,
    p_admin_note: adminNote.trim() || null
  });
  if (error) throw error;
  return data as AtlasFeedback;
}

export async function signOutAtlasOwner(): Promise<void> {
  clearAtlasAuthIdentityCache();
  clearAtlasAuthNavigationState();
  if (!atlasSupabase) return;
  const { error } = await atlasSupabase.auth.signOut({ scope: "local" });
  if (error && !isAuthSessionMissing(error)) throw error;
}

export type AtlasAuthChange = { event: AuthChangeEvent; session: Session | null };

export function subscribeToAtlasAuth(onChange: (change?: AtlasAuthChange) => void): (() => void) | null {
  if (!atlasSupabase) return null;
  const { data } = atlasSupabase.auth.onAuthStateChange((event, session) => {
    if (event !== "TOKEN_REFRESHED") clearAtlasAuthIdentityCache();
    // Keep the Supabase callback synchronous. Consumers run on the next task so
    // they can safely query profiles/roles without deadlocking auth internals.
    window.setTimeout(() => onChange({ event, session }), 0);
  });
  return () => data.subscription.unsubscribe();
}

export async function saveManagedAtlasPlace(input: AtlasPlaceWriteInput, owner: AtlasOwnerIdentity): Promise<AtlasPlace> {
  const client = requireAtlasBackend();
  assertPlaceInput(input);
  const payload = {
    slug: optionalText(input.slug) || generatedSlug(input.category),
    name_ku: assertAtlasLocalizedText(input.name_ku, ATLAS_TEXT_LIMITS.name, "Kurdish name", "kurdish"),
    name_ar: assertAtlasLocalizedText(input.name_ar, ATLAS_TEXT_LIMITS.name, "Arabic name", "arabic"),
    name_en: assertAtlasLocalizedText(input.name_en, ATLAS_TEXT_LIMITS.name, "English name", "latin"),
    category: input.category,
    tags: normalizeAtlasTags(input.tags ?? []),
    metadata: normalizeMetadata(input.metadata),
    description_ku: optionalText(assertAtlasLocalizedText(input.description_ku, ATLAS_TEXT_LIMITS.description, "Kurdish description", "kurdish")),
    description_ar: optionalText(assertAtlasLocalizedText(input.description_ar, ATLAS_TEXT_LIMITS.description, "Arabic description", "arabic")),
    description_en: optionalText(assertAtlasLocalizedText(input.description_en, ATLAS_TEXT_LIMITS.description, "English description", "latin")),
    longitude: Number(input.longitude.toFixed(7)),
    latitude: Number(input.latitude.toFixed(7)),
    status: input.status
  };
  const query = input.id
    ? client.from("atlas_places").update(payload).eq("id", input.id)
    : client.from("atlas_places").insert({ ...payload, created_by: owner.userId });
  const { data, error } = await query.select(placeSelect).single();
  if (error) {
    const schemaMessage = taxonomySchemaMessage(error);
    if (schemaMessage) throw new Error(schemaMessage);
    throw error;
  }
  const [place] = await hydrateAtlasPlaces(client, [normalizeAtlasPlace(data as Record<string, unknown>)]);
  const saved = place as AtlasPlace;
  const cached = readManagedPlaceCache();
  writeManagedPlaceCache([saved, ...cached.filter((item) => item.id !== saved.id)]);
  return saved;
}

export async function updateManagedAtlasPlaceStatus(placeId: string, status: AtlasPlaceStatus): Promise<AtlasPlace> {
  const client = requireAtlasBackend();
  const { data, error } = await client.from("atlas_places").update({ status }).eq("id", placeId).select(placeSelect).single();
  if (error) throw error;
  const [place] = await hydrateAtlasPlaces(client, [normalizeAtlasPlace(data as Record<string, unknown>)]);
  const updated = place as AtlasPlace;
  const cached = readManagedPlaceCache();
  writeManagedPlaceCache([updated, ...cached.filter((item) => item.id !== updated.id)]);
  return updated;
}

export async function loadUserAtlasPlaces(identity: AtlasAuthIdentity): Promise<AtlasPlace[]> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot enter the ordinary-user contribution workspace.");
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_places")
    .select(placeSelect)
    .eq("created_by", identity.userId)
    .eq("submission_source", "user")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const places = await hydrateAtlasPlaces(client, ((data ?? []) as Record<string, unknown>[]).map(normalizeAtlasPlace));
  return attachAtlasRevisions(client, places);
}

export async function saveUserAtlasSubmission(input: AtlasPlaceWriteInput, identity: AtlasAuthIdentity): Promise<AtlasPlace> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot use ordinary-user submission workflows.");
  const client = requireAtlasBackend();
  assertPlaceInput({ ...input, status: "draft" });
  assertUserLocalizedPlaceInput(input);

  const payload: AtlasPlaceRevisionPayload & { slug?: string } = {
    name_ku: assertAtlasLocalizedText(input.name_ku, ATLAS_TEXT_LIMITS.name, "Kurdish name", "kurdish"),
    name_ar: assertAtlasLocalizedText(input.name_ar, ATLAS_TEXT_LIMITS.name, "Arabic name", "arabic"),
    name_en: assertAtlasLocalizedText(input.name_en, ATLAS_TEXT_LIMITS.name, "English name", "latin"),
    category: input.category,
    tags: normalizeAtlasTags(input.tags ?? []),
    metadata: normalizeMetadata(input.metadata),
    description_ku: optionalText(assertAtlasLocalizedText(input.description_ku, ATLAS_TEXT_LIMITS.description, "Kurdish description", "kurdish")),
    description_ar: optionalText(assertAtlasLocalizedText(input.description_ar, ATLAS_TEXT_LIMITS.description, "Arabic description", "arabic")),
    description_en: optionalText(assertAtlasLocalizedText(input.description_en, ATLAS_TEXT_LIMITS.description, "English description", "latin")),
    longitude: Number(input.longitude.toFixed(7)),
    latitude: Number(input.latitude.toFixed(7)),
    ...(input.id ? {} : { slug: optionalText(input.slug) || generatedSlug(input.category) })
  };

  const { data, error } = await client.rpc("save_own_atlas_place_submission", {
    p_place_id: input.id ?? null,
    p_payload: payload
  });
  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("The place service returned an invalid response.");

  const response = data as { mode?: unknown; place?: unknown; revision?: unknown };
  if (!response.place || typeof response.place !== "object") throw new Error("The saved place response is incomplete.");
  const current = normalizeAtlasPlace(response.place as Record<string, unknown>);
  const [hydrated] = await hydrateAtlasPlaces(client, [current]);
  if (!hydrated) throw new Error("The saved place could not be reloaded.");
  if (response.mode === "revision") {
    if (!response.revision || typeof response.revision !== "object") throw new Error("The saved revision response is incomplete.");
    return { ...hydrated, active_revision: normalizeAtlasRevision(response.revision as Record<string, unknown>) };
  }
  return hydrated;
}

export async function withdrawUserAtlasSubmission(placeId: string, identity: AtlasAuthIdentity): Promise<AtlasPlace> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot use ordinary-user withdrawal workflows.");
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("withdraw_atlas_place_submission", { p_place_id: placeId });
  if (error) throw error;
  return normalizeAtlasPlace(data as Record<string, unknown>);
}

export async function withdrawUserAtlasApprovedPlace(placeId: string, identity: AtlasAuthIdentity): Promise<AtlasPlace> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot use ordinary-user withdrawal workflows.");
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("withdraw_atlas_approved_place", { p_place_id: placeId });
  if (error) throw error;
  return normalizeAtlasPlace(data as Record<string, unknown>);
}

export async function withdrawUserAtlasRevision(revisionId: string, identity: AtlasAuthIdentity): Promise<AtlasPlaceRevision> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot use ordinary-user revision workflows.");
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("withdraw_atlas_place_revision", { p_revision_id: revisionId });
  if (error) throw error;
  return normalizeAtlasRevision(data as Record<string, unknown>);
}

export async function reviewManagedAtlasPlaceRevision(revisionId: string, decision: "approve" | "reject", note = ""): Promise<AtlasPlaceRevision> {
  const client = requireAtlasBackend();
  const { data, error } = await client.rpc("review_atlas_place_revision", {
    p_revision_id: revisionId,
    p_decision: decision,
    p_note: note
  });
  if (error) throw error;
  return normalizeAtlasRevision(data as Record<string, unknown>);
}

export async function reviewManagedAtlasPlace(placeId: string, decision: "approve" | "reject", note = ""): Promise<AtlasPlace> {
  const data = await invokeAuthenticatedAtlasFunction<{ place?: unknown }>(
    "review-atlas-submission",
    { place_id: placeId, decision, note },
    "The place review could not be completed safely."
  );
  if (!data.place || typeof data.place !== "object") throw new Error("The review service returned an invalid response.");
  return normalizeAtlasPlace(data.place as Record<string, unknown>);
}

export async function uploadUserAtlasPhoto(
  placeId: string,
  file: File,
  identity: AtlasAuthIdentity,
  input: AtlasPhotoWriteInput = {},
  onProgress?: AtlasUploadProgress
): Promise<AtlasPhoto> {
  if (identity.role !== "user") throw new Error("Administrator accounts cannot use ordinary-user media uploads.");
  const client = requireAtlasBackend();
  assertPhotoFile(file);
  assertUserLocalizedPhotoInput(input);
  const storagePath = uniqueMediaPath(placeId, file, identity.userId);
  await uploadAtlasStorageObject("kri-place-media-private", storagePath, file, onProgress);
  let insertedPhotoId = "";
  try {
    const { data: existing, error: orderError, count } = await client
      .from("atlas_place_photos")
      .select("sort_order", { count: "exact" })
      .eq("place_id", placeId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) throw orderError;
    if (Number(count ?? 0) >= ATLAS_MEDIA_POLICY.maxPhotosPerPlace) {
      throw new Error(`A place can contain no more than ${ATLAS_MEDIA_POLICY.maxPhotosPerPlace} images.`);
    }

    const { data, error } = await client.from("atlas_place_photos").insert({
      place_id: placeId,
      storage_path: storagePath,
      storage_bucket: "kri-place-media-private",
      caption_ku: optionalText(assertAtlasLocalizedText(input.caption_ku, ATLAS_TEXT_LIMITS.caption, "Kurdish caption", "kurdish")),
      caption_ar: optionalText(assertAtlasLocalizedText(input.caption_ar, ATLAS_TEXT_LIMITS.caption, "Arabic caption", "arabic")),
      caption_en: optionalText(assertAtlasLocalizedText(input.caption_en, ATLAS_TEXT_LIMITS.caption, "English caption", "latin")),
      sort_order: Number(existing?.sort_order ?? -1) + 1
    }).select("id,storage_path,storage_bucket,caption_ku,caption_ar,caption_en,sort_order,created_at").single();
    if (error) throw error;
    insertedPhotoId = String(data.id);
    const { error: coverError } = await client.from("atlas_places").update({ cover_photo_path: storagePath, cover_photo_bucket: "kri-place-media-private" }).eq("id", placeId).eq("created_by", identity.userId);
    if (coverError) throw coverError;
    const photo = data as AtlasPhoto;
    const { data: signed, error: signedError } = await client.storage.from(privateMediaBucket).createSignedUrl(storagePath, PRIVATE_MEDIA_URL_TTL_SECONDS);
    if (signedError) throw signedError;
    return { ...photo, storage_bucket: "kri-place-media-private", media_url: signed.signedUrl };
  } catch (error) {
    // Compensating rollback: never leave a photo row pointing at an object that was
    // removed after a later cover/update failure.
    if (insertedPhotoId) await client.from("atlas_place_photos").delete().eq("id", insertedPhotoId);
    await client.storage.from(privateMediaBucket).remove([storagePath]);
    throw error;
  }
}

export async function uploadManagedAtlasPhoto(
  placeId: string,
  file: File,
  input: AtlasPhotoWriteInput = {},
  onProgress?: AtlasUploadProgress
): Promise<AtlasPhoto> {
  const client = requireAtlasBackend();
  assertPhotoFile(file);
  assertUserLocalizedPhotoInput(input);
  const storagePath = uniqueMediaPath(placeId, file);
  await uploadAtlasStorageObject("kri-place-media", storagePath, file, onProgress);
  let insertedPhotoId = "";

  try {
    const { data: existing, error: orderError, count } = await client
      .from("atlas_place_photos")
      .select("sort_order", { count: "exact" })
      .eq("place_id", placeId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) throw orderError;
    if (Number(count ?? 0) >= ATLAS_MEDIA_POLICY.maxPhotosPerPlace) {
      throw new Error(`A place can contain no more than ${ATLAS_MEDIA_POLICY.maxPhotosPerPlace} images.`);
    }

    const { data, error } = await client
      .from("atlas_place_photos")
      .insert({
        place_id: placeId,
        storage_path: storagePath,
        storage_bucket: "kri-place-media",
        caption_ku: optionalText(assertAtlasLocalizedText(input.caption_ku, ATLAS_TEXT_LIMITS.caption, "Kurdish caption", "kurdish")),
        caption_ar: optionalText(assertAtlasLocalizedText(input.caption_ar, ATLAS_TEXT_LIMITS.caption, "Arabic caption", "arabic")),
        caption_en: optionalText(assertAtlasLocalizedText(input.caption_en, ATLAS_TEXT_LIMITS.caption, "English caption", "latin")),
        sort_order: Number(existing?.sort_order ?? -1) + 1
      })
      .select("id,storage_path,storage_bucket,caption_ku,caption_ar,caption_en,sort_order,created_at")
      .single();
    if (error) throw error;
    insertedPhotoId = String(data.id);

    const { data: place, error: placeError } = await client
      .from("atlas_places")
      .select("cover_photo_path,cover_photo_bucket")
      .eq("id", placeId)
      .single();
    if (placeError) throw placeError;
    if (!place.cover_photo_path) {
      const { error: coverError } = await client.from("atlas_places").update({ cover_photo_path: storagePath, cover_photo_bucket: "kri-place-media" }).eq("id", placeId);
      if (coverError) throw coverError;
    }
    return { ...(data as AtlasPhoto), storage_bucket: "kri-place-media", media_url: publicMediaUrl(storagePath) };
  } catch (error) {
    if (insertedPhotoId) await client.from("atlas_place_photos").delete().eq("id", insertedPhotoId);
    await client.storage.from(publicMediaBucket).remove([storagePath]);
    throw error;
  }
}

export async function updateManagedAtlasPhoto(photoId: string, input: AtlasPhotoWriteInput): Promise<AtlasPhoto> {
  const client = requireAtlasBackend();
  const { data, error } = await client
    .from("atlas_place_photos")
    .update({
      caption_ku: optionalText(assertAtlasLocalizedText(input.caption_ku, ATLAS_TEXT_LIMITS.caption, "Kurdish caption", "kurdish")),
      caption_ar: optionalText(assertAtlasLocalizedText(input.caption_ar, ATLAS_TEXT_LIMITS.caption, "Arabic caption", "arabic")),
      caption_en: optionalText(assertAtlasLocalizedText(input.caption_en, ATLAS_TEXT_LIMITS.caption, "English caption", "latin"))
    })
    .eq("id", photoId)
    .select("id,storage_path,storage_bucket,caption_ku,caption_ar,caption_en,sort_order,created_at")
    .single();
  if (error) throw error;
  const photo = data as AtlasPhoto;
  const storageBucket = normalizeAtlasMediaBucket(photo.storage_bucket);
  if (storageBucket === "kri-place-media-private") {
    const { data: signed, error: signedError } = await client.storage.from(privateMediaBucket).createSignedUrl(photo.storage_path, PRIVATE_MEDIA_URL_TTL_SECONDS);
    if (signedError) throw signedError;
    return { ...photo, storage_bucket: storageBucket, media_url: signed.signedUrl };
  }
  return { ...photo, storage_bucket: storageBucket, media_url: publicMediaUrl(photo.storage_path) };
}

export async function setManagedAtlasPlaceCover(placeId: string, storagePath: string | null, storageBucket: AtlasMediaBucket = "kri-place-media"): Promise<void> {
  const client = requireAtlasBackend();
  const { error } = await client.from("atlas_places").update({
    cover_photo_path: storagePath,
    cover_photo_bucket: storagePath ? storageBucket : "kri-place-media"
  }).eq("id", placeId);
  if (error) throw error;
}

export async function reorderManagedAtlasPhotos(placeId: string, orderedPhotoIds: string[]): Promise<void> {
  const client = requireAtlasBackend();
  const results = await Promise.all(orderedPhotoIds.map(async (id, index) => {
    const { error } = await client.from("atlas_place_photos").update({ sort_order: index }).eq("id", id).eq("place_id", placeId);
    if (error) throw error;
  }));
  void results;
}

export async function deleteManagedAtlasPhoto(place: AtlasPlace, photoId: string): Promise<{ mediaCleanupWarning: boolean }> {
  const client = requireAtlasBackend();
  const photos = sortedPhotos(place);
  const photo = photos.find((item) => item.id === photoId);
  if (!photo) throw new Error("The selected photo no longer exists.");
  const remaining = photos.filter((item) => item.id !== photo.id);
  const nextCoverPhoto = place.cover_photo_path === photo.storage_path ? (remaining[0] ?? null) : null;
  const nextCover = nextCoverPhoto?.storage_path ?? (place.cover_photo_path === photo.storage_path ? null : place.cover_photo_path);

  if (nextCover !== place.cover_photo_path) {
    await setManagedAtlasPlaceCover(place.id, nextCover, nextCoverPhoto?.storage_bucket ?? "kri-place-media");
  }

  const { error: rowError } = await client.from("atlas_place_photos").delete().eq("id", photo.id).eq("place_id", place.id);
  if (rowError) throw rowError;

  const { error: storageError } = await client.storage.from(photo.storage_bucket).remove([photo.storage_path]);
  return { mediaCleanupWarning: Boolean(storageError) };
}

export async function deleteManagedAtlasPlace(place: AtlasPlace): Promise<AtlasDeletePlaceResult> {
  const client = requireAtlasBackend();
  const pathsByBucket = new Map<AtlasMediaBucket, Set<string>>();
  for (const photo of sortedPhotos(place)) {
    const paths = pathsByBucket.get(photo.storage_bucket) ?? new Set<string>();
    paths.add(photo.storage_path);
    pathsByBucket.set(photo.storage_bucket, paths);
  }
  if (place.cover_photo_path) {
    const bucketName = normalizeAtlasMediaBucket(place.cover_photo_bucket);
    const paths = pathsByBucket.get(bucketName) ?? new Set<string>();
    paths.add(place.cover_photo_path);
    pathsByBucket.set(bucketName, paths);
  }
  const { error } = await client.from("atlas_places").delete().eq("id", place.id);
  if (error) throw error;
  writeManagedPlaceCache(readManagedPlaceCache().filter((item) => item.id !== place.id));
  let mediaCleanupWarning = false;
  for (const [bucketName, paths] of pathsByBucket) {
    if (paths.size === 0) continue;
    const { error: storageError } = await client.storage.from(bucketName).remove([...paths]);
    mediaCleanupWarning ||= Boolean(storageError);
  }
  return { mediaCleanupWarning };
}

export function atlasPublicMediaUrl(path: string | null | undefined, storageBucket: AtlasMediaBucket = "kri-place-media"): string | null {
  if (!path || storageBucket === "kri-place-media-private") return null;
  return publicMediaUrl(path);
}

export function atlasPhotoMediaUrl(photo: AtlasPhoto | null | undefined): string | null {
  if (!photo) return null;
  return photo.media_url ?? atlasPublicMediaUrl(photo.storage_path, photo.storage_bucket);
}

export function orderedAtlasPhotos(place: AtlasPlace): AtlasPhoto[] {
  return sortedPhotos(place);
}

type AtlasPlaceChangeListener = () => void;
type AtlasRealtimeChannel = ReturnType<SupabaseClient["channel"]>;

const atlasPlaceChangeListeners = new Set<AtlasPlaceChangeListener>();
let atlasPlacesRealtimeChannel: AtlasRealtimeChannel | null = null;

function dispatchAtlasPlaceChange(): void {
  for (const listener of atlasPlaceChangeListeners) listener();
}

function ensureAtlasPlacesRealtimeChannel(): void {
  if (!atlasSupabase || atlasPlacesRealtimeChannel) return;

  atlasPlacesRealtimeChannel = atlasSupabase
    .channel("atlas-place-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "atlas_places" }, dispatchAtlasPlaceChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "atlas_place_photos" }, dispatchAtlasPlaceChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "atlas_place_revisions" }, dispatchAtlasPlaceChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "atlas_notifications" }, dispatchAtlasPlaceChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "atlas_feedback" }, dispatchAtlasPlaceChange)
    .subscribe();
}

export function subscribeToAtlasPlaces(onChange: AtlasPlaceChangeListener): (() => void) | null {
  if (!atlasSupabase) return null;

  atlasPlaceChangeListeners.add(onChange);
  ensureAtlasPlacesRealtimeChannel();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    atlasPlaceChangeListeners.delete(onChange);

    if (atlasPlaceChangeListeners.size > 0 || !atlasPlacesRealtimeChannel) return;
    const channel = atlasPlacesRealtimeChannel;
    atlasPlacesRealtimeChannel = null;
    void atlasSupabase.removeChannel(channel);
  };
}
