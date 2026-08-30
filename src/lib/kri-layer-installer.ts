import type { FeatureCollection, Point } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { DYNAMIC_LAYER_IDS, DYNAMIC_SOURCE_IDS } from "./map-layer-ids";
import { ensureLiveLocationLayers } from "./live-location-layers";
import { dataAssetUrl } from "./release";
import type { OwnerFeature } from "./types";

type KriDynamicLayerOptions = {
  map: MapLibreMap;
  ownerPlaces: FeatureCollection<Point, OwnerFeature["properties"]>;
  placesVisible: boolean;
  isMobileViewport: boolean;
  lowPowerProfile: boolean;
};

export function installKriDynamicLayers(options: KriDynamicLayerOptions): void {
  const {
    map,
    ownerPlaces,
    placesVisible,
    isMobileViewport,
    lowPowerProfile
  } = options;

  // Content layers may be rebuilt when locality or owner data changes. GPS
  // sources are deliberately preserved because replacing them clears the live
  // coordinate and causes the blue puck to disappear during a mode switch.
  DYNAMIC_LAYER_IDS.filter((id) => !id.startsWith("location-")).forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  DYNAMIC_SOURCE_IDS.filter((id) => !id.startsWith("location-")).forEach((id) => {
    if (map.getSource(id)) map.removeSource(id);
  });

  // Immutable compact geometry is fetched and parsed by MapLibre's worker.
  // This avoids structured-cloning 12,125 full features on the main thread.
  map.addSource("kri-locality-source", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
  map.addSource("kri-locality-major-source", { type: "geojson", data: dataAssetUrl("data/kri/kri-localities-major-runtime.geojson"), promoteId: "id" });
  map.addSource("kri-locality-cluster-source", { type: "geojson", data: dataAssetUrl("data/kri/kri-localities-cluster-runtime.geojson"), promoteId: "id" });
  map.addSource("atlas-places-source", { type: "geojson", data: ownerPlaces, cluster: true, clusterMaxZoom: 15, clusterRadius: lowPowerProfile ? 72 : 60 });

  const localityClusterMinZoom = isMobileViewport ? 7.65 : 7.15;
  const ownerPlaceMinZoom = isMobileViewport ? 8.65 : 6.85;
  const clusterBands = [
    { zoom: 7, minzoom: localityClusterMinZoom, maxzoom: 8.0 },
    { zoom: 8, minzoom: Math.max(8.0, localityClusterMinZoom), maxzoom: 9.0 },
    { zoom: 9, minzoom: Math.max(9.0, localityClusterMinZoom), maxzoom: 9.05 }
  ];
  for (const band of clusterBands) {
    if (band.minzoom >= band.maxzoom) continue;
    map.addLayer({ id: `kri-locality-clusters-z${band.zoom}`, type: "circle", source: "kri-locality-cluster-source", minzoom: band.minzoom, maxzoom: band.maxzoom, filter: ["==", ["get", "cluster_zoom"], band.zoom], layout: { visibility: placesVisible ? "visible" : "none" }, paint: { "circle-color": "#7f63cf", "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 50, 21, 150, 26], "circle-stroke-color": "#f3edff", "circle-stroke-width": 1.5, "circle-opacity": 0.93 } });
    map.addLayer({ id: `kri-locality-cluster-count-z${band.zoom}`, type: "symbol", source: "kri-locality-cluster-source", minzoom: band.minzoom, maxzoom: band.maxzoom, filter: ["==", ["get", "cluster_zoom"], band.zoom], layout: { visibility: placesVisible ? "visible" : "none", "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] }, paint: { "text-color": "#161637" } });
  }
  map.addLayer({ id: "kri-locality-village", type: "circle", source: "kri-locality-source", minzoom: 9.05, filter: ["match", ["get", "place"], ["village", "locality", "hamlet", "suburb"], true, false], layout: { visibility: placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.05, 1.15, 13.4, 1.75, 16, 2.7], "circle-color": "#a687ef", "circle-stroke-color": "#f5efff", "circle-stroke-width": 0.85, "circle-opacity": 0.9 } });
  map.addLayer({ id: "kri-locality-town", type: "circle", source: "kri-locality-major-source", minzoom: 7.35, filter: ["==", ["get", "place"], "town"], layout: { visibility: placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7.35, 3, 13, 5.5], "circle-color": "#ffe09a", "circle-stroke-color": "#222647", "circle-stroke-width": 1.2, "circle-opacity": 1 } });
  map.addLayer({ id: "kri-locality-city", type: "circle", source: "kri-locality-major-source", minzoom: 5.1, filter: ["==", ["get", "place"], "city"], layout: { visibility: placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5.1, 4.6, 13, 8], "circle-color": "#ffc86e", "circle-stroke-color": "#242745", "circle-stroke-width": 1.35, "circle-opacity": 1 } });
  map.addLayer({ id: "atlas-place-clusters", type: "circle", source: "atlas-places-source", minzoom: ownerPlaceMinZoom, filter: ["has", "point_count"], layout: { visibility: placesVisible ? "visible" : "none" }, paint: { "circle-color": "#f5b869", "circle-radius": ["step", ["get", "point_count"], 16, 10, 21, 50, 27], "circle-stroke-color": "#181d42", "circle-stroke-width": 2.3, "circle-opacity": 0.95 } });
  map.addLayer({ id: "atlas-place-count", type: "symbol", source: "atlas-places-source", minzoom: ownerPlaceMinZoom, filter: ["has", "point_count"], layout: { visibility: placesVisible ? "visible" : "none", "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#1d2344" } });
  map.addLayer({ id: "atlas-place-marker", type: "circle", source: "atlas-places-source", minzoom: ownerPlaceMinZoom, filter: ["!", ["has", "point_count"]], layout: { visibility: placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4.3, 14, 7.4], "circle-color": ["coalesce", ["get", "marker_color"], "#f17fb3"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.9, "circle-opacity": 1 } });

  ensureLiveLocationLayers(map);

}
