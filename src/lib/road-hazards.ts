import data from "../data/road-hazards.json";
import type { FeatureCollection, Point } from "geojson";
import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { Language } from "./types";

export const ROAD_HAZARD_SOURCE_ID = "kri-road-hazard-source";
export const ROAD_HAZARD_LAYER_ID = "kri-road-hazards";
export const ROAD_HAZARD_ICON_LAYER_ID = "kri-road-hazard-signs";
export const ROAD_HAZARD_DATA = data as unknown as FeatureCollection<Point>;
export const ROAD_HAZARD_SOURCE_IDS = data.features.flatMap(feature => feature.properties.source_ids);
const kinds: Record<string, { color: string; ku: string; ar: string; en: string }> = {
  speed_camera: { color: "#f3c447", ku: "کامێرای خێرایی", ar: "كاميرا سرعة", en: "Speed camera" },
  surveillance_camera: { color: "#4f9fff", ku: "کامێرای چاودێری", ar: "كاميرا مراقبة", en: "Surveillance camera" },
  checkpoint: { color: "#ef6378", ku: "بازگەی پشکنین", ar: "نقطة تفتيش", en: "Checkpoint" },
  border_crossing: { color: "#b28aff", ku: "دەروازەی سنووری", ar: "منفذ حدودي", en: "Border crossing" },
  speed_bump: { color: "#fa993c", ku: "تاسەی ڕێگا", ar: "مطب سرعة", en: "Speed bump" },
  railway_crossing: { color: "#f180c1", ku: "تێپەڕگەی شەمەندەفەر", ar: "معبر سكة حديد", en: "Railway crossing" },
  pedestrian_crossing: { color: "#48ce98", ku: "تێپەڕگەی پیادە", ar: "معبر مشاة", en: "Pedestrian crossing" },
  traffic_signal: { color: "#4bc9d5", ku: "گڵۆپی هاتوچۆ", ar: "إشارة مرور", en: "Traffic signal" },
  dangerous_road: { color: "#ef6378", ku: "ڕێگای مەترسیدار", ar: "طريق خطر", en: "Dangerous road" },
  sharp_curve: { color: "#ffc267", ku: "پێچی توند", ar: "منعطف حاد", en: "Sharp bend" },
  uturn: { color: "#c6a1ff", ku: "یووتێرن", ar: "استدارة للخلف", en: "U-turn" },
};
export function roadHazardKind(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase();
  const alias: Record<string, string> = { military_checkpoint: "checkpoint", security_checkpoint: "checkpoint", bump: "speed_bump", hump: "speed_bump", traffic_calming: "speed_bump", international_border_crossing: "border_crossing" };
  const kind = alias[key] ?? key;
  return kinds[kind] ? kind : null;
}
export function roadHazardDetails(kind: unknown, language: Language): { color: string; label: string } | null {
  const key = roadHazardKind(kind);
  const record = key ? kinds[key] : null;
  return record ? { color: record.color, label: record[language] } : null;
}
export function roadHazardLayer(visible: boolean): LayerSpecification {
  return { id: ROAD_HAZARD_LAYER_ID, source: ROAD_HAZARD_SOURCE_ID, type: "circle", minzoom: 8.5, maxzoom: 11.5,
    layout: { visibility: visible ? "visible" : "none" },
    paint: { "circle-color": ["match", ["get", "road_hazard"], ...Object.entries(kinds).flatMap(([id, kind]) => [id, kind.color]), "#ffffff"] as never,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8.5, 3, 12, 5, 16, 7],
      "circle-stroke-color": "#102139", "circle-stroke-width": 1.8, "circle-opacity": 1,
      "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport" } };
}

export function roadHazardIconLayer(visible: boolean): LayerSpecification {
  return { id: ROAD_HAZARD_ICON_LAYER_ID, source: ROAD_HAZARD_SOURCE_ID, type: "symbol", minzoom: 11.5,
    layout: { visibility: visible ? "visible" : "none", "icon-image": ["concat", "road-sign-", ["get", "road_hazard"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11.5, 0.65, 16, 0.95],
      "icon-allow-overlap": false, "icon-ignore-placement": false, "icon-padding": 9,
      "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport" } };
}

/** Small cached sprites, collision managed by MapLibre, with no per-frame DOM. */
export function installRoadHazardImages(map: MapLibreMap): void {
  for (const [kind, detail] of Object.entries(kinds)) {
    const id = `road-sign-${kind}`;
    if (map.hasImage(id)) continue;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d"); if (!ctx) continue;
    ctx.fillStyle = "#102139"; ctx.strokeStyle = detail.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(4, 4, 56, 56, 17); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const path = (points: number[][]) => { ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke(); };
    if (kind.includes("camera")) {
      ctx.strokeRect(17, 24, 30, 21); path([[23,24],[26,19],[38,19],[41,24]]);
      ctx.beginPath(); ctx.arc(32,34,6,0,Math.PI*2); ctx.stroke();
    } else if (kind === "speed_bump") {
      ctx.beginPath(); ctx.moveTo(14,43); ctx.lineTo(20,43); ctx.bezierCurveTo(22,23,42,23,44,43); ctx.lineTo(50,43); ctx.stroke();
      path([[19,49],[45,49]]);
    } else if (kind === "checkpoint" || kind === "border_crossing") {
      path([[17,48],[17,28],[49,22],[49,29],[17,35]]); path([[27,26],[30,32]]); path([[39,24],[42,30]]);
    } else if (kind === "uturn") {
      ctx.beginPath(); ctx.moveTo(44,48); ctx.lineTo(44,29); ctx.bezierCurveTo(44,12,21,12,21,29); ctx.lineTo(21,40); ctx.stroke(); path([[13,32],[21,41],[29,32]]);
    } else if (kind === "sharp_curve") {
      path([[23,48],[23,35],[41,29],[41,17]]); path([[33,25],[41,17],[49,25]]);
    } else if (kind === "traffic_signal") {
      ctx.strokeRect(23,14,18,36); for (const [i,c] of ["#ff6378","#ffd184","#48ce98"].entries()) { ctx.fillStyle=c;ctx.beginPath();ctx.arc(32,22+i*10,3,0,Math.PI*2);ctx.fill(); }
    } else if (kind === "railway_crossing") {
      path([[20,16],[20,49]]);path([[44,16],[44,49]]);for(const y of [22,32,42])path([[17,y],[47,y]]);
    } else if (kind === "pedestrian_crossing") {
      ctx.beginPath();ctx.arc(32,17,3,0,Math.PI*2);ctx.fill();path([[32,24],[28,34],[35,39],[38,47]]);path([[28,34],[21,45]]);path([[23,29],[32,24],[40,30]]);
    } else { path([[32,16],[49,47],[15,47],[32,16]]);path([[32,27],[32,35]]);ctx.beginPath();ctx.arc(32,41,1.5,0,Math.PI*2);ctx.fill(); }
    map.addImage(id, ctx.getImageData(0,0,64,64), {pixelRatio:2});
  }
  if(map.getSource(ROAD_HAZARD_SOURCE_ID) && !map.getLayer(ROAD_HAZARD_ICON_LAYER_ID)) {
    map.addLayer(roadHazardIconLayer(map.getLayoutProperty(ROAD_HAZARD_LAYER_ID,"visibility") !== "none"));
  }
}
