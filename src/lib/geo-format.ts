import type { AtlasPhoto, AtlasPlace } from "./atlas-places";
import type { LngLatTuple } from "./location";
import { localizeNameValue, localizedCategory, localizedOptionalBody } from "./map-language";
import type { Language, LocalityProperties, PointKind } from "./types";

export function escapeText(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character] ?? character);
}

export function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ە").replace(/\s+/g, " ").trim();
}


const GENERIC_PUBLIC_NAMES = new Set([
  "place", "places", "other", "unknown", "unnamed", "no name", "noname", "n/a", "na", "null", "-", "—", "...",
  "شوێن", "شوێنەکان", "هی تر", "نەزانراو", "ناونەنراو", "بێ ناو", "داناگیرێ", "داناگیراو",
  "مكان", "أماكن", "أخرى", "غير معروف", "بلا اسم", "بدون اسم", "مجهول", "موقع"
]);

const PUBLIC_NAME_LETTER_RE = /[A-Za-z\u0600-\u06ff]/u;
const PUBLIC_NUMERIC_ONLY_RE = /^[\d\s\-_/.,()]+$/u;

export function isMeaningfulMapName(value: unknown, options: { allowStreetCode?: boolean } = {}): boolean {
  const text = typeof value === "string" ? value.replace(/[\u200e\u200f]/g, "").replace(/\s+/g, " ").trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  if (!text) return false;
  const lower = text.toLocaleLowerCase("en-US");
  if (GENERIC_PUBLIC_NAMES.has(text) || GENERIC_PUBLIC_NAMES.has(lower)) return false;
  if (/^[.\-–—_\s]+$/u.test(text)) return false;
  if (PUBLIC_NUMERIC_ONLY_RE.test(text)) return Boolean(options.allowStreetCode && /\d+\s*[-/]\s*\d+/.test(text));
  const compact = text.replace(/[^A-Za-z\u0600-\u06ff0-9]+/gu, "");
  return PUBLIC_NAME_LETTER_RE.test(text) && compact.length >= 2;
}

export function labelKey(value: string): string {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function pointKind(place: string | undefined): PointKind {
  return place === "city" ? "city" : place === "town" ? "town" : "settlement";
}

export function placeRank(place: string | undefined): number {
  return place === "city" ? 100 : place === "town" ? 80 : place === "village" ? 55 : place === "locality" ? 45 : 20;
}

export function languageValue(properties: LocalityProperties, language: Language): string {
  const exact = properties[`name_${language}`] as string | undefined;
  return localizeNameValue(exact, language) || "—";
}

export function districtValue(properties: LocalityProperties, language: Language): string {
  return localizeNameValue(properties[`admin_district_${language}`], language);
}

export function governorateValue(properties: LocalityProperties, language: Language): string {
  return localizeNameValue(properties[`admin_governorate_${language}`], language);
}

export function ownerName(place: AtlasPlace, language: Language): string {
  const exact = language === "ku" ? place.name_ku : language === "ar" ? place.name_ar : place.name_en;
  return localizeNameValue(exact, language) || "—";
}

export function ownerDescription(place: AtlasPlace, language: Language): string {
  const exact = language === "ku" ? place.description_ku : language === "ar" ? place.description_ar : place.description_en;
  return localizedOptionalBody(exact, language);
}

export function ownerPhotoCaption(photo: AtlasPhoto | null | undefined, language: Language): string {
  if (!photo) return "";
  const exact = language === "ku" ? photo.caption_ku : language === "ar" ? photo.caption_ar : photo.caption_en;
  return localizedOptionalBody(exact, language);
}

export function stringProperty(properties: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}


export function categoryValue(value: unknown, language: Language, fallback: string): string {
  return localizedCategory(value, language, fallback);
}

export function coordinateLabel(coordinate: LngLatTuple): string {
  return `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`;
}
