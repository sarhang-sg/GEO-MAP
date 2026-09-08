import type { LayerSpecification, Map as MapLibreMap, StyleImageInterface } from "maplibre-gl";
import {
  atlasMarkerProfilesForCategories,
  atlasMarkerProfilesForTier,
  type AtlasMarkerProfile,
  type AtlasMarkerTier
} from "./atlas-marker-catalog";

type SymbolLayerSpecification = Extract<LayerSpecification, { type: "symbol" }>;

export const ATLAS_MARKER_LAYER_IDS = [
  "atlas-place-marker-local",
  "atlas-place-marker-community",
  "atlas-place-marker-landmark"
] as const;

export type AtlasMarkerIconState = "complete" | "partial" | "fallback" | "empty" | "unavailable";

export type AtlasMarkerIconResult = {
  state: AtlasMarkerIconState;
  activeCategories: number;
  registered: number;
  failedIds: string[];
  layerCount: number;
};

export type AtlasMarkerIconController = {
  reconcile: () => Promise<AtlasMarkerIconResult>;
  setVisible: (visible: boolean) => void;
  snapshot: () => AtlasMarkerIconResult;
};

type AtlasMarkerIconControllerOptions = {
  map: MapLibreMap;
  lowPowerProfile: boolean;
  getPlacesVisible: () => boolean;
  getActiveCategories: () => readonly unknown[];
  isMobileViewport: () => boolean;
};

const SOURCE_ID = "atlas-places-source";
const FALLBACK_LAYER_ID = "atlas-place-marker";
const LAYER_BEFORE = "location-accuracy-fill";
const DEVICE_PIXEL_RATIO = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
const RASTER_SIZE = DEVICE_PIXEL_RATIO >= 2.5 ? 96 : 80;
const PIXEL_RATIO = DEVICE_PIXEL_RATIO >= 2.5 ? 3 : 2;
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const rasterCache = new Map<string, Promise<ImageData>>();

const TIER_CONFIG: Record<AtlasMarkerTier, {
  layerId: (typeof ATLAS_MARKER_LAYER_IDS)[number];
  minZoom: (mobile: boolean, lowPowerProfile: boolean) => number;
  sizeStops: readonly [number, number, number, number, number, number];
  padding: (lowPowerProfile: boolean) => number;
}> = {
  landmark: {
    layerId: "atlas-place-marker-landmark",
    minZoom: (mobile, lowPowerProfile) => mobile ? (lowPowerProfile ? 9.1 : 8.65) : (lowPowerProfile ? 7.4 : 6.85),
    sizeStops: [7, 0.50, 13, 0.68, 18, 0.86],
    padding: (lowPowerProfile) => lowPowerProfile ? 6 : 4
  },
  community: {
    layerId: "atlas-place-marker-community",
    minZoom: (mobile, lowPowerProfile) => mobile ? (lowPowerProfile ? 10.2 : 9.7) : (lowPowerProfile ? 8.9 : 8.35),
    sizeStops: [8.5, 0.46, 14, 0.63, 18, 0.78],
    padding: (lowPowerProfile) => lowPowerProfile ? 7 : 5
  },
  local: {
    layerId: "atlas-place-marker-local",
    minZoom: (mobile, lowPowerProfile) => mobile ? (lowPowerProfile ? 11.8 : 11.2) : (lowPowerProfile ? 10.5 : 9.8),
    sizeStops: [10, 0.42, 14.5, 0.57, 18, 0.70],
    padding: (lowPowerProfile) => lowPowerProfile ? 8 : 6
  }
};

function rasterizeSvg(url: string): Promise<ImageData> {
  const cached = rasterCache.get(url);
  if (cached) return cached;

  const pending = new Promise<ImageData>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = RASTER_SIZE;
      canvas.height = RASTER_SIZE;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        reject(new Error(`Canvas 2D context is unavailable for ${url}`));
        return;
      }
      try {
        context.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
        context.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE);
        resolve(context.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(`Unable to rasterize atlas marker SVG: ${url}`));
      }
    };
    image.onerror = () => reject(new Error(`Unable to load atlas marker SVG: ${url}`));
    image.src = url;
  }).catch((error) => {
    rasterCache.delete(url);
    throw error;
  });

  rasterCache.set(url, pending);
  return pending;
}

function profileFilter(tier: AtlasMarkerTier, profiles: readonly AtlasMarkerProfile[]): unknown[] {
  const ids = atlasMarkerProfilesForTier(tier, profiles).map((profile) => profile.id);
  if (!ids.length) return ["literal", false];
  return [
    "all",
    ["!", ["has", "point_count"]],
    ["==", ["get", "marker_tier"], tier],
    ["in", ["get", "category"], ["literal", ids]]
  ];
}

function stateFor(active: number, registered: number, failed: number): AtlasMarkerIconState {
  if (active === 0) return "empty";
  if (registered === active && failed === 0) return "complete";
  if (registered > 0) return "partial";
  return "fallback";
}

/**
 * Runtime owner-place icon lifecycle.
 *
 * Every canonical taxonomy type owns a dedicated SVG asset and marker
 * profile, while the runtime only decodes categories that actually exist in the
 * current published collection. Failed images retain the canonical circle
 * fallback, so icon decoration can never blank map content or block startup.
 */
export function installAtlasMarkerIconController(options: AtlasMarkerIconControllerOptions): AtlasMarkerIconController {
  const { map, lowPowerProfile, getPlacesVisible, getActiveCategories, isMobileViewport } = options;
  let reconcileInFlight: Promise<AtlasMarkerIconResult> | null = null;
  let lastResult: AtlasMarkerIconResult = { state: "unavailable", activeCategories: 0, registered: 0, failedIds: [], layerCount: 0 };

  const removeLayers = (): void => {
    for (const layerId of ATLAS_MARKER_LAYER_IDS) if (map.getLayer(layerId)) map.removeLayer(layerId);
  };

  const restoreFallback = (): void => {
    if (map.getLayer(FALLBACK_LAYER_ID)) map.setPaintProperty(FALLBACK_LAYER_ID, "circle-opacity", 1);
  };

  const handOffSuccessfulMarkers = (profiles: readonly AtlasMarkerProfile[]): void => {
    if (!map.getLayer(FALLBACK_LAYER_ID)) return;
    if (!profiles.length) {
      restoreFallback();
      return;
    }
    map.setPaintProperty(FALLBACK_LAYER_ID, "circle-opacity", [
      "case",
      ["in", ["get", "category"], ["literal", profiles.map((profile) => profile.id)]],
      0,
      1
    ] as unknown as number);
  };

  const makeLayer = (tier: AtlasMarkerTier, profiles: readonly AtlasMarkerProfile[]): SymbolLayerSpecification => {
    const config = TIER_CONFIG[tier];
    const [z1, s1, z2, s2, z3, s3] = config.sizeStops;
    return {
      id: config.layerId,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: config.minZoom(isMobileViewport(), lowPowerProfile),
      filter: profileFilter(tier, profiles) as unknown as any,
      layout: {
        visibility: getPlacesVisible() ? "visible" : "none",
        "icon-image": ["get", "marker_icon"] as unknown as string,
        "icon-size": ["interpolate", ["linear"], ["zoom"], z1, s1, z2, s2, z3, s3],
        "icon-padding": config.padding(lowPowerProfile),
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "symbol-sort-key": ["get", "marker_priority"] as unknown as number
      }
    };
  };

  const reconcileNow = async (): Promise<AtlasMarkerIconResult> => {
    if (!map.getSource(SOURCE_ID) || !map.getLayer(FALLBACK_LAYER_ID)) {
      lastResult = { state: "unavailable", activeCategories: 0, registered: 0, failedIds: [], layerCount: 0 };
      return lastResult;
    }

    const activeProfiles = atlasMarkerProfilesForCategories(getActiveCategories());
    if (!activeProfiles.length) {
      removeLayers();
      restoreFallback();
      lastResult = { state: "empty", activeCategories: 0, registered: 0, failedIds: [], layerCount: 0 };
      return lastResult;
    }

    const successful: AtlasMarkerProfile[] = [];
    const failedIds: string[] = [];
    const settled = await Promise.allSettled(activeProfiles.map(async (profile) => {
      const image = await rasterizeSvg(asset(profile.asset));
      if (!map.hasImage(profile.imageId)) map.addImage(profile.imageId, image as StyleImageInterface, { pixelRatio: PIXEL_RATIO });
      return profile;
    }));

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") successful.push(result.value);
      else failedIds.push(activeProfiles[index].id);
    });

    removeLayers();
    handOffSuccessfulMarkers(successful);

    let layerCount = 0;
    const beforeId = map.getLayer(LAYER_BEFORE) ? LAYER_BEFORE : undefined;
    for (const tier of ["local", "community", "landmark"] as const) {
      if (!atlasMarkerProfilesForTier(tier, successful).length) continue;
      map.addLayer(makeLayer(tier, successful), beforeId);
      layerCount += 1;
    }

    lastResult = {
      state: stateFor(activeProfiles.length, successful.length, failedIds.length),
      activeCategories: activeProfiles.length,
      registered: successful.length,
      failedIds,
      layerCount
    };
    return lastResult;
  };

  const reconcile = (): Promise<AtlasMarkerIconResult> => {
    if (reconcileInFlight) return reconcileInFlight;
    reconcileInFlight = reconcileNow()
      .catch(() => {
        removeLayers();
        restoreFallback();
        const activeProfiles = atlasMarkerProfilesForCategories(getActiveCategories());
        lastResult = {
          state: activeProfiles.length ? "fallback" : "empty",
          activeCategories: activeProfiles.length,
          registered: 0,
          failedIds: activeProfiles.map((profile) => profile.id),
          layerCount: 0
        };
        return lastResult;
      })
      .finally(() => { reconcileInFlight = null; });
    return reconcileInFlight;
  };

  const setVisible = (visible: boolean): void => {
    for (const layerId of ATLAS_MARKER_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  };

  return {
    reconcile,
    setVisible,
    snapshot: () => ({ ...lastResult, failedIds: [...lastResult.failedIds] })
  };
}
