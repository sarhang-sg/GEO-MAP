import type { FeatureCollection, Polygon } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LngLatTuple } from "./location";

export const LOCATION_VOLUME_LAYER = "location-3d-volume";
const SOURCE = "location-3d-source";
type Volume = FeatureCollection<Polygon, { color: string; base: number; height: number }>;

/** Real extruded geometry in world coordinates, using the existing renderer. */
export function locationVolume(coordinate: LngLatTuple, heading: number | null, zoom: number): Volume {
  const size = 14 * 40075016.686 * Math.cos(coordinate[1] * Math.PI / 180) / (512 * 2 ** zoom);
  const angle = (heading ?? 0) * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  const latScale = 1 / 111195, lngScale = latScale / Math.max(.1, Math.cos(coordinate[1] * Math.PI / 180));
  const feature = (shape: number[][], height: number, base: number, color: string): Volume["features"][number] => {
    const points = shape.map(([x,y]) => [coordinate[0] + size * (x*cos + y*sin) * lngScale, coordinate[1] + size * (-x*sin + y*cos) * latScale]);
    points.push([...points[0]]);
    return { type: "Feature", properties: { color, height: size*height, base: size*base }, geometry: { type: "Polygon", coordinates: [points] } };
  };
  if (heading === null) {
    const circle = Array.from({ length: 24 }, (_,i) => [Math.cos(i*Math.PI/12)*.55, Math.sin(i*Math.PI/12)*.55]);
    return { type: "FeatureCollection", features: [feature(circle,.24,0,"#7657ff"), feature(circle.map(([x,y]) => [x*.78,y*.78]),.30,.24,"#c9c3ff")] };
  }
  return { type: "FeatureCollection", features: [feature([[0,1],[-.60,-.68],[0,-.34],[.60,-.68]],.25,0,"#7657ff"),
    feature([[0,.94],[-.51,-.57],[0,-.27]],.34,.25,"#b6ecff"), feature([[0,.94],[0,-.27],[.51,-.57]],.30,.25,"#7485ff")] };
}

export class LocationVolume {
  private coordinate: LngLatTuple | null = null;
  private heading: number | null = null;
  private signature = "";
  constructor(private readonly map: MapLibreMap) {
    map.on("zoom", this.paint); map.on("pitch", this.paint);
    map.on("remove", () => { map.off("zoom", this.paint); map.off("pitch", this.paint); });
  }
  update(coordinate: LngLatTuple | null, heading: number | null): void { this.coordinate = coordinate; this.heading = heading; this.paint(); }
  private paint = (): void => {
    if (!this.map.getStyle()?.layers) return;
    const active = this.coordinate !== null && this.map.getPitch() >= 18;
    if (!this.map.getSource(SOURCE)) {
      this.map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0, maxzoom: 22 }); this.signature = "";
    }
    if (!this.map.getLayer(LOCATION_VOLUME_LAYER)) this.map.addLayer({ id: LOCATION_VOLUME_LAYER, type: "fill-extrusion", source: SOURCE,
      paint: { "fill-extrusion-color": ["get","color"], "fill-extrusion-base": ["get","base"], "fill-extrusion-height": ["get","height"], "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": true } });
    const signature = active ? `${this.coordinate}:${this.heading}:${this.map.getZoom().toFixed(2)}` : "flat";
    if (signature === this.signature) return;
    this.signature = signature;
    (this.map.getSource(SOURCE) as GeoJSONSource).setData(active ? locationVolume(this.coordinate!,this.heading,this.map.getZoom()) : { type: "FeatureCollection", features: [] });
    if (this.map.getLayer("location-direction-arrow")) this.map.setPaintProperty("location-direction-arrow","icon-opacity",active ? 0 : .98);
    if (this.map.getLayer("location-dot")) {
      this.map.setPaintProperty("location-dot","circle-opacity",active ? 0 : 1);
      this.map.setPaintProperty("location-dot","circle-stroke-opacity",active ? 0 : 1);
    }
  };
}
