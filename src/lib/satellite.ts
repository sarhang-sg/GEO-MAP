export type RasterSatelliteSource =
  | { kind: "tilejson"; url: string }
  | { kind: "template"; url: string; minzoom?: number; maxzoom?: number; tileSize?: number };

export type SatelliteSource =
  | { enabled: false; provider: "disabled"; reason: string; source: null; attribution: string }
  | {
      enabled: true;
      provider: "maptiler" | "sentinel2" | "custom";
      source: RasterSatelliteSource;
      fallbackSource?: RasterSatelliteSource;
      detailSource?: RasterSatelliteSource;
      detailAttribution?: string;
      transitionZoom?: number;
      composition?: "handoff" | "context-overlay";
      attribution: string;
      probeUrls: readonly string[];
    };

/**
 * MapTiler's documented raster satellite dataset is satellite-v2 and its
 * direct XYZ endpoint uses a .jpg suffix. Earlier NAV KURD releases used
 * satellite-v4 as a direct XYZ path without the suffix; MapTiler answered 404
 * for every tile and MapLibre repeatedly exposed the light vector underlay.
 */
const STABLE_MAPTILER_DATASET_ID = "satellite-v2";
const SENTINEL2_MIN_ZOOM = 5;
const SENTINEL2_MAX_NATIVE_ZOOM = 13;
const SENTINEL2_CONTEXT_TRANSITION_ZOOM = 7.2;
const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const enabledFlag = (value: string): boolean => value.toLowerCase() === "true";

function secureUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function resolveMapTilerId(value: string): string {
  const normalized = clean(value).toLowerCase();
  // satellite-v3/v4 are accepted as historical configuration aliases, but the
  // public raster dataset endpoint used by the app is the stable v2 dataset.
  if (!normalized || /^satellite-v[234]$/.test(normalized)) return STABLE_MAPTILER_DATASET_ID;
  return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized) ? normalized : STABLE_MAPTILER_DATASET_ID;
}

function hasTileTemplateTokens(value: string): boolean {
  return /\{z\}/.test(value) && /\{x\}/.test(value) && /\{y\}/.test(value);
}

function concreteProbeUrl(template: string): string {
  return template.replace("{z}", "7").replace("{x}", "79").replace("{y}", "50");
}

function appBasePath(): string {
  const raw = clean(import.meta.env.BASE_URL) || "/";
  const rooted = raw.startsWith("/") ? raw : `/${raw}`;
  return rooted.endsWith("/") ? rooted : `${rooted}/`;
}

function sentinelCacheDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function sentinelTemplate(): string {
  return `${appBasePath()}api/sentinel2?z={z}&x={x}&y={y}&day=${sentinelCacheDay()}`;
}

function mapTilerTileTemplate(key: string, tilesetId: string): string {
  const id = resolveMapTilerId(tilesetId);
  // The .jpg extension is required by the direct raster dataset endpoint.
  return `https://api.maptiler.com/tiles/${encodeURIComponent(id)}/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`;
}

function stableMapTilerSource(key: string, configuredId: string): {
  primary: RasterSatelliteSource;
  probes: readonly string[];
} {
  const template = mapTilerTileTemplate(key, configuredId);
  return {
    primary: { kind: "template", url: template, minzoom: 0, maxzoom: 22, tileSize: 256 },
    probes: [concreteProbeUrl(template)]
  };
}

export function resolveSatelliteSource(): SatelliteSource {
  if (!enabledFlag(clean(import.meta.env.VITE_KRI_ENABLE_SATELLITE))) {
    return { enabled: false, provider: "disabled", reason: "flag-disabled", source: null, attribution: "" };
  }

  const provider = clean(import.meta.env.VITE_KRI_SATELLITE_PROVIDER).toLowerCase();
  const mapTilerKey = clean(import.meta.env.VITE_KRI_MAPTILER_API_KEY);
  const configuredMapTilerId = clean(import.meta.env.VITE_KRI_MAPTILER_TILESET_ID);
  const sentinelOverlayEnabled = enabledFlag(clean(import.meta.env.VITE_KRI_ENABLE_SENTINEL_OVERLAY));
  const tileJson = clean(import.meta.env.VITE_KRI_SATELLITE_TILEJSON_URL);
  const template = clean(import.meta.env.VITE_KRI_SATELLITE_TILE_TEMPLATE);
  const attribution = clean(import.meta.env.VITE_KRI_SATELLITE_ATTRIBUTION);

  // When a MapTiler key exists, use its globally continuous raster as the sole
  // operational base. Sentinel-2 is opt-in only: per-tile serverless Process API
  // calls are expensive, can be rate-limited, and must never be mounted merely
  // because the provider label says "sentinel2".
  if ((provider === "sentinel2" || provider === "maptiler" || !provider) && mapTilerKey) {
    const mapTiler = stableMapTilerSource(mapTilerKey, configuredMapTilerId);
    const sentinel = sentinelTemplate();
    return {
      enabled: true,
      provider: provider === "sentinel2" ? "sentinel2" : "maptiler",
      source: mapTiler.primary,
      ...(sentinelOverlayEnabled ? {
        detailSource: { kind: "template" as const, url: sentinel, minzoom: SENTINEL2_MIN_ZOOM, maxzoom: SENTINEL2_MAX_NATIVE_ZOOM, tileSize: 256 },
        detailAttribution: "Contains modified Copernicus Sentinel-2 data (processed by Sentinel Hub)",
        transitionZoom: SENTINEL2_CONTEXT_TRANSITION_ZOOM,
        composition: "context-overlay" as const
      } : {}),
      attribution: "© MapTiler © OpenStreetMap contributors",
      probeUrls: sentinelOverlayEnabled ? [...mapTiler.probes, concreteProbeUrl(sentinel)] : mapTiler.probes
    };
  }

  if (provider === "sentinel2") {
    const sentinel = sentinelTemplate();
    return {
      enabled: true,
      provider: "sentinel2",
      source: { kind: "template", url: sentinel, minzoom: SENTINEL2_MIN_ZOOM, maxzoom: SENTINEL2_MAX_NATIVE_ZOOM, tileSize: 256 },
      attribution: "Contains modified Copernicus Sentinel-2 data (processed by Sentinel Hub)",
      probeUrls: [concreteProbeUrl(sentinel)]
    };
  }

  if (provider === "maptiler") {
    return { enabled: false, provider: "disabled", reason: "missing-maptiler-key", source: null, attribution: "" };
  }

  if (provider === "custom" || tileJson || template) {
    if (!attribution) return { enabled: false, provider: "disabled", reason: "missing-attribution", source: null, attribution: "" };
    const validTileJson = secureUrl(tileJson);
    if (validTileJson) return { enabled: true, provider: "custom", source: { kind: "tilejson", url: validTileJson }, attribution, probeUrls: [validTileJson] };
    const validTemplate = secureUrl(template);
    if (validTemplate && hasTileTemplateTokens(validTemplate)) {
      return { enabled: true, provider: "custom", source: { kind: "template", url: validTemplate }, attribution, probeUrls: [concreteProbeUrl(validTemplate)] };
    }
    return { enabled: false, provider: "disabled", reason: tileJson || template ? "invalid-source" : "missing-custom-source", source: null, attribution: "" };
  }

  return { enabled: false, provider: "disabled", reason: "missing-custom-source", source: null, attribution: "" };
}

function tileJsonProbeTemplate(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const tiles = (payload as { tiles?: unknown }).tiles;
  if (!Array.isArray(tiles)) return null;
  const template = tiles.find((value): value is string => typeof value === "string" && hasTileTemplateTokens(value));
  return template ?? null;
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET", cache: "force-cache", mode: "cors" });
    if (!response.ok) return false;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("image/")) return true;
    if (!contentType.includes("json")) return false;
    const template = tileJsonProbeTemplate(await response.json());
    if (!template) return false;
    const tile = await fetch(concreteProbeUrl(template), { method: "GET", cache: "force-cache", mode: "cors" });
    return tile.ok && (tile.headers.get("content-type") || "").toLowerCase().includes("image/");
  } catch {
    return false;
  }
}

export async function validateSatelliteSource(source: SatelliteSource): Promise<boolean> {
  if (!source.enabled) return false;
  for (const url of source.probeUrls) {
    if (await probeUrl(url)) return true;
  }
  return false;
}
