import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LocalityFeature } from "./types";
import { recordRuntimeDiagnostic } from "./runtime-diagnostics";

const SOURCE_ID = "kri-locality-source";
const MIN_DETAIL_ZOOM = 9.05;
const MINOR_PLACES = new Set(["village", "locality", "hamlet", "suburb"]);

type LocalityViewportSourceOptions = {
  map: MapLibreMap;
  getLocalities: () => readonly LocalityFeature[];
  getVisible: () => boolean;
};

export type LocalityViewportSourceController = {
  start: () => void;
  refresh: () => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
};

function boundsSignature(map: MapLibreMap): string {
  const bounds = map.getBounds();
  return [map.getZoom(), bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
    .map((value) => Math.round(value * 100) / 100)
    .join(":");
}

/**
 * Publishes only detailed minor localities intersecting the settled viewport.
 * Low zoom uses the tiny precomputed cluster source, so MapLibre never builds a
 * 12k-feature Supercluster index or parses the complete locality geometry twice.
 */
export function installLocalityViewportSourceController(options: LocalityViewportSourceOptions): LocalityViewportSourceController {
  const { map, getLocalities } = options;
  let visible = options.getVisible();
  let started = false;
  let destroyed = false;
  let frame: number | null = null;
  let lastSignature = "";
  let committedLocalities: readonly LocalityFeature[] | null = null;
  let committedFeatures = new Map<string, Feature<Point, Record<string, unknown>>>();
  let committedSource: GeoJSONSource | undefined;
  let writing = false;
  let refreshQueued = false;

  const source = (): GeoJSONSource | undefined => map.getSource(SOURCE_ID) as GeoJSONSource | undefined;

  const commit = async (): Promise<void> => {
    if (destroyed) return;
    const target = source() as (GeoJSONSource & {
      updateData?: (diff: { remove?: string[]; add?: Feature<Point, Record<string, unknown>>[]; removeAll?: boolean }, waitForCompletion?: true) => Promise<void> | GeoJSONSource;
      setData: (data: FeatureCollection<Point, Record<string, unknown>>, waitForCompletion?: true) => Promise<void> | GeoJSONSource;
    }) | undefined;
    if (!target) return;
    if (target !== committedSource) {
      committedSource = target;
      committedFeatures = new Map();
      lastSignature = "";
    }

    const zoom = map.getZoom();
    const signature = `${visible}:${boundsSignature(map)}`;
    const localities = getLocalities();
    if (signature === lastSignature && localities === committedLocalities) return;
    // Visibility and minzoom belong to the layers. Retain this bounded viewport
    // so hiding/zooming does not destroy and recreate identical features.
    if (!visible || zoom < MIN_DETAIL_ZOOM) return;

    const bounds = map.getBounds();
    const longitudePadding = Math.max(0.08, (bounds.getEast() - bounds.getWest()) * 0.12);
    const latitudePadding = Math.max(0.06, (bounds.getNorth() - bounds.getSouth()) * 0.12);
    const west = bounds.getWest() - longitudePadding;
    const east = bounds.getEast() + longitudePadding;
    const south = bounds.getSouth() - latitudePadding;
    const north = bounds.getNorth() + latitudePadding;
    const features: Feature<Point, Record<string, unknown>>[] = [];
    const nextFeatures = new Map<string, Feature<Point, Record<string, unknown>>>();

    for (const locality of localities) {
      const place = locality.properties.place;
      if (!place || !MINOR_PLACES.has(place)) continue;
      const [longitude, latitude] = locality.geometry.coordinates;
      if (longitude < west || longitude > east || latitude < south || latitude > north) continue;
      const id = String(locality.properties.id);
      const feature: Feature<Point, Record<string, unknown>> = {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [longitude, latitude] },
        properties: { id, place }
      };
      features.push(feature);
      nextFeatures.set(id, feature);
    }

    const remove = [...committedFeatures.keys()].filter((id) => !nextFeatures.has(id));
    const add = [];
    for (const [id, feature] of nextFeatures) {
      const previous = committedFeatures.get(id);
      if (previous && previous.properties.place === feature.properties.place
        && previous.geometry.coordinates[0] === feature.geometry.coordinates[0]
        && previous.geometry.coordinates[1] === feature.geometry.coordinates[1]) continue;
      if (previous) remove.push(id);
      add.push(feature);
    }
    if (target.updateData && committedFeatures.size > 0) {
      if (remove.length || add.length) await Promise.resolve(target.updateData({ remove: remove.length ? remove : undefined, add: add.length ? add : undefined }, true));
    } else {
      await Promise.resolve(target.setData({ type: "FeatureCollection", features }, true));
    }
    if (!destroyed && source() === target) {
      committedFeatures = nextFeatures;
      committedLocalities = localities;
      lastSignature = signature;
    }
  };

  const refresh = (): void => {
    if (destroyed || document.hidden || frame !== null) return;
    if (writing) { refreshQueued = true; return; }
    frame = window.requestAnimationFrame(() => {
      frame = null;
      writing = true;
      void commit().catch((error: unknown) => {
        lastSignature = "";
        recordRuntimeDiagnostic("map.locality-viewport", error, "warning");
      }).finally(() => {
        writing = false;
        if (refreshQueued) { refreshQueued = false; refresh(); }
      });
    });
  };
  const onSettledCamera = (): void => refresh();

  return {
    start: () => {
      if (started) { refresh(); return; }
      started = true;
      map.on("moveend", onSettledCamera);
      map.on("zoomend", onSettledCamera);
      map.on("style.load", onSettledCamera);
      refresh();
    },
    refresh,
    setVisible: (next) => { visible = next; lastSignature = ""; refresh(); },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      map.off("moveend", onSettledCamera);
      map.off("zoomend", onSettledCamera);
      map.off("style.load", onSettledCamera);
      committedFeatures.clear();
    }
  };
}
