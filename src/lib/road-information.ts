import type { Language } from "./types";
import { bearingBetween, shortestHeadingDelta, type LngLatTuple } from "./location";
import { measureRouteProgress } from "./route-progress";

export type RoadInformation = { name: string; roadClass: string; surface: string | null; speedKmh: number | null; hazards: string[] };
export const ROAD_COPY = {
  ku: { road: "زانیاریی ڕێگا", surface: "ڕووی ڕێگا", unknown: "تۆمار نەکراوە", limit: "سنووری خێرایی", low: "سنووری خێرایی کەم", high: "سنووری خێرایی بەرز", source: "داتای نەخشە؛ تابلۆکانی ڕێگا پەیڕەو بکە", asphalt: "قیر", paved: "ڕێگای ڕووپۆشکراو", unpaved: "ڕێگای خۆڵ", gravel: "چەو", track: "ڕێگای لاوەکی / کشتوکاڵی", motorway: "ڕێگای خێرا", primary: "ڕێگای سەرەکی", secondary: "ڕێگای ناوچەیی", residential: "شەقامی نیشتەجێبوون", service: "ڕێگای خزمەتگوزاری", slippery: "ڕێگای خلیسک", cliff: "هەڵدێر", dangerous: "شوێنی مەترسیدار", steep: "لێژیی توند" },
  ar: { road: "معلومات الطريق", surface: "سطح الطريق", unknown: "غير مسجل", limit: "حد السرعة", low: "حد سرعة منخفض", high: "حد سرعة مرتفع", source: "بيانات الخريطة؛ اتبع إشارات الطريق", asphalt: "أسفلت", paved: "طريق معبد", unpaved: "طريق ترابي", gravel: "حصى", track: "مسار ريفي / زراعي", motorway: "طريق سريع", primary: "طريق رئيسي", secondary: "طريق إقليمي", residential: "شارع سكني", service: "طريق خدمة", slippery: "طريق زلق", cliff: "جرف", dangerous: "منطقة خطرة", steep: "انحدار حاد" },
  en: { road: "Road information", surface: "Surface", unknown: "Not recorded", limit: "Speed limit", low: "Low posted limit", high: "Higher posted limit", source: "Map data; follow road signs", asphalt: "Asphalt", paved: "Paved", unpaved: "Unpaved", gravel: "Gravel", track: "Rural / farm track", motorway: "Motorway", primary: "Main road", secondary: "Regional road", residential: "Residential street", service: "Service road", slippery: "Slippery road", cliff: "Cliff", dangerous: "Dangerous section", steep: "Steep slope" }
};
export function postedSpeed(value: unknown): number | null {
  if (value && typeof value === "object") {
    const item = value as { speed?: number; unit?: string; unknown?: boolean; none?: boolean };
    if (item.unknown || item.none || !["km/h","mph"].includes(item.unit ?? "")) return null;
    return postedSpeed(`${item.speed} ${item.unit}`);
  }
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = String(value).trim().match(/^(\d{1,3})(?:\s*(km\/h|kmh|mph))?$/i);
  if (!match) return null;
  const speed = Number(match[1]) * (match[2]?.toLowerCase() === "mph" ? 1.609344 : 1);
  return speed > 0 && speed <= 200 ? Math.round(speed) : null;
}
/** Unknown surface and hazards are not inferred from class, weather or speed. */
export function roadInformation(p: Record<string, unknown>): RoadInformation {
  const raw = String(p.surface ?? "").toLowerCase().trim();
  const surface = raw === "asphalt" ? "asphalt" : ["paved","concrete","paving_stones","sett"].includes(raw) ? "paved"
    : ["unpaved","dirt","earth","ground","sand","mud"].includes(raw) ? "unpaved" : ["gravel","fine_gravel","compacted"].includes(raw) ? "gravel" : null;
  const tag = String(p.hazard || p.road_hazard || "").toLowerCase(), hazards: string[] = [];
  if (/^(slippery|slippery_road)$/.test(tag)) hazards.push("slippery");
  if (tag === "cliff" || p.natural === "cliff") hazards.push("cliff");
  if (/^(dangerous_road|dangerous)$/.test(tag)) hazards.push("dangerous");
  const slope = String(p.incline ?? "").match(/^(-?\d+(?:\.\d+)?)%$/);
  if (slope && Math.abs(Number(slope[1])) >= 12) hazards.push("steep");
  const rawClass = String(p.fclass || p.highway || p.class || "").trim().toLowerCase();
  const roadClass = /^track/.test(rawClass) ? "track" : /^(motorway|trunk)/.test(rawClass) ? "motorway"
    : /^primary/.test(rawClass) ? "primary" : /^(secondary|tertiary)/.test(rawClass) ? "secondary"
      : ["residential","living_street"].includes(rawClass) ? "residential" : rawClass === "service" ? "service" : "road";
  return { name: typeof p.name === "string" ? p.name.slice(0,160) : "", roadClass, surface, speedKmh: postedSpeed(p.maxspeed), hazards };
}
export function roadInformationLabel(info: RoadInformation, language: Language): string {
  const c = ROAD_COPY[language] as Record<string,string>;
  const limitLabel = info.speedKmh !== null && info.speedKmh <= 40 ? c.low : info.speedKmh !== null && info.speedKmh >= 90 ? c.high : c.limit;
  return [...info.hazards.map(key => c[key]), c[info.surface ?? info.roadClass], info.speedKmh !== null ? `${limitLabel} ${info.speedKmh} km/h` : ""].filter(Boolean).join(" · ");
}
export function nearestRoadInformation(features: readonly { geometry: GeoJSON.Geometry; properties: Record<string,unknown> | null }[], point: LngLatTuple, heading: number | null = null): RoadInformation | null {
  const candidates: Array<{ distance: number; key: string; info: RoadInformation }> = [];
  for (const f of features) for (const line of f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : []) {
    const projection = measureRouteProgress(point,line as LngLatTuple[]);
    if (!projection || projection.offRouteMeters > 12) continue;
    const bearing = bearingBetween(line[projection.segmentIndex] as LngLatTuple,line[projection.segmentIndex+1] as LngLatTuple);
    if (heading !== null && bearing !== null) { const angle = Math.abs(shortestHeadingDelta(heading,bearing)); if (Math.min(angle,180-angle) > 30) continue; }
    const p = f.properties ?? {};
    candidates.push({ distance: projection.offRouteMeters, key: String(p.id ?? JSON.stringify(line)), info: roadInformation(p) });
  }
  candidates.sort((a,b) => a.distance-b.distance);
  const best = candidates[0], other = candidates.find(c => c.key !== best?.key);
  // Omit ambiguous limits at junctions or parallel lanes.
  return !best || (other && other.distance-best.distance < 4) ? null : best.info;
}
