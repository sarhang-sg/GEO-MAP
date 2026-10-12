import data from "../data/road-hazards.json";
import type { FeatureCollection, Point } from "geojson";
import type { LayerSpecification } from "maplibre-gl";
import type { Language } from "./types";

export const ROAD_HAZARD_SOURCE_ID = "kri-road-hazard-source";
export const ROAD_HAZARD_LAYER_ID = "kri-road-hazards";
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
};
export function roadHazardDetails(kind: unknown, language: Language): { color: string; label: string } | null {
  const record = typeof kind === "string" ? kinds[kind] : null;
  return record ? { color: record.color, label: record[language] } : null;
}
export function roadHazardLayer(visible: boolean): LayerSpecification {
  return { id: ROAD_HAZARD_LAYER_ID, source: ROAD_HAZARD_SOURCE_ID, type: "circle", minzoom: 8.5,
    layout: { visibility: visible ? "visible" : "none" },
    paint: { "circle-color": ["match", ["get", "road_hazard"], ...Object.entries(kinds).flatMap(([id, kind]) => [id, kind.color]), "#ffffff"] as never,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8.5, 3, 12, 5, 16, 7],
      "circle-stroke-color": "#102139", "circle-stroke-width": 1.8, "circle-opacity": 1,
      "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport" } };
}
