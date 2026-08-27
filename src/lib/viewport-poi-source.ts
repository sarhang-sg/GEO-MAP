import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { fetchPersistentJson } from "./persistent-json-cache";
import { MAP_DATA_VERSION, dataAssetUrl } from "./release";
import { debounceAsync } from "./performance";
import { isAbortError } from "./service-state";
import { recordRuntimeDiagnostic } from "./runtime-diagnostics";

export type ViewportPoiDatasetId = "base" | "natural";

type ViewportPoiLeaf = {
  key: string;
  z: number;
  x: number;
  y: number;
  bbox: readonly [number, number, number, number];
  file: string;
  records: number;
  bytes: number;
  sha256: string;
  icon_ids?: string[];
};

type ViewportPoiDataset = {
  id: ViewportPoiDatasetId;
  source: string;
  records: number;
  source_bytes: number;
  runtime_minzoom: number;
  max_records_per_shard: number;
  shards: number;
  bytes: number;
  leaves: ViewportPoiLeaf[];
};

type ViewportPoiManifest = {
  schema: "NAV KURD viewport POI shards v1";
  release: string;
  datasets: Partial<Record<ViewportPoiDatasetId, ViewportPoiDataset>>;
};

type ViewportPoiShard = FeatureCollection<Point, Record<string, unknown>> & {
  version?: string;
};

type LoadedViewportPoiShard = {
  leaf: ViewportPoiLeaf;
  shard: ViewportPoiShard;
};

export type ViewportPoiSnapshot = {
  state: "idle" | "loading" | "ready" | "fallback";
  records: number;
  shards: number;
  bytes: number;
  iconIds: ReadonlySet<string>;
};

export type ViewportPoiSourceController = {
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  setVisible: (visible: boolean) => void;
  setPaused: (paused: boolean) => void;
  snapshot: () => ViewportPoiSnapshot;
  destroy: () => void;
};

type ViewportPoiSourceOptions = {
  map: MapLibreMap;
  sourceId: string;
  datasetId: ViewportPoiDatasetId;
  manifestUrl?: string;
  diagnosticsHost?: HTMLElement;
  lowPowerProfile: boolean;
  getVisible: () => boolean;
  onDataChanged?: (snapshot: ViewportPoiSnapshot) => void;
};

const EMPTY_COLLECTION: FeatureCollection<Point, Record<string, unknown>> = {
  type: "FeatureCollection",
  features: []
};
const MANIFEST_URL = dataAssetUrl("data/kri/kri-viewport-poi-shards-manifest.json");
const CANONICAL_SHARD_PREFIX = "data/kri/viewport-poi-shards/";

// Base and natural sources share one MapLibre worker pipeline. Serializing the
// final source writes prevents both datasets from sending large GeoJSON diffs in
// the same frame while shard downloads and icon preparation still run in parallel.
let globalViewportSourceWrite: Promise<void> = Promise.resolve();

/** Resolves an immutable shard path from the canonical data directory. */
export function resolveViewportPoiAssetUrl(_manifestUrl: string, file: string): string {
  const normalized = String(file || "").trim().replace(/^\.\/+/, "");
  if (!normalized || normalized.includes("\\") || normalized.split("/").includes("..")) {
    throw new Error(`Viewport POI shard path is invalid: ${file}`);
  }
  if (/^(?:[a-z]+:)?\/\//iu.test(normalized) || normalized.includes("?") || normalized.includes("#")) {
    throw new Error(`Viewport POI shard path must be a local immutable asset: ${file}`);
  }
  if (!normalized.startsWith(CANONICAL_SHARD_PREFIX)) {
    throw new Error(`Viewport POI shard is outside the canonical data directory: ${file}`);
  }
  return dataAssetUrl(normalized);
}

function intersects(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function centerDistanceSquared(leaf: ViewportPoiLeaf, longitude: number, latitude: number): number {
  const leafLongitude = (leaf.bbox[0] + leaf.bbox[2]) / 2;
  const leafLatitude = (leaf.bbox[1] + leaf.bbox[3]) / 2;
  const dx = leafLongitude - longitude;
  const dy = leafLatitude - latitude;
  return dx * dx + dy * dy;
}

function iconIdsForFeatures(features: readonly Feature<Point, Record<string, unknown>>[]): Set<string> {
  const ids = new Set<string>();
  for (const feature of features) {
    const id = feature.properties?.icon_id;
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  return ids;
}

function iconIdsForLeaves(leaves: readonly ViewportPoiLeaf[]): Set<string> {
  const ids = new Set<string>();
  for (const leaf of leaves) {
    for (const id of leaf.icon_ids ?? []) {
      const normalized = String(id || "").trim();
      if (normalized) ids.add(normalized);
    }
  }
  return ids;
}

/**
 * Loads only immutable POI shards intersecting the current viewport.
 *
 * The controller performs three latency-hiding stages:
 * 1. It announces viewport icon ids before source writes, allowing sprite work
 *    to overlap immutable shard loading.
 * 2. A complete cached subset is painted once, followed by one atomic final
 *    transaction after missing siblings load. Clustering is never rebuilt for
 *    every individual shard completion.
 * 3. Loaded source data and a larger parsed-shard LRU survive zoom-out/in and
 *    style changes, eliminating the former blank/reload cycle.
 */
export function installViewportPoiSourceController(options: ViewportPoiSourceOptions): ViewportPoiSourceController {
  const { map, sourceId, datasetId, lowPowerProfile, getVisible, onDataChanged, diagnosticsHost } = options;
  const manifestUrl = options.manifestUrl ?? MANIFEST_URL;
  const memoryLimit = lowPowerProfile ? 48 : 96;
  const concurrentLoads = lowPowerProfile ? 4 : 6;
  const maxViewportShards = lowPowerProfile ? 14 : 24;
  const retryCooldownMs = lowPowerProfile ? 30_000 : 20_000;
  const shardCache = new Map<string, ViewportPoiShard>();
  const failedUntil = new Map<string, number>();
  let dataset: ViewportPoiDataset | null = null;
  let started = false;
  let visible = getVisible();
  let paused = false;
  let generation = 0;
  let destroyed = false;
  let lastLeafSignature = "";
  let activeBatchAborter: AbortController | null = null;
  let currentSnapshot: ViewportPoiSnapshot = {
    state: "idle",
    records: 0,
    shards: 0,
    bytes: 0,
    iconIds: new Set()
  };
  let committedFeatures = new Map<string | number, Feature<Point, Record<string, unknown>>>();
  let sourceWrite: Promise<void> = Promise.resolve();
  let sourceCommitCount = 0;

  const publish = (snapshot: ViewportPoiSnapshot): void => {
    currentSnapshot = snapshot;
    onDataChanged?.(snapshot);
  };

  const source = (): GeoJSONSource | undefined => map.getSource(sourceId) as GeoJSONSource | undefined;

  const announceLeafIcons = (leaves: readonly ViewportPoiLeaf[]): void => {
    const discovered = iconIdsForLeaves(leaves);
    if (!discovered.size) return;
    const next = new Set(currentSnapshot.iconIds);
    let changed = false;
    for (const id of discovered) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    }
    if (changed) publish({ ...currentSnapshot, iconIds: next });
  };


  const recordSourceCommit = (startedAt: number): void => {
    sourceCommitCount += 1;
    if (!diagnosticsHost) return;
    const prefix = datasetId === "base" ? "basePoi" : "naturalPoi";
    diagnosticsHost.dataset[`${prefix}SourceCommits`] = String(sourceCommitCount);
    diagnosticsHost.dataset[`${prefix}LastCommitMs`] = String(Math.round(performance.now() - startedAt));
  };
  const setData = (collection: FeatureCollection<Point, Record<string, unknown>>): Promise<void> => {
    const localTask = sourceWrite.catch(() => undefined).then(async () => {
      const globalTask = globalViewportSourceWrite.catch(() => undefined).then(async () => {
        const commitStartedAt = performance.now();
        const target = source() as (GeoJSONSource & {
          updateData?: (diff: {
            remove?: Array<string | number>;
            add?: Feature<Point, Record<string, unknown>>[];
            removeAll?: boolean;
          }, waitForCompletion?: true) => Promise<void> | GeoJSONSource;
          setData: (data: FeatureCollection<Point, Record<string, unknown>>, waitForCompletion?: true) => Promise<void> | GeoJSONSource;
        }) | undefined;
        if (!target) return;

        const nextFeatures = new Map<string | number, Feature<Point, Record<string, unknown>>>();
        for (const feature of collection.features) {
          if (feature.id === undefined || feature.id === null) continue;
          nextFeatures.set(feature.id, feature);
        }
        const remove: Array<string | number> = [];
        const add: Feature<Point, Record<string, unknown>>[] = [];
        for (const id of committedFeatures.keys()) if (!nextFeatures.has(id)) remove.push(id);
        for (const [id, feature] of nextFeatures) if (!committedFeatures.has(id)) add.push(feature);
        if (remove.length === 0 && add.length === 0 && committedFeatures.size === nextFeatures.size) return;

        const update = target.updateData?.bind(target);
        if (!update) {
          await Promise.resolve(target.setData(collection, true));
          recordSourceCommit(commitStartedAt);
          committedFeatures = nextFeatures;
          return;
        }

        if (nextFeatures.size === 0) {
          if (committedFeatures.size > 0) {
            await Promise.resolve(update({ removeAll: true }, true));
            recordSourceCommit(commitStartedAt);
          }
          committedFeatures = nextFeatures;
          return;
        }

        if (committedFeatures.size === 0) {
          // One source write creates one worker transaction. The former seed +
          // chunk loop made MapLibre rebuild clustering repeatedly and produced
          // a long series of `message handler` violations on Android.
          await Promise.resolve(target.setData(collection, true));
          recordSourceCommit(commitStartedAt);
          committedFeatures = nextFeatures;
          return;
        }

        // Apply the complete viewport transition atomically. Adding and removing
        // together avoids a temporary double-sized cluster index and prevents
        // dozens of worker round-trips during zoom/pan transitions.
        await Promise.resolve(update({
          add: add.length ? add : undefined,
          remove: remove.length ? remove : undefined
        }, true));
        recordSourceCommit(commitStartedAt);
        committedFeatures = nextFeatures;
      });
      globalViewportSourceWrite = globalTask.catch(() => undefined);
      await globalTask;
    });
    sourceWrite = localTask.catch(() => undefined);
    return localTask;
  };

  const touchCache = (key: string, value: ViewportPoiShard): void => {
    shardCache.delete(key);
    shardCache.set(key, value);
    while (shardCache.size > memoryLimit) {
      const oldest = shardCache.keys().next().value as string | undefined;
      if (!oldest) break;
      shardCache.delete(oldest);
    }
  };

  const loadLeaf = (leaf: ViewportPoiLeaf, signal?: AbortSignal): Promise<ViewportPoiShard> => {
    const cached = shardCache.get(leaf.key);
    if (cached) {
      touchCache(leaf.key, cached);
      return Promise.resolve(cached);
    }

    const retryAt = failedUntil.get(leaf.key) ?? 0;
    if (retryAt > Date.now()) {
      return Promise.reject(new Error(`Viewport POI shard is cooling down after a failed request: ${datasetId}:${leaf.key}`));
    }

    const resource = resolveViewportPoiAssetUrl(manifestUrl, leaf.file);
    const task = fetchPersistentJson<ViewportPoiShard>(
      resource,
      `Viewport POI shard ${datasetId}:${leaf.key}`,
      { signal }
    )
      .then((payload) => {
        if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
          throw new Error(`Viewport POI shard is invalid: ${datasetId}:${leaf.key}`);
        }
        failedUntil.delete(leaf.key);
        touchCache(leaf.key, payload);
        return payload;
      })
      .catch((error) => {
        if (isAbortError(error) || signal?.aborted) throw error;
        failedUntil.set(leaf.key, Date.now() + retryCooldownMs);
        throw error;
      })
      .finally(() => undefined);
    return task;
  };

  const loadBounded = async (
    leaves: readonly ViewportPoiLeaf[],
    signal?: AbortSignal
  ): Promise<LoadedViewportPoiShard[]> => {
    const results: Array<LoadedViewportPoiShard | null> = new Array(leaves.length).fill(null);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrentLoads, leaves.length) }, async () => {
      while (cursor < leaves.length) {
        if (signal?.aborted) break;
        const index = cursor;
        cursor += 1;
        const leaf = leaves[index];
        try {
          const entry = { leaf, shard: await loadLeaf(leaf, signal) };
          results[index] = entry;
        } catch {
          // A missing or temporarily unavailable shard must not reject the whole
          // viewport batch. Successful siblings remain visible and clickable.
        }
      }
    }));
    return results.filter((entry): entry is LoadedViewportPoiShard => entry !== null);
  };

  const viewportLeaves = (): ViewportPoiLeaf[] => {
    if (!dataset) return [];
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const longitudeSpan = Math.max(0.1, east - west);
    const latitudeSpan = Math.max(0.1, north - south);
    const bufferRatio = map.getZoom() >= 13 ? 0.18 : 0.24;
    const viewport: [number, number, number, number] = [
      west - Math.max(0.10, longitudeSpan * bufferRatio),
      south - Math.max(0.08, latitudeSpan * bufferRatio),
      east + Math.max(0.10, longitudeSpan * bufferRatio),
      north + Math.max(0.08, latitudeSpan * bufferRatio)
    ];
    const center = map.getCenter();
    const candidates = dataset.leaves
      .filter((leaf) => intersects(leaf.bbox, viewport))
      .sort((a, b) => centerDistanceSquared(a, center.lng, center.lat) - centerDistanceSquared(b, center.lng, center.lat));
    return candidates.slice(0, maxViewportShards);
  };

  const buildCollection = (
    loaded: readonly LoadedViewportPoiShard[],
    zoom: number
  ): { collection: FeatureCollection<Point, Record<string, unknown>>; bytes: number; iconIds: Set<string> } => {
    const features: Feature<Point, Record<string, unknown>>[] = [];
    const seen = new Set<string>();
    let bytes = 0;
    for (const { leaf, shard } of loaded) {
      bytes += leaf.bytes;
      for (const feature of shard.features) {
        const properties = feature.properties ?? {};
        const minzoom = Number(properties.minzoom ?? dataset?.runtime_minzoom ?? 0);
        if (Number.isFinite(minzoom) && minzoom > zoom + 0.4) continue;
        const id = typeof properties.id === "string"
          ? properties.id
          : typeof feature.id === "string" || typeof feature.id === "number"
            ? String(feature.id)
            : `${feature.geometry.coordinates[0]}:${feature.geometry.coordinates[1]}:${features.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        features.push(feature.id === id ? feature : { ...feature, id });
      }
    }
    return {
      collection: { type: "FeatureCollection", features },
      bytes,
      iconIds: iconIdsForFeatures(features)
    };
  };

  const refreshNow = async (): Promise<void> => {
    if (destroyed || paused || !started || !dataset || !visible || !getVisible()) return;

    // Keep the current source resident while layers are below their display
    // threshold. Zooming back in is therefore instant and does not re-send or
    // re-parse the same data.
    if (map.getZoom() + 0.001 < dataset.runtime_minzoom) return;

    const leaves = viewportLeaves();
    announceLeafIcons(leaves);
    const zoomBucket = Math.floor(map.getZoom() * 2);
    const signature = `${zoomBucket}:${leaves.map((leaf) => leaf.key).join(",")}`;
    if (signature === lastLeafSignature && currentSnapshot.state === "ready") return;
    const refreshGeneration = ++generation;
    activeBatchAborter?.abort();
    const batchAborter = new AbortController();
    activeBatchAborter = batchAborter;
    lastLeafSignature = signature;
    publish({ ...currentSnapshot, state: "loading" });

    if (!leaves.length) {
      await setData(EMPTY_COLLECTION);
      if (destroyed || refreshGeneration !== generation) return;
      publish({ state: "ready", records: 0, shards: 0, bytes: 0, iconIds: new Set() });
      if (activeBatchAborter === batchAborter) activeBatchAborter = null;
      return;
    }

    const leafOrder = new Map(leaves.map((leaf, index) => [leaf.key, index] as const));
    const loadedByKey = new Map<string, LoadedViewportPoiShard>();
    for (const leaf of leaves) {
      const cached = shardCache.get(leaf.key);
      if (cached) {
        touchCache(leaf.key, cached);
        loadedByKey.set(leaf.key, { leaf, shard: cached });
      }
    }

    const orderedLoaded = (): LoadedViewportPoiShard[] => [...loadedByKey.values()]
      .sort((a, b) => (leafOrder.get(a.leaf.key) ?? 0) - (leafOrder.get(b.leaf.key) ?? 0));

    // Paint the complete cached subset once. Network siblings are then folded
    // into one final atomic source transaction instead of rebuilding clustering
    // every time another shard finishes parsing.
    // On the first source population (or after a style swap), a cached subset
    // gives an immediate non-blank result. During ordinary viewport changes the
    // previous complete source remains visible, so replacing it with a partial
    // cache and then replacing it again only doubles worker/clustering work.
    if (loadedByKey.size > 0 && committedFeatures.size === 0) {
      const cachedLoaded = orderedLoaded();
      const cachedBuilt = buildCollection(cachedLoaded, map.getZoom());
      await setData(cachedBuilt.collection);
      if (destroyed || refreshGeneration !== generation) return;
      const iconIds = new Set(currentSnapshot.iconIds);
      for (const id of cachedBuilt.iconIds) iconIds.add(id);
      publish({
        state: "loading",
        records: cachedBuilt.collection.features.length,
        shards: cachedLoaded.length,
        bytes: cachedBuilt.bytes,
        iconIds
      });
    }

    const missingLeaves = leaves.filter((leaf) => !loadedByKey.has(leaf.key));
    const loadedMissing = await loadBounded(missingLeaves, batchAborter.signal);
    for (const entry of loadedMissing) loadedByKey.set(entry.leaf.key, entry);

    if (destroyed || refreshGeneration !== generation) return;
    const loaded = orderedLoaded();
    if (!loaded.length) {
      // Preserve the last usable viewport instead of replacing it with a blank
      // map. The cooldown prevents move/zoom events from creating a retry storm.
      lastLeafSignature = "";
      publish({ ...currentSnapshot, state: "fallback" });
      if (activeBatchAborter === batchAborter) activeBatchAborter = null;
      return;
    }

    const built = buildCollection(loaded, map.getZoom());
    await setData(built.collection);
    if (destroyed || refreshGeneration !== generation) return;
    const iconIds = new Set(currentSnapshot.iconIds);
    for (const id of built.iconIds) iconIds.add(id);
    publish({
      state: loaded.length === leaves.length ? "ready" : "fallback",
      records: built.collection.features.length,
      shards: loaded.length,
      bytes: built.bytes,
      iconIds
    });
    if (activeBatchAborter === batchAborter) activeBatchAborter = null;
  };

  const queuedRefresh = debounceAsync(async () => {
    try {
      await refreshNow();
    } catch (error) {
      if (!isAbortError(error)) recordRuntimeDiagnostic(`viewport-poi.${datasetId}`, error, "warning");
    }
  }, lowPowerProfile ? 90 : 60);
  const onViewportChange = (): void => queuedRefresh();
  const onStyleLoad = (): void => {
    // setStyle() creates a fresh GeoJSON source. The parsed shard LRU remains
    // valid, but the source identity must be re-seeded from cache immediately.
    committedFeatures = new Map();
    sourceWrite = Promise.resolve();
    lastLeafSignature = "";
    activeBatchAborter?.abort();
    queuedRefresh();
  };

  const start = async (): Promise<void> => {
    if (started) {
      await refreshNow();
      return;
    }
    started = true;
    const manifest = await fetchPersistentJson<ViewportPoiManifest>(manifestUrl, "Viewport POI manifest");
    if (manifest.schema !== "NAV KURD viewport POI shards v1" || manifest.release !== MAP_DATA_VERSION) {
      throw new Error("Viewport POI manifest identity is invalid.");
    }
    dataset = manifest.datasets[datasetId] ?? null;
    if (!dataset) throw new Error(`Viewport POI dataset is missing: ${datasetId}`);
    const keys = new Set<string>();
    for (const leaf of dataset.leaves) {
      if (keys.has(leaf.key)) throw new Error(`Viewport POI shard key is duplicated: ${datasetId}:${leaf.key}`);
      keys.add(leaf.key);
      resolveViewportPoiAssetUrl(manifestUrl, leaf.file);
    }
    map.on("moveend", onViewportChange);
    map.on("zoomend", onViewportChange);
    map.on("style.load", onStyleLoad);
    await refreshNow();
  };

  const setVisible = (nextVisible: boolean): void => {
    visible = nextVisible;
    if (visible) {
      queuedRefresh();
    } else {
      generation += 1;
      activeBatchAborter?.abort();
    }
    // Data remains resident while hidden. The UI layer visibility is controlled
    // separately, so showing places again never requires a download or reparse.
  };

  return {
    start,
    refresh: refreshNow,
    setVisible,
    setPaused: (nextPaused: boolean) => {
      if (paused === nextPaused) return;
      paused = nextPaused;
      if (paused) {
        generation += 1;
        activeBatchAborter?.abort();
      }
      else {
        queuedRefresh();
      }
    },
    snapshot: () => currentSnapshot,
    destroy: () => {
      destroyed = true;
      generation += 1;
      activeBatchAborter?.abort();
      map.off("moveend", onViewportChange);
      map.off("zoomend", onViewportChange);
      map.off("style.load", onStyleLoad);
      shardCache.clear();
      failedUntil.clear();
      committedFeatures.clear();
    }
  };
}
