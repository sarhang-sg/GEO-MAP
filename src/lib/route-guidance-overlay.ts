import { Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { bearingBetween, type LngLatTuple } from "./location";
import { maneuverLabel, type Maneuver } from "./route-maneuvers";
import { routeSlice } from "./route-progress";
import type { Language } from "./types";

const SOURCE = "nav-route-guidance-source", IMAGE = "nav-route-guidance-chevron";
export const ROUTE_GUIDANCE_LAYER_IDS = ["nav-route-guidance-casing", "nav-route-guidance-line", "nav-route-guidance-head"] as const;
export class RouteGuidanceOverlay {
  private readonly element = document.createElement("div");
  private readonly marker: Marker;
  private attached = false;
  private signature = "";
  constructor(private readonly map: MapLibreMap) {
    this.element.className = "route-map-guidance";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.marker = new Marker({ element: this.element, anchor: "bottom", offset: [0, -20] });
  }
  ensureLayers(): void {
    if (!this.map.getStyle()?.layers) return;
    if (!this.map.hasImage(IMAGE)) {
      const canvas = document.createElement("canvas"); canvas.width = 48; canvas.height = 48;
      const context = canvas.getContext("2d");
      if (context) {
        context.beginPath(); context.moveTo(12, 30); context.lineTo(24, 16); context.lineTo(36, 30);
        context.lineWidth = 10; context.lineCap = "round"; context.lineJoin = "round";
        context.strokeStyle = "#152e50"; context.stroke(); context.lineWidth = 6; context.strokeStyle = "#ffffff"; context.stroke();
        this.map.addImage(IMAGE, context.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
      }
    }
    if (!this.map.getSource(SOURCE)) { this.map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } }); this.signature = ""; }
    for (const [id, width, color] of [[ROUTE_GUIDANCE_LAYER_IDS[0], 11, "#152e50"], [ROUTE_GUIDANCE_LAYER_IDS[1], 6, "#ffffff"]] as const) {
      if (!this.map.getLayer(id)) this.map.addLayer({ id, type: "line", source: SOURCE, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": width, "line-color": color } });
    }
    if (!this.map.getLayer(ROUTE_GUIDANCE_LAYER_IDS[2])) this.map.addLayer({ id: ROUTE_GUIDANCE_LAYER_IDS[2], type: "symbol", source: SOURCE, filter: ["==", ["geometry-type"], "Point"], layout: {
      "icon-image": IMAGE, "icon-size": 1.15, "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true
    } });
  }
  update(step: Maneuver | null, route: readonly LngLatTuple[], at: number, remaining: number, language: Language, formattedDistance: string): void {
    if (!step || !step.coordinate || remaining > 350 || remaining < -5) { this.clear(); return; }
    this.ensureLayers();
    const coordinate = step.coordinate;
    const signature = `${step.atMeters}:${coordinate.join(",")}:${route.length}`;
    if (signature !== this.signature) {
      const turn = routeSlice(route, Math.max(0, at - 22), at + 26);
      const head = turn.at(-1), previous = turn.at(-2);
      const bearing = head && previous ? bearingBetween(previous, head) : null;
      const features: GeoJSON.Feature[] = step.type === "arrive" || turn.length < 2 ? [] : [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: turn } },
        ...(head && bearing !== null ? [{ type: "Feature" as const, properties: { bearing }, geometry: { type: "Point" as const, coordinates: head } }] : [])
      ];
      (this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      this.signature = signature;
    }
    // This label is anchored to the real maneuver, not a fixed screen panel.
    const title = maneuverLabel(step, language);
    const text = `${title} · ${formattedDistance}`;
    if (this.element.textContent !== text) this.element.textContent = text;
    this.element.dir = language === "en" ? "ltr" : "rtl";
    this.element.title = step.name;
    this.marker.setLngLat(coordinate);
    if (!this.attached) { this.marker.addTo(this.map); this.attached = true; }
  }
  clear(): void {
    if (this.attached) { this.marker.remove(); this.attached = false; }
    if (this.signature) (this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
    this.signature = "";
  }
}
