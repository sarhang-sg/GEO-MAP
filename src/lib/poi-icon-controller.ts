import type { LayerSpecification, Map as MapLibreMap, StyleImageInterface } from "maplibre-gl";
import { ACTIVE_STATIC_POI_ICON_ID_SET } from "./active-static-poi-icons";
import { fetchPersistentJson } from "./persistent-json-cache";
import { yieldToMainThread } from "./performance";
import { runtimePoiSpriteImage } from "./poi-runtime-sprite";
import {
  POI_ICON_DEFINITIONS,
  ALL_POI_ICON_LAYER_IDS,
  NATURAL_POI_ICON_LAYER_IDS,
  SECURITY_POI_ICON_LAYER_IDS,
  REVIEWED_POI_ICON_LAYER_IDS,
  POI_ICON_LAYER_IDS,
  definitionsForTier,
  poiIconFilterExpression,
  poiIconImageExpression,
  type PoiIconDefinition,
  type PoiIconTier
} from "./poi-icon-catalog";
import {
  BASE_POI_DOT_LAYER_ID,
  BASE_POI_DOT_OPACITY,
  BASE_POI_SOURCE_ID,
  BASE_POI_SOURCE_LAYER,
  NAMED_POI_FILTER,
  NATURAL_POI_DOT_LAYER_ID,
  NATURAL_POI_SOURCE_ID,
  REVIEWED_POI_DOT_LAYER_ID,
  REVIEWED_POI_SOURCE_ID,
  SECURITY_POI_DOT_LAYER_ID,
  SECURITY_POI_SOURCE_ID
} from "./poi-source";

type SymbolLayerSpecification = Extract<LayerSpecification, { type: "symbol" }>;

export type PoiIconState = "complete" | "partial" | "fallback" | "unavailable";

export type PoiIconReconcileResult = {
  state: PoiIconState;
  registered: number;
  failedIds: string[];
  layerCount: number;
};

export type PoiIconController = {
  start: (iconIds?: ReadonlySet<string>) => Promise<PoiIconReconcileResult>;
  reconcile: (iconIds?: ReadonlySet<string>) => Promise<PoiIconReconcileResult>;
  setVisible: (visible: boolean) => void;
  snapshot: () => PoiIconReconcileResult;
};

type PoiIconControllerOptions = {
  map: MapLibreMap;
  lowPowerProfile: boolean;
  getPlacesVisible: () => boolean;
};

const DEVICE_PIXEL_RATIO = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
const RASTER_SIZE = DEVICE_PIXEL_RATIO >= 2.5 ? 96 : 80;
const PIXEL_RATIO = DEVICE_PIXEL_RATIO >= 2.5 ? 3 : 2;
const ICON_LAYER_BEFORE = "kri-mask";
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
type AtlasIconGroupBundle = {
  schema: "NAV KURD Atlas Icon Group Bundle v1";
  group: string;
  count: number;
  icons: Record<string, string>;
};
const rasterCache = new Map<string, Promise<ImageData>>();
const groupBundlePromises = new Map<string, Promise<AtlasIconGroupBundle>>();
const ACTIVE_POI_ICON_DEFINITIONS = POI_ICON_DEFINITIONS.filter((definition) => ACTIVE_STATIC_POI_ICON_ID_SET.has(definition.id));
const ACTIVE_DEFINITION_BY_ID = new Map<string, PoiIconDefinition>(ACTIVE_POI_ICON_DEFINITIONS.map((definition) => [definition.id, definition]));
const TIER_ORDER: Readonly<Record<PoiIconTier, number>> = { landmark: 0, community: 1, local: 2 };
// Small static sources remain present before the viewport POI shards activate.
// Register only their real categories—not the complete 167-category runtime set.
const ALWAYS_ON_ICON_IDS = new Set([
  "border_crossing", "canyon", "dam", "forest", "hill", "island", "lake",
  "military_checkpoint", "mosque", "mountain", "mountain_pass", "nature_reserve",
  "orchard", "peak", "police_checkpoint", "quarry", "reservoir", "river", "spring",
  "stream", "valley", "water_well", "waterfall", "wetland"
]);
// Keep a subtle dot under icon-backed POIs. Symbol collision may intentionally
// hide an icon, but the underlying place must remain visible and clickable.
const ICON_DOT_FALLBACK_OPACITY = 0.18;

const TIER_CONFIG: Record<PoiIconTier, {
  minZoom: (lowPowerProfile: boolean) => number;
  sizeStops: readonly [number, number, number, number, number, number];
  padding: (lowPowerProfile: boolean) => number;
}> = {
  landmark: {
    minZoom: (lowPowerProfile) => lowPowerProfile ? 10.9 : 10.3,
    sizeStops: [10.3, 0.56, 14, 0.70, 18, 0.82],
    padding: (lowPowerProfile) => lowPowerProfile ? 6 : 4
  },
  community: {
    minZoom: (lowPowerProfile) => lowPowerProfile ? 12.0 : 11.4,
    sizeStops: [11.4, 0.50, 14, 0.64, 18, 0.76],
    padding: (lowPowerProfile) => lowPowerProfile ? 7 : 5
  },
  local: {
    minZoom: (lowPowerProfile) => lowPowerProfile ? 13.0 : 12.4,
    sizeStops: [12.4, 0.46, 15, 0.60, 18, 0.70],
    padding: (lowPowerProfile) => lowPowerProfile ? 8 : 6
  }
};

type PoiRenderTarget = {
  sourceId: string;
  sourceLayer?: string;
  dotLayerId: string;
  iconLayerIds: readonly [string, string, string];
};

const RENDER_TARGETS: readonly PoiRenderTarget[] = [
  {
    sourceId: BASE_POI_SOURCE_ID,
    sourceLayer: BASE_POI_SOURCE_LAYER,
    dotLayerId: BASE_POI_DOT_LAYER_ID,
    iconLayerIds: POI_ICON_LAYER_IDS
  },
  {
    sourceId: NATURAL_POI_SOURCE_ID,
    dotLayerId: NATURAL_POI_DOT_LAYER_ID,
    iconLayerIds: NATURAL_POI_ICON_LAYER_IDS
  },
  {
    sourceId: SECURITY_POI_SOURCE_ID,
    dotLayerId: SECURITY_POI_DOT_LAYER_ID,
    iconLayerIds: SECURITY_POI_ICON_LAYER_IDS
  },
  {
    sourceId: REVIEWED_POI_SOURCE_ID,
    dotLayerId: REVIEWED_POI_DOT_LAYER_ID,
    iconLayerIds: REVIEWED_POI_ICON_LAYER_IDS
  }
];

function targetLayerId(target: PoiRenderTarget, tier: PoiIconTier): string {
  return target.iconLayerIds[tier === "landmark" ? 0 : tier === "community" ? 1 : 2];
}

function loadIconGroup(group: string): Promise<AtlasIconGroupBundle> {
  const cached = groupBundlePromises.get(group);
  if (cached) return cached;
  const task = fetchPersistentJson<AtlasIconGroupBundle>(
    asset(`assets/icons/atlas/groups/${group}.json`),
    `Atlas icon group (${group})`
  ).then((bundle) => {
    if (bundle.schema !== "NAV KURD Atlas Icon Group Bundle v1" || bundle.group !== group || bundle.count < 1) {
      throw new Error(`Atlas icon group is invalid: ${group}`);
    }
    return bundle;
  }).catch((error) => {
    groupBundlePromises.delete(group);
    throw error;
  });
  groupBundlePromises.set(group, task);
  return task;
}

function rasterizeSvgText(cacheKey: string, svg: string): Promise<ImageData> {
  const cached = rasterCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async (): Promise<ImageData> => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });

    // createImageBitmap performs SVG decode asynchronously in Chromium/WebView
    // and avoids one Image/onload/layout turn per icon. OffscreenCanvas keeps the
    // raster copy detached from the document where the browser supports it.
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: RASTER_SIZE,
          resizeHeight: RASTER_SIZE,
          resizeQuality: "high"
        });
        const canvas = typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(RASTER_SIZE, RASTER_SIZE)
          : Object.assign(document.createElement("canvas"), { width: RASTER_SIZE, height: RASTER_SIZE });
        const context = canvas.getContext("2d", { alpha: true }) as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (!context) {
          bitmap.close();
          throw new Error(`Canvas 2D context is unavailable for ${cacheKey}`);
        }
        context.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
        context.drawImage(bitmap, 0, 0, RASTER_SIZE, RASTER_SIZE);
        bitmap.close();
        return context.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE);
      } catch {
        // Older Android engines can expose createImageBitmap but reject SVG
        // blobs. The Image fallback below remains authoritative there.
      }
    }

    return await new Promise<ImageData>((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(blob);
      const release = (): void => URL.revokeObjectURL(objectUrl);
      image.decoding = "async";
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = RASTER_SIZE;
        canvas.height = RASTER_SIZE;
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) {
          release();
          reject(new Error(`Canvas 2D context is unavailable for ${cacheKey}`));
          return;
        }
        try {
          context.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE);
          context.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE);
          const data = context.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE);
          release();
          resolve(data);
        } catch (error) {
          release();
          reject(error instanceof Error ? error : new Error(`Unable to rasterize bundled POI SVG: ${cacheKey}`));
        }
      };
      image.onerror = () => {
        release();
        reject(new Error(`Unable to decode bundled POI SVG: ${cacheKey}`));
      };
      image.src = objectUrl;
    });
  })().catch((error) => {
    rasterCache.delete(cacheKey);
    throw error;
  });

  rasterCache.set(cacheKey, pending);
  return pending;
}

function stateFor(requested: number, successful: number, failed: number): PoiIconState {
  if (requested > 0 && successful >= requested && failed === 0) return "complete";
  if (successful > 0) return "partial";
  return requested === 0 ? "unavailable" : "fallback";
}

/**
 * Optional POI enhancement lifecycle.
 *
 * Icons are loaded in taxonomy-group bundles and only for categories that are
 * present in the current viewport. The critical map never waits for icon work;
 * failed categories retain the canonical purple-dot fallback.
 */
export function installPoiIconController(options: PoiIconControllerOptions): PoiIconController {
  const { map, lowPowerProfile, getPlacesVisible } = options;
  let reconcileInFlight: Promise<PoiIconReconcileResult> | null = null;
  let reconcileQueued = false;
  let started = false;
  let styleDirty = true;
  let lastReconciledRequestedCount = 0;
  const requestedIds = new Set<string>([...ALWAYS_ON_ICON_IDS].filter((id) => ACTIVE_DEFINITION_BY_ID.has(id)));
  const successfulById = new Map<string, PoiIconDefinition>();
  let lastResult: PoiIconReconcileResult = {
    state: "unavailable",
    registered: 0,
    failedIds: [],
    layerCount: 0
  };

  const addRequestedIds = (iconIds?: ReadonlySet<string>): boolean => {
    if (!iconIds) return false;
    let changed = false;
    for (const id of iconIds) {
      if (!ACTIVE_DEFINITION_BY_ID.has(id) || requestedIds.has(id)) continue;
      requestedIds.add(id);
      changed = true;
    }
    return changed;
  };

  const removeIconLayers = (): void => {
    for (const layerId of ALL_POI_ICON_LAYER_IDS) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
  };

  const restoreBaseDots = (): void => {
    for (const target of RENDER_TARGETS) {
      if (map.getLayer(target.dotLayerId)) {
        map.setPaintProperty(target.dotLayerId, "circle-opacity", BASE_POI_DOT_OPACITY);
      }
    }
  };

  type TierDotFadeStops = readonly [number, number, number, number, number, number];

  const tierDotFade = (tier: PoiIconTier): TierDotFadeStops => {
    const minZoom = TIER_CONFIG[tier].minZoom(lowPowerProfile);
    return [
      Math.max(0, minZoom - 0.45), BASE_POI_DOT_OPACITY,
      minZoom, ICON_DOT_FALLBACK_OPACITY,
      minZoom + 0.42, 0
    ];
  };

  const opacityAtZoom = (stops: TierDotFadeStops, zoom: number): number => {
    const [z1, o1, z2, o2, z3, o3] = stops;
    if (zoom <= z1) return o1;
    if (zoom >= z3) return o3;
    if (zoom <= z2) return o1 + ((o2 - o1) * (zoom - z1)) / (z2 - z1);
    return o2 + ((o3 - o2) * (zoom - z2)) / (z3 - z2);
  };

  const successfulDotOpacityExpression = (definitions: readonly PoiIconDefinition[]): unknown[] => {
    const landmarkFade = tierDotFade("landmark");
    const communityFade = tierDotFade("community");
    const localFade = tierDotFade("local");
    const zoomStops = [...new Set([
      landmarkFade[0], landmarkFade[2], landmarkFade[4],
      communityFade[0], communityFade[2], communityFade[4],
      localFade[0], localFade[2], localFade[4]
    ])].sort((a, b) => a - b);

    const interpolatedStops = zoomStops.flatMap((zoom) => [
      zoom,
      [
        "match", ["var", "poiTier"],
        0, opacityAtZoom(landmarkFade, zoom),
        1, opacityAtZoom(communityFade, zoom),
        2, opacityAtZoom(localFade, zoom),
        BASE_POI_DOT_OPACITY
      ]
    ]);

    return [
      "let", "poiTier",
      [
        "case",
        poiIconFilterExpression("landmark", definitions), 0,
        poiIconFilterExpression("community", definitions), 1,
        poiIconFilterExpression("local", definitions), 2,
        -1
      ],
      ["interpolate", ["linear"], ["zoom"], ...interpolatedStops]
    ];
  };

  const handOffSuccessfulDots = (definitions: readonly PoiIconDefinition[]): void => {
    for (const target of RENDER_TARGETS) {
      if (!map.getLayer(target.dotLayerId)) continue;
      if (!definitions.length) {
        map.setPaintProperty(target.dotLayerId, "circle-opacity", BASE_POI_DOT_OPACITY);
        continue;
      }
      map.setPaintProperty(
        target.dotLayerId,
        "circle-opacity",
        successfulDotOpacityExpression(definitions) as unknown as number
      );
    }
  };

  const makeLayer = (
    target: PoiRenderTarget,
    tier: PoiIconTier,
    definitions: readonly PoiIconDefinition[]
  ): SymbolLayerSpecification => {
    const config = TIER_CONFIG[tier];
    const [z1, s1, z2, s2, z3, s3] = config.sizeStops;
    const layer: SymbolLayerSpecification = {
      id: targetLayerId(target, tier),
      type: "symbol",
      source: target.sourceId,
      minzoom: config.minZoom(lowPowerProfile),
      filter: ["all", NAMED_POI_FILTER, poiIconFilterExpression(tier, definitions)] as unknown as any,
      layout: {
        visibility: getPlacesVisible() ? "visible" : "none",
        "icon-image": poiIconImageExpression(tier, definitions) as unknown as string,
        "icon-size": ["interpolate", ["linear"], ["zoom"], z1, s1, z2, s2, z3, s3],
        "icon-padding": Math.min(3, config.padding(lowPowerProfile)),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-optional": true,
        "symbol-sort-key": ["coalesce", ["get", "priority"], 0]
      }
    };
    if (target.sourceLayer) layer["source-layer"] = target.sourceLayer;
    return layer;
  };

  const renderSuccessfulLayers = (): number => {
    const successful = [...successfulById.values()]
      .filter((definition) => map.hasImage(definition.imageId))
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.id.localeCompare(b.id));
    handOffSuccessfulDots(successful);
    const expectedLayers = new Set<string>();
    let layerCount = 0;

    for (const target of RENDER_TARGETS) {
      if (!map.getSource(target.sourceId) || !map.getLayer(target.dotLayerId)) continue;
      for (const tier of ["local", "community", "landmark"] as const) {
        const tierDefinitions = definitionsForTier(tier, successful);
        const layerId = targetLayerId(target, tier);
        if (!tierDefinitions.length) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          continue;
        }
        expectedLayers.add(layerId);
        const layer = makeLayer(target, tier, successful);
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, layer.filter as any);
          map.setLayoutProperty(layerId, "icon-image", layer.layout?.["icon-image"] as any);
          map.setLayoutProperty(layerId, "visibility", getPlacesVisible() ? "visible" : "none");
          map.setLayerZoomRange(layerId, layer.minzoom ?? 0, layer.maxzoom ?? 24);
        } else {
          const beforeId = map.getLayer(ICON_LAYER_BEFORE) ? ICON_LAYER_BEFORE : undefined;
          map.addLayer(layer, beforeId);
        }
        layerCount += 1;
      }
    }

    for (const layerId of ALL_POI_ICON_LAYER_IDS) {
      if (!expectedLayers.has(layerId) && map.getLayer(layerId)) map.removeLayer(layerId);
    }
    return layerCount;
  };

  const reconcileNow = async (): Promise<PoiIconReconcileResult> => {
    if (!map.getSource(BASE_POI_SOURCE_ID) || !map.getLayer(BASE_POI_DOT_LAYER_ID)) {
      lastResult = { state: "unavailable", registered: successfulById.size, failedIds: [], layerCount: 0 };
      return lastResult;
    }

    const requestedAtStart = [...requestedIds];
    const requestedDefinitions = requestedAtStart
      .map((id) => ACTIVE_DEFINITION_BY_ID.get(id))
      .filter((definition): definition is PoiIconDefinition => Boolean(definition))
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.id.localeCompare(b.id));
    const missingDefinitions = requestedDefinitions.filter((definition) => !map.hasImage(definition.imageId));
    const failedIds: string[] = [];

    const registerDefinition = async (definition: PoiIconDefinition): Promise<void> => {
      if (map.hasImage(definition.imageId)) {
        successfulById.set(definition.id, definition);
        return;
      }

      // One pre-rasterized, density-specific sprite request serves every
      // static POI category. The old per-group SVG path remains a strict fallback
      // for browsers that cannot decode the sprite or for a damaged cache entry.
      const sprite = await runtimePoiSpriteImage(definition.id);
      if (sprite) {
        if (!map.hasImage(definition.imageId)) {
          map.addImage(definition.imageId, sprite.image as StyleImageInterface, { pixelRatio: sprite.pixelRatio });
        }
        successfulById.set(definition.id, definition);
        return;
      }

      const bundle = await loadIconGroup(definition.group);
      const svg = bundle.icons[definition.id];
      if (!svg) throw new Error(`Atlas icon is missing from group ${definition.group}: ${definition.id}`);
      const image = await rasterizeSvgText(definition.id, svg);
      if (!map.hasImage(definition.imageId)) {
        map.addImage(definition.imageId, image as StyleImageInterface, { pixelRatio: PIXEL_RATIO });
      }
      successfulById.set(definition.id, definition);
    };

    // Decode/register in bounded, tier-prioritized batches. Every call shares the
    // same 0.54/0.67 MiB sprite request, so categories no longer wait for many SVG
    // group requests or one rasterization task per shop/place.
    const concurrency = lowPowerProfile ? 12 : 24;
    for (let offset = 0; offset < missingDefinitions.length; offset += concurrency) {
      const batch = missingDefinitions.slice(offset, offset + concurrency);
      const settled = await Promise.allSettled(batch.map(registerDefinition));
      settled.forEach((result, index) => {
        if (result.status === "rejected") failedIds.push(batch[index].id);
      });

      // Paint the first available icons immediately; subsequent batches update
      // filters in place without removing working layers or blanking the map.
      if (offset === 0 || offset + concurrency >= missingDefinitions.length || ((offset / concurrency) % 2 === 1)) {
        renderSuccessfulLayers();
      }
      if (offset + concurrency < missingDefinitions.length) await yieldToMainThread();
    }

    // Images survive normal moves but not a full style replacement. Re-add any
    // requested definitions that were already rasterized in an earlier style.
    for (const definition of requestedDefinitions) {
      if (map.hasImage(definition.imageId)) {
        successfulById.set(definition.id, definition);
        continue;
      }
      const cachedRaster = rasterCache.get(definition.id);
      if (!cachedRaster || failedIds.includes(definition.id)) continue;
      try {
        const image = await cachedRaster;
        if (!map.hasImage(definition.imageId)) {
          map.addImage(definition.imageId, image as StyleImageInterface, { pixelRatio: PIXEL_RATIO });
        }
        successfulById.set(definition.id, definition);
      } catch {
        failedIds.push(definition.id);
      }
    }

    const layerCount = renderSuccessfulLayers();
    const uniqueFailures = [...new Set(failedIds)];
    const successfulRequested = requestedDefinitions.filter((definition) => map.hasImage(definition.imageId)).length;
    lastResult = {
      state: stateFor(requestedDefinitions.length, successfulRequested, uniqueFailures.length),
      registered: successfulById.size,
      failedIds: uniqueFailures,
      layerCount
    };
    styleDirty = false;
    lastReconciledRequestedCount = Math.max(lastReconciledRequestedCount, requestedAtStart.length);
    return lastResult;
  };

  const reconcile = (iconIds?: ReadonlySet<string>): Promise<PoiIconReconcileResult> => {
    started = true;
    addRequestedIds(iconIds);
    if (reconcileInFlight) {
      reconcileQueued = true;
      return reconcileInFlight;
    }
    if (!styleDirty && requestedIds.size <= lastReconciledRequestedCount) {
      return Promise.resolve(lastResult);
    }
    reconcileInFlight = reconcileNow()
      .catch(() => {
        removeIconLayers();
        restoreBaseDots();
        lastResult = {
          state: successfulById.size > 0 ? "partial" : "fallback",
          registered: successfulById.size,
          failedIds: [...requestedIds].filter((id) => !successfulById.has(id)),
          layerCount: 0
        };
        return lastResult;
      })
      .finally(() => {
        reconcileInFlight = null;
        if (reconcileQueued) {
          reconcileQueued = false;
          void reconcile();
        }
      });
    return reconcileInFlight;
  };

  const setVisible = (visible: boolean): void => {
    for (const layerId of ALL_POI_ICON_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  };

  map.on("style.load", () => {
    styleDirty = true;
    if (started) void reconcile();
  });

  return {
    start: (iconIds) => reconcile(iconIds),
    reconcile,
    setVisible,
    snapshot: () => ({ ...lastResult, failedIds: [...lastResult.failedIds] })
  };
}
