import type { FeatureCollection, Polygon } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LngLatTuple } from "./location";

import { isCameraTilted } from "./map-camera-controller";

export const LOCATION_VOLUME_LAYER = "location-3d-volume";
const SOURCE = "location-3d-source";
type Volume = FeatureCollection<Polygon, { color: string; base: number; height: number }>;

/** Real extruded geometry in world coordinates, using the existing renderer. */
export function locationVolume(coordinate: LngLatTuple, heading: number | null, zoom: number, referenceBearing = 0): Volume {
  if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[1]) > 85 || Math.abs(coordinate[0]) > 180 || !Number.isFinite(zoom) || !Number.isFinite(referenceBearing) || (heading !== null && !Number.isFinite(heading))) return { type: "FeatureCollection", features: [] };
  // A 34px-wide, 47px-long arrow in CSS pixels, independent of zoom and DPR.
  // Real extrusion supplies the depth; the flat camera retains its original dot.
  const size = 28 * 40075016.686 * Math.cos(coordinate[1] * Math.PI / 180) / (512 * 2 ** zoom);
  const angle = (heading ?? referenceBearing) * Math.PI / 180, sin = Math.sin(angle), cos = Math.cos(angle);
  const latScale = 1 / 111195, lngScale = latScale / Math.max(.1, Math.cos(coordinate[1] * Math.PI / 180));
  const feature = (shape: number[][], height: number, base: number, color: string): Volume["features"][number] => {
    const points = shape.map(([x,y]) => [coordinate[0] + size * (x*cos + y*sin) * lngScale, coordinate[1] + size * (-x*sin + y*cos) * latScale]);
    points.push([...points[0]]);
    return { type: "Feature", properties: { color, height: size*height, base: size*base }, geometry: { type: "Polygon", coordinates: [points] } };
  };
  // Without a compass, point up the camera as a reference, not a measured heading.
  return { type: "FeatureCollection", features: [feature([[0,1],[-.60,-.68],[0,-.34],[.60,-.68]],.25,0,"#443094"),
    feature([[0,.94],[-.51,-.57],[0,-.27]],.34,.25,"#e5f5ff"), feature([[0,.94],[0,-.27],[.51,-.57]],.30,.25,"#8270ff")] };
}

export class LocationVolume {
  private coordinate: LngLatTuple | null = null;
  private heading: number | null = null;
  private signature = "";
  private generation = 0;
  private destroyed = false;
  private active = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly map: MapLibreMap) {
    map.on("zoom", this.paint); map.on("rotate", this.paint);
    map.on("pitch", this.paint); map.on("style.load", this.onStyleLoad); map.on("remove", this.destroy);
  }
  update(coordinate: LngLatTuple | null, heading: number | null): void { this.coordinate = coordinate; this.heading = heading; this.paint(); }
  private visible(active: boolean): void {
    this.active = active;
    // Switch pucks atomically; opacity cross-fades briefly display both.
    for (const [id, shown, properties] of [
      [LOCATION_VOLUME_LAYER, active, ["fill-extrusion-opacity"]],
      ["location-direction-arrow", !active, ["icon-opacity"]],
      ["location-dot", !active, ["circle-opacity", "circle-stroke-opacity"]]
    ] as const) {
      if (!this.map.getLayer(id)) continue;
      for (const property of properties) this.map.setPaintProperty(id, `${property}-transition`, { duration: 0, delay: 0 });
      this.map.setLayoutProperty(id, "visibility", shown ? "visible" : "none");
    }
    if (this.map.getLayer(LOCATION_VOLUME_LAYER)) this.map.setPaintProperty(LOCATION_VOLUME_LAYER,"fill-extrusion-opacity",active ? 1 : 0);
    if (this.map.getLayer("location-direction-arrow")) this.map.setPaintProperty("location-direction-arrow","icon-opacity",active ? 0 : .98);
    if (this.map.getLayer("location-dot")) {
      this.map.setPaintProperty("location-dot","circle-opacity",active ? 0 : 1);
      this.map.setPaintProperty("location-dot","circle-stroke-opacity",active ? 0 : 1);
    }
  }
  private onStyleLoad = (): void => { this.active = false; this.generation++; this.signature = ""; this.paint(); };
  private destroy = (): void => {
    this.destroyed = true; this.generation++;
    this.map.off("zoom",this.paint); this.map.off("rotate",this.paint);
    this.map.off("pitch",this.paint); this.map.off("style.load",this.onStyleLoad); this.map.off("remove",this.destroy);
  };
  private paint = (): void => {
    if (this.destroyed || !this.map.getStyle()?.layers) return;
    const zoom = this.map.getZoom();
    if (!this.coordinate || !isCameraTilted(this.map.getPitch())) {
      if (this.active || this.signature) {
        this.generation++;
        this.signature = "";
        this.visible(false);
      }
      return;
    }
    if (!this.map.getSource(SOURCE)) {
      this.map.addSource(SOURCE,{type:"geojson",data:{type:"FeatureCollection",features:[]},tolerance:0,maxzoom:22}); this.signature = "";
    }
    if (!this.map.getLayer(LOCATION_VOLUME_LAYER)) this.map.addLayer({id:LOCATION_VOLUME_LAYER,type:"fill-extrusion",source:SOURCE,
      paint:{"fill-extrusion-color":["get","color"],"fill-extrusion-base":["get","base"],"fill-extrusion-height":["get","height"],"fill-extrusion-opacity":0,"fill-extrusion-vertical-gradient":true}});
    const referenceBearing = this.heading === null ? this.map.getBearing() : 0;
    const signature = `${this.coordinate}:${this.heading}:${zoom}:${referenceBearing}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const generation = ++this.generation, source = this.map.getSource(SOURCE) as GeoJSONSource;
    const data = locationVolume(this.coordinate,this.heading,zoom,referenceBearing);

    this.writes = this.writes.catch(() => undefined).then(async () => {
      if (this.destroyed || generation !== this.generation || source !== this.map.getSource(SOURCE)) return;
      await source.setData(data);
      if (this.destroyed || !this.coordinate || !isCameraTilted(this.map.getPitch()) || source !== this.map.getSource(SOURCE) || generation !== this.generation) return;
      if (!this.active && data.features.length) this.visible(true);
    }).catch(() => { if (!this.destroyed && generation === this.generation) { this.signature = ""; } });
  };
}
