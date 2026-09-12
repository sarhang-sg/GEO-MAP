import type { Language } from "./types";
import type { StaticSearchItem } from "./static-search";
import { POI_NAME_PROPERTY_KEYS } from "./poi-source";
import { ATLAS_TAXONOMY, atlasPlaceTypeLabel } from "./atlas-taxonomy";

const ARABIC_SCRIPT_RE = /[\u0600-\u06ff]/u;
const LATIN_RE = /[A-Za-z]/u;
const ARABIC_DIACRITICS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu;

const CATEGORY_COPY: Record<string, Record<Language, string>> = {
  place: { ku: "شوێن", ar: "مكان", en: "Place" },
  street: { ku: "شەقام", ar: "شارع", en: "Street" },
  road: { ku: "ڕێگا", ar: "طريق", en: "Road" },
  city: { ku: "شار", ar: "مدينة", en: "City" },
  town: { ku: "شارۆچکە", ar: "بلدة", en: "Town" },
  village: { ku: "گوند", ar: "قرية", en: "Village" },
  hamlet: { ku: "گوندۆکە", ar: "تجمع صغير", en: "Hamlet" },
  locality: { ku: "شوێن", ar: "موقع", en: "Locality" },
  suburb: { ku: "گەڕەک", ar: "حي", en: "Suburb" },
  neighbourhood: { ku: "گەڕەک", ar: "حي", en: "Neighbourhood" },
  neighborhood: { ku: "گەڕەک", ar: "حي", en: "Neighborhood" },
  building: { ku: "بیناسازی", ar: "مبنى", en: "Building" },
  restaurant: { ku: "خواردنگە", ar: "مطعم", en: "Restaurant" },
  cafe: { ku: "کافێ", ar: "مقهى", en: "Cafe" },
  fast_food: { ku: "خواردنی خێرا", ar: "وجبات سريعة", en: "Fast food" },
  school: { ku: "قوتابخانە", ar: "مدرسة", en: "School" },
  university: { ku: "زانکۆ", ar: "جامعة", en: "University" },
  hospital: { ku: "نەخۆشخانە", ar: "مستشفى", en: "Hospital" },
  clinic: { ku: "کلینیک", ar: "عيادة", en: "Clinic" },
  pharmacy: { ku: "دەرمانخانە", ar: "صيدلية", en: "Pharmacy" },
  bank: { ku: "بانک", ar: "مصرف", en: "Bank" },
  bus: { ku: "وێستگەی پاس", ar: "محطة حافلات", en: "Bus station" },
  bus_station: { ku: "وێستگەی پاس", ar: "محطة حافلات", en: "Bus station" },
  civic: { ku: "خزمەتگوزاری گشتی", ar: "خدمات عامة", en: "Public service" },
  government: { ku: "دامەزراوەی حکومی", ar: "جهة حكومية", en: "Government" },
  police: { ku: "پۆلیس و فریاکەوتن", ar: "شرطة وطوارئ", en: "Police and emergency" },
  airport: { ku: "فڕۆکەخانە", ar: "مطار", en: "Airport" },
  atm: { ku: "خۆپارێز", ar: "صراف آلي", en: "ATM" },
  fuel: { ku: "وێستگەی سووتەمەنی", ar: "محطة وقود", en: "Fuel station" },
  shop: { ku: "فرۆشگا", ar: "متجر", en: "Shop" },
  supermarket: { ku: "مارکێت", ar: "سوق مركزي", en: "Supermarket" },
  market: { ku: "بازاڕ", ar: "سوق", en: "Market" },
  mall: { ku: "مەوڵ", ar: "مركز تجاري", en: "Mall" },
  mosque: { ku: "مزگەوت", ar: "مسجد", en: "Mosque" },
  church: { ku: "کڵێسا", ar: "كنيسة", en: "Church" },
  religious: { ku: "شوێنی ئایینی", ar: "مكان ديني", en: "Religious site" },
  park: { ku: "پارک", ar: "متنزه", en: "Park" },
  garden: { ku: "باخچە", ar: "حديقة", en: "Garden" },
  hotel: { ku: "هۆتێل", ar: "فندق", en: "Hotel" },
  tourism: { ku: "گەشتیاری", ar: "سياحي", en: "Tourism" },
  museum: { ku: "مۆزەخانە", ar: "متحف", en: "Museum" },
  cultural: { ku: "کولتووری", ar: "ثقافي", en: "Cultural" },
  historic: { ku: "مێژوویی", ar: "تاريخي", en: "Historic" },
  nature: { ku: "سروشتی", ar: "طبيعة", en: "Nature" },
  mountain: { ku: "چیا", ar: "جبل", en: "Mountain" },
  valley: { ku: "دۆڵ", ar: "وادٍ", en: "Valley" },
  river: { ku: "ڕووبار", ar: "نهر", en: "River" },
  waterfall: { ku: "ئاوشار", ar: "شلال", en: "Waterfall" },
  other: { ku: "شوێنی گرنگ", ar: "نقطة اهتمام", en: "Point of interest" },
  poi: { ku: "شوێنی گرنگ", ar: "نقطة اهتمام", en: "Point of interest" }
};

const LATIN_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

const ARABIC_TO_KURDISH: Record<string, string> = {
  "ك": "ک", "ي": "ی", "ى": "ی", "ئ": "ئ", "ؤ": "ۆ", "ة": "ە", "ۀ": "ە", "ھ": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا"
};

const KURDISH_TO_ARABIC: Record<string, string> = {
  "ک": "ك", "گ": "ك", "ی": "ي", "ێ": "ي", "ە": "ة", "ھ": "ه", "ڵ": "ل", "ڕ": "ر", "ۆ": "و", "وو": "و", "پ": "ب", "چ": "ج", "ژ": "ز", "ڤ": "ف"
};

const ARABIC_LATIN_MAP: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ٱ": "a", "ب": "b", "پ": "p", "ت": "t", "ث": "th", "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ڕ": "rr", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ڤ": "v", "ق": "q", "ک": "k", "ك": "k", "گ": "g", "ل": "l", "ڵ": "ll", "م": "m", "ن": "n", "ه": "h", "ھ": "h", "ە": "a", "ة": "a", "و": "w", "ۆ": "o", "ۇ": "u", "ی": "i", "ي": "i", "ێ": "e", "ى": "a", "ئ": "", "ء": "", "ؤ": "o", "ئـ": "", "َ": "", "ُ": "", "ِ": "", "ّ": "", "ْ": "", "ً": "", "ٌ": "", "ٍ": ""
};

const KURDISH_PLACE_PREFIX_SUPPLEMENTS: readonly (readonly [string, string])[] = [
  ["جامع", "مزگەوت"],
  ["مستوصف", "بنکەی تەندروستی"],
  ["بنك", "بانک"],
  ["مركز", "ناوەند"],
  ["محطة", "وێستگە"],
  ["عين", "کانی"],
  ["بئر", "بیر"],
  ["وادي", "دۆڵ"],
  ["دائرة", "فەرمانگە"],
  ["شركة", "کۆمپانیا"],
  ["مكتب", "نوسینگە"],
  ["مصنع", "کارگە"],
  ["قصر", "کۆشک"],
  ["برج", "بورج"],
  ["بحيرة", "دەریاچە"],
  ["بستان", "باخ"],
  ["روضة", "باخچەی منداڵان"],
];

const KURDISH_PLACE_DESCRIPTOR_TERMS: readonly (readonly [string, string])[] = [
  ["أثري", "شوێنەواری"], ["أثرية", "شوێنەواری"], ["الأثري", "شوێنەواری"], ["الأثرية", "شوێنەواری"],
  ["عسكري", "سەربازی"], ["عسكرية", "سەربازی"], ["العسكري", "سەربازی"], ["العسكرية", "سەربازی"],
  ["دولي", "نێودەوڵەتی"], ["دولية", "نێودەوڵەتی"], ["الدولي", "نێودەوڵەتی"], ["الدولية", "نێودەوڵەتی"],
  ["حكومي", "حکومی"], ["حكومية", "حکومی"], ["الحكومي", "حکومی"], ["الحكومية", "حکومی"],
  ["وطني", "نیشتیمانی"], ["وطنية", "نیشتیمانی"], ["الوطني", "نیشتیمانی"], ["الوطنية", "نیشتیمانی"],
  ["عام", "گشتی"], ["عامة", "گشتی"], ["العام", "گشتی"], ["العامة", "گشتی"],
  ["كبير", "گەورە"], ["كبيرة", "گەورە"], ["الكبير", "گەورە"], ["الكبرى", "گەورە"], ["الأكبر", "گەورە"],
  ["صغير", "بچووک"], ["صغيرة", "بچووک"], ["الصغير", "بچووک"], ["الصغرى", "بچووک"],
  ["جديد", "نوێ"], ["جديدة", "نوێ"], ["الجديد", "نوێ"], ["الجديدة", "نوێ"],
  ["قديم", "کۆن"], ["قديمة", "کۆن"], ["القديم", "کۆن"], ["القديمة", "کۆن"],
  ["شمالي", "باکووری"], ["الشمالي", "باکووری"], ["جنوبی", "باشووری"], ["الجنوبي", "باشووری"],
  ["شرقي", "ڕۆژهەڵاتی"], ["الشرقي", "ڕۆژهەڵاتی"], ["غربي", "ڕۆژئاوایی"], ["الغربي", "ڕۆژئاوایی"],
  ["رقم", "ژمارە"],
];

let kurdishPlacePrefixes: readonly (readonly [string, string])[] | null = null;
let kurdishDescriptorTerms: ReadonlyMap<string, string> | null = null;
const KURDISH_PLACE_NAME_CACHE = new Map<string, string>();
const KURDISH_PLACE_NAME_CACHE_LIMIT = 4096;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}


const GENERIC_PUBLIC_NAMES = new Set([
  "place", "places", "other", "unknown", "unnamed", "no name", "noname", "n/a", "na", "null", "-", "—", "...",
  "شوێن", "شوێنەکان", "هی تر", "نەزانراو", "ناونەنراو", "بێ ناو", "داناگیرێ", "داناگیراو",
  "مكان", "أماكن", "أخرى", "غير معروف", "بلا اسم", "بدون اسم", "مجهول", "موقع"
]);

function isPublicName(value: unknown): boolean {
  const text = clean(value).replace(/[\u200e\u200f]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const lower = text.toLocaleLowerCase("en-US");
  if (GENERIC_PUBLIC_NAMES.has(text) || GENERIC_PUBLIC_NAMES.has(lower)) return false;
  if (/^[.\-–—_\s]+$/u.test(text)) return false;
  if (/^[\d\s\-_/.,()]+$/u.test(text)) return false;
  return /[A-Za-z\u0600-\u06ff]/u.test(text) && text.replace(/[^A-Za-z\u0600-\u06ff0-9]+/gu, "").length >= 2;
}

function replaceChars(value: string, table: Record<string, string>): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const two = value.slice(index, index + 2);
    if (table[two]) { out += table[two]; index += 1; continue; }
    const ch = value[index];
    out += table[ch] ?? LATIN_DIGITS[ch] ?? ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

function normalizeKurdishOrthography(value: unknown): string {
  return replaceChars(clean(value).normalize("NFKC"), ARABIC_TO_KURDISH)
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(/ـ/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function placePrefixEntries(): readonly (readonly [string, string])[] {
  if (kurdishPlacePrefixes) return kurdishPlacePrefixes;
  const entries = new Map<string, string>();
  const add = (source: unknown, target: unknown): void => {
    const normalizedSource = normalizeKurdishOrthography(source);
    const normalizedTarget = normalizeKurdishOrthography(target);
    if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) return;
    if (!entries.has(normalizedSource)) entries.set(normalizedSource, normalizedTarget);
    if (!normalizedSource.startsWith("ال")) {
      const definite = `ال${normalizedSource}`;
      if (!entries.has(definite)) entries.set(definite, normalizedTarget);
    }
  };
  Object.values(CATEGORY_COPY).forEach((copy) => add(copy.ar, copy.ku));
  ATLAS_TAXONOMY.forEach((entry) => add(entry.label.ar, entry.label.ku));
  KURDISH_PLACE_PREFIX_SUPPLEMENTS.forEach(([source, target]) => add(source, target));
  kurdishPlacePrefixes = [...entries.entries()].sort((a, b) => b[0].length - a[0].length);
  return kurdishPlacePrefixes;
}

function descriptorEntries(): ReadonlyMap<string, string> {
  if (kurdishDescriptorTerms) return kurdishDescriptorTerms;
  kurdishDescriptorTerms = new Map(KURDISH_PLACE_DESCRIPTOR_TERMS.map(([source, target]) => [
    normalizeKurdishOrthography(source),
    normalizeKurdishOrthography(target),
  ]));
  return kurdishDescriptorTerms;
}

function localizeKurdishPlaceName(value: unknown): string {
  const source = clean(value);
  if (!source) return "";
  const cached = KURDISH_PLACE_NAME_CACHE.get(source);
  if (cached !== undefined) return cached;
  let localized = normalizeKurdishOrthography(source);
  for (const [prefix, replacement] of placePrefixEntries()) {
    if (localized === prefix) {
      localized = replacement;
      break;
    }
    if (localized.startsWith(prefix) && /^[\s\-–—/|(),،؛:]/u.test(localized.slice(prefix.length, prefix.length + 1))) {
      localized = `${replacement}${localized.slice(prefix.length)}`;
      break;
    }
  }
  const descriptors = descriptorEntries();
  localized = localized
    .split(/([\s\-–—/|(),،؛:]+)/u)
    .map((token) => descriptors.get(token) ?? token)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (KURDISH_PLACE_NAME_CACHE.size >= KURDISH_PLACE_NAME_CACHE_LIMIT) {
    const oldest = KURDISH_PLACE_NAME_CACHE.keys().next().value as string | undefined;
    if (oldest) KURDISH_PLACE_NAME_CACHE.delete(oldest);
  }
  KURDISH_PLACE_NAME_CACHE.set(source, localized);
  return localized;
}

function titleCaseLatin(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s\-\/])([a-z])/g, (_match, sep: string, ch: string) => `${sep}${ch.toLocaleUpperCase("en-US")}`)
    .replace(/\b(Idp|Gps|Api|En|Qa)\b/g, (m) => m.toUpperCase())
    .trim();
}

export function hasArabicScript(value: string): boolean {
  return ARABIC_SCRIPT_RE.test(value);
}

export function hasLatinScript(value: string): boolean {
  return LATIN_RE.test(value);
}

export function toKurdishScript(value: unknown): string {
  return localizeKurdishPlaceName(value);
}

export function toArabicScript(value: unknown): string {
  const text = clean(value);
  if (!text) return "";
  return replaceChars(text, KURDISH_TO_ARABIC);
}

export function toLatinLabel(value: unknown): string {
  const text = clean(value);
  if (!text) return "";
  if (!hasArabicScript(text)) return titleCaseLatin(text.replace(/[_]+/g, " "));
  const latin = replaceChars(text, ARABIC_LATIN_MAP)
    .replace(/[^A-Za-z0-9\s\-\/'.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return titleCaseLatin(latin || text);
}

export function localizeNameValue(primary: unknown, language: Language, _fallbacks: readonly unknown[] = []): string {
  const exact = clean(primary);
  if (!exact) return "";
  if (language === "en") return hasLatinScript(exact) && !hasArabicScript(exact) ? exact : "";
  if (!hasArabicScript(exact) || hasLatinScript(exact)) return "";
  // The selected Kurdish field remains the sole source of the proper name. Its
  // Arabic-script orthography and leading place-type terms are normalized here
  // through the canonical taxonomy so Arabic UI terms never leak into ku mode.
  return language === "ku" ? toKurdishScript(exact) : exact;
}

export function localizedCategory(value: unknown, language: Language, fallback: string): string {
  const key = clean(value).toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_");
  const taxonomyLabel = atlasPlaceTypeLabel(key, language);
  if (taxonomyLabel) return taxonomyLabel;
  if (key && CATEGORY_COPY[key]?.[language]) return CATEGORY_COPY[key][language];
  const raw = clean(value).replace(/[_-]+/g, " ");
  if (!raw) return fallback;
  if (language === "en") return toLatinLabel(raw);
  if (language === "ar") return toArabicScript(raw);
  return toKurdishScript(raw);
}

export function localizedStaticName(item: StaticSearchItem, language: Language): string {
  const exact = language === "ku" ? item.n_ku : language === "ar" ? item.n_ar : item.n_en;
  return localizeNameValue(exact, language);
}

export function localizedStaticCategory(item: StaticSearchItem, language: Language, fallback: string): string {
  const exact = language === "ku" ? item.c_ku : language === "ar" ? item.c_ar : item.c_en;
  return clean(exact) || localizedCategory(item.c || item.k, language, fallback);
}

export function localizedRecordName(properties: Record<string, unknown>, language: Language, candidates: readonly string[]): string {
  const exactKeys = language === "ku"
    ? ["name_ku", "name:ku", "name:ckb"]
    : language === "ar"
      ? ["name_ar", "name:ar"]
      : ["name_en", "name:en", "int_name"];
  const exact = exactKeys.map((key) => properties[key]).find((value) => clean(value));
  // The candidates parameter is retained for API compatibility, but visible
  // names are resolved only from the exact selected-language properties.
  void candidates;
  const localized = localizeNameValue(exact, language);
  return isPublicName(localized) ? localized : "";
}

/** Resolve every name property accepted by the visible POI filter. */
export function localizedPoiName(properties: Record<string, unknown>, language: Language): string {
  return localizedRecordName(properties, language, POI_NAME_PROPERTY_KEYS);
}

export function localizedOptionalBody(exact: unknown, language: Language, _fallbacks: readonly unknown[] = []): string {
  return localizeNameValue(exact, language);
}
