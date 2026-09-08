import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LocalityFeature } from "./types";

const SOURCE_ID = "kri-locality-source";
const MIN_DETAIL_ZOOM = 9.05;
const MINOR_PLACES = new Set(["village", "locality", "hamlet", "suburb"]);
const EMPTY: FeatureCollection<Point, Record<string, unknown>> = { type: "FeatureCollection", features: [] };

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
  let committedIds = new Set<string>();

  const source = (): GeoJSONSource | undefined => map.getSource(SOURCE_ID) as GeoJSONSource | undefined;

  const commit = async (): Promise<void> => {
    if (destroyed) return;
    const target = source() as (GeoJSONSource & {
      updateData?: (diff: { remove?: string[]; add?: Feature<Point, Record<string, unknown>>[]; removeAll?: boolean }, waitForCompletion?: true) => Promise<void> | GeoJSONSource;
      setData: (data: FeatureCollection<Point, Record<string, unknown>>, waitForCompletion?: true) => Promise<void> | GeoJSONSource;
    }) | undefined;
    if (!target) return;

    const zoom = map.getZoom();
    const signature = `${visible}:${boundsSignature(map)}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    if (!visible || zoom < MIN_DETAIL_ZOOM) {
      if (committedIds.size === 0) return;
      if (target.updateData) await Promise.resolve(target.updateData({ removeAll: true }, true));
      else await Promise.resolve(target.setData(EMPTY, true));
      committedIds = new Set();
      return;
    }

    const bounds = map.getBounds();
    const longitudePadding = Math.max(0.08, (bounds.getEast() - bounds.getWest()) * 0.12);
    const latitudePadding = Math.max(0.06, (bounds.getNorth() - bounds.getSouth()) * 0.12);
    const west = bounds.getWest() - longitudePadding;
    const east = bounds.getEast() + longitudePadding;
    const south = bounds.getSouth() - latitudePadding;
    const north = bounds.getNorth() + latitudePadding;
    const features: Feature<Point, Record<string, unknown>>[] = [];
    const nextIds = new Set<string>();

    for (const locality of getLocalities()) {
      const place = locality.properties.place;
      if (!place || !MINOR_PLACES.has(place)) continue;
      const [longitude, latitude] = locality.geometry.coordinates;
      if (longitude < west || longitude > east || latitude < south || latitude > north) continue;
      const id = String(locality.properties.id);
      nextIds.add(id);
      features.push({
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [longitude, latitude] },
        properties: { id, place }
      });
    }

    const remove = [...committedIds].filter((id) => !nextIds.has(id));
    const add = features.filter((feature) => !committedIds.has(String(feature.id)));
    if (target.updateData && committedIds.size > 0) {
      if (remove.length || add.length) await Promise.resolve(target.updateData({ remove: remove.length ? remove : undefined, add: add.length ? add : undefined }, true));
    } else {
      await Promise.resolve(target.setData({ type: "FeatureCollection", features }, true));
    }
    committedIds = nextIds;
  };

  const refresh = (): void => {
    if (destroyed || document.hidden || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      void commit();
    });
  };
  const onSettledCamera = (): void => refresh();

  return {
    start: () => {
      if (started) { refresh(); return; }
      started = true;
      map.on("moveend", onSettledCamera);
      map.on("zoomend", onSettledCamera);
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
      committedIds.clear();
    }
  };
}
