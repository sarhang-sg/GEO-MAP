import maplibregl, { type Map as MapLibreMap, type MapMouseEvent, type PointLike } from "maplibre-gl";
import type { AtlasPlace } from "./atlas-places";
import type { LngLatTuple } from "./location";
import type { BasePoiFeature, LocalityFeature, OwnerFeature } from "./types";
import { BASE_POI_INTERACTIVE_LAYER_IDS } from "./poi-icon-catalog";
import { BASE_POI_CLUSTER_LAYER_ID, BASE_POI_SOURCE_ID } from "./poi-source";

const LOCALITY_INTERACTIVE_LAYER_IDS = [
  "kri-locality-city",
  "kri-locality-town",
  "kri-locality-village"
] as const;

const OWNER_INTERACTIVE_LAYER_IDS = ["atlas-place-marker-landmark", "atlas-place-marker-community", "atlas-place-marker-local", "atlas-place-marker"] as const;
const POINTER_HIT_RADIUS_PX = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? 16 : 13;

type MapInteractionOptions = {
  map: MapLibreMap;
  ownerPlaceById: (id: unknown) => AtlasPlace | null;
  showLocalityPopup: (feature: LocalityFeature) => void;
  showOwnerPopup: (place: AtlasPlace, coordinate: LngLatTuple) => void;
  showBasePoiPopup: (feature: BasePoiFeature) => boolean;
};

function setPointerCursor(map: MapLibreMap, layerId: string): void {
  map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
}

function existingLayers(map: MapLibreMap, ids: readonly string[]): string[] {
  return ids.filter((id) => Boolean(map.getLayer(id)));
}

function hitBox(point: { x: number; y: number }): [PointLike, PointLike] {
  return [
    [point.x - POINTER_HIT_RADIUS_PX, point.y - POINTER_HIT_RADIUS_PX],
    [point.x + POINTER_HIT_RADIUS_PX, point.y + POINTER_HIT_RADIUS_PX]
  ];
}

function sourceLayerId(eventFeature: maplibregl.MapGeoJSONFeature): string {
  return eventFeature.layer?.id || "";
}

/**
 * Installs map interactions once and keeps POI hit-testing dynamic.
 *
 * POI icon layers are created asynchronously after SVG assets are decoded. A
 * static layer-event registration can therefore miss those later layers and
 * make some visible schools/POIs appear untappable. The fallback hit-test below
 * resolves the currently existing layers at tap time, so icon layers added by a
 * later style lifecycle remain interactive without reinstalling listeners.
 */
export function installMapInteractions(options: MapInteractionOptions): void {
  const { map, ownerPlaceById, showLocalityPopup, showOwnerPopup, showBasePoiPopup } = options;
  const handledOriginalEvents = new WeakSet<Event>();
  const coordinatePickerActive = (): boolean => map.getContainer().closest<HTMLElement>(".map-shell")?.dataset.coordinatePicker === "active";

  const markHandled = (event: MapMouseEvent): void => {
    const original = event.originalEvent;
    if (original instanceof Event) handledOriginalEvents.add(original);
  };

  const wasHandled = (event: MapMouseEvent): boolean => {
    const original = event.originalEvent;
    return original instanceof Event && handledOriginalEvents.has(original);
  };

  const localityClusterLayers = ["kri-locality-clusters-z7", "kri-locality-clusters-z8", "kri-locality-clusters-z9"] as const;
  for (const layerId of localityClusterLayers) {
    if (!map.getLayer(layerId)) continue;
    map.on("click", layerId, (event) => {
      if (coordinatePickerActive()) return;
      const feature = event.features?.[0] ?? map.queryRenderedFeatures(event.point, { layers: [layerId] })[0];
      if (!feature?.geometry || feature.geometry.type !== "Point") return;
      markHandled(event);
      const center = feature.geometry.coordinates as LngLatTuple;
      const expansionZoom = Number(feature.properties?.expansion_zoom ?? map.getZoom() + 1.5);
      map.easeTo({ center, zoom: Math.max(map.getZoom() + 1, expansionZoom), duration: 520, essential: true });
    });
    setPointerCursor(map, layerId);
  }

  if (map.getLayer(BASE_POI_CLUSTER_LAYER_ID)) {
    map.on("click", BASE_POI_CLUSTER_LAYER_ID, (event) => {
    if (coordinatePickerActive()) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: [BASE_POI_CLUSTER_LAYER_ID] })[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      const source = map.getSource(BASE_POI_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!feature?.geometry || feature.geometry.type !== "Point" || clusterId === undefined || !source) return;
      markHandled(event);
      const center = feature.geometry.coordinates as LngLatTuple;
      source.getClusterExpansionZoom(clusterId).then((zoom) => map.easeTo({ center, zoom, duration: 480, essential: true })).catch(() => undefined);
    });
    setPointerCursor(map, BASE_POI_CLUSTER_LAYER_ID);
  }

  LOCALITY_INTERACTIVE_LAYER_IDS.forEach((layerId) => {
    setPointerCursor(map, layerId);
    map.on("click", layerId, (event) => {
    if (coordinatePickerActive()) return;
      const feature = event.features?.[0] as LocalityFeature | undefined;
      if (feature?.geometry?.type !== "Point") return;
      markHandled(event);
      showLocalityPopup(feature);
    });
  });

  map.on("click", "atlas-place-clusters", (event) => {
    if (coordinatePickerActive()) return;
    const feature = map.queryRenderedFeatures(event.point, { layers: ["atlas-place-clusters"] })[0];
    const clusterId = feature?.properties?.cluster_id as number | undefined;
    const source = map.getSource("atlas-places-source") as maplibregl.GeoJSONSource | undefined;
    if (!feature?.geometry || feature.geometry.type !== "Point" || clusterId === undefined || !source) return;
    markHandled(event);
    const center = feature.geometry.coordinates as LngLatTuple;
    source.getClusterExpansionZoom(clusterId).then((zoom) => map.easeTo({ center, zoom, duration: 500, essential: true })).catch(() => undefined);
  });

  map.on("click", "atlas-place-marker", (event) => {
    if (coordinatePickerActive()) return;
    const feature = event.features?.[0] as OwnerFeature | undefined;
    const place = ownerPlaceById(feature?.properties?.id);
    if (!place || feature?.geometry?.type !== "Point") return;
    markHandled(event);
    showOwnerPopup(place, feature.geometry.coordinates as LngLatTuple);
  });

  ["atlas-place-clusters", "atlas-place-marker"].forEach((layerId) => setPointerCursor(map, layerId));

  // Keep the canonical base-dot pointer cursor. Dynamically added icon layers
  // are handled by the tap-time query below and do not need listener reinstall.
  for (const layerId of ["kri-base-pois", "kri-natural-pois", "kri-security-pois", "kri-reviewed-pois"] as const) {
    if (map.getLayer(layerId)) setPointerCursor(map, layerId);
  }

  map.on("click", (event) => {
    if (coordinatePickerActive()) return;
    if (wasHandled(event)) return;

    const layers = existingLayers(map, [
      ...OWNER_INTERACTIVE_LAYER_IDS,
      ...LOCALITY_INTERACTIVE_LAYER_IDS,
      ...BASE_POI_INTERACTIVE_LAYER_IDS
    ]);
    if (!layers.length) return;

    const features = map.queryRenderedFeatures(hitBox(event.point), { layers });
    for (const rendered of features) {
      if (rendered.geometry?.type !== "Point") continue;
      const layerId = sourceLayerId(rendered);

      if (OWNER_INTERACTIVE_LAYER_IDS.includes(layerId as (typeof OWNER_INTERACTIVE_LAYER_IDS)[number])) {
        const feature = rendered as unknown as OwnerFeature;
        const place = ownerPlaceById(feature.properties?.id);
        if (!place) continue;
        showOwnerPopup(place, feature.geometry.coordinates as LngLatTuple);
        return;
      }

      if (LOCALITY_INTERACTIVE_LAYER_IDS.includes(layerId as (typeof LOCALITY_INTERACTIVE_LAYER_IDS)[number])) {
        showLocalityPopup(rendered as unknown as LocalityFeature);
        return;
      }

      if (BASE_POI_INTERACTIVE_LAYER_IDS.includes(layerId as (typeof BASE_POI_INTERACTIVE_LAYER_IDS)[number])) {
        if (showBasePoiPopup(rendered as unknown as BasePoiFeature)) return;
      }
    }
  });
}
