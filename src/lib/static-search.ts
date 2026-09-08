import { fetchPersistentJson } from "./persistent-json-cache";
import { dataAssetUrl } from "./release";
import { ATLAS_TAXONOMY } from "./atlas-taxonomy";

export type StaticSearchItem = {
  n: string;
  q: string;
  k: string;
  c: string;
  x: number;
  y: number;
  s: string;
  n_ku?: string;
  n_ar?: string;
  n_en?: string;
  q_ku?: string;
  q_ar?: string;
  q_en?: string;
  c_ku?: string;
  c_ar?: string;
  c_en?: string;
};

export type StaticSearchShard = { file: string; records: number; bytes?: number; sha256?: string };
export type StaticSearchManifest = {
  version: string;
  file?: string;
  records?: number;
  source?: string;
  attribution?: string;
  coverage?: string;
  fallback?: string;
  files?: Partial<Record<"ku" | "ar" | "en", StaticSearchShard>>;
};

export type PreparedStaticSearchQuery = {
  phrase: string;
  tokens: string[];
  intentIds: string[];
};

export type StaticSearchTextProfile = {
  primary: string;
  all: string;
  primaryName: string;
  allNames: string;
  intent?: string;
};

type SearchIntentGroup = {
  id: string;
  aliases: readonly string[];
  categoryHints: readonly string[];
};

let manifestPromise: Promise<StaticSearchManifest> | null = null;

const SEARCH_DIACRITICS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
const SEARCH_INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
const SEARCH_SEPARATOR_RE = /[^\p{L}\p{N}]+/gu;
const SEARCH_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
};

const SEARCH_STOPWORDS = new Set([
  "لە", "له", "بۆ", "بو", "و", "ی", "یا", "شوێن", "شوێنی", "نزیک", "نزیکترین", "بدۆزەوە", "بدۆزە", "بگەڕێ", "گەڕان", "تکایە",
  "في", "الى", "إلى", "عن", "على", "قرب", "قريب", "اقرب", "أقرب", "مكان", "موقع", "ابحث", "بحث", "اريد", "أريد",
  "in", "at", "to", "for", "of", "the", "near", "nearest", "find", "search", "show", "me", "please", "where", "is"
]);

const CORE_SEARCH_INTENT_GROUPS: readonly SearchIntentGroup[] = [
  {
    id: "atm",
    aliases: ["atm", "a t m", "cash machine", "cashpoint", "cash point", "bankomat", "بانکومات", "بانكومات", "صراف الي", "صراف آلي", "مكينة صراف", "مکینەی پارە", "ئەتەم", "ئێ تی ئێم"],
    categoryHints: ["atm", "cash machine", "cashpoint", "bankomat", "بانکومات", "بانكومات", "صراف الي", "صراف آلي", "ئێ تی ئێم", "ئەتەم"]
  },
  {
    id: "fastpay",
    aliases: ["fastpay", "fast pay", "فاستپەی", "فاست پەی", "فاستپي", "فاست بي", "فاست باي"],
    categoryHints: ["fastpay", "fast pay", "فاستپەی", "فاست پەی", "فاست باي"]
  },
  {
    id: "bank",
    aliases: ["bank", "banks", "بانک", "بانکەکان", "بانك", "مصرف", "المصرف", "bank branch", "لقی بانک", "فرع مصرف"],
    categoryHints: ["bank", "bank branch", "بانک", "بانك", "مصرف"]
  },
  {
    id: "pharmacy",
    aliases: ["pharmacy", "drugstore", "دەرمانخانە", "دەرمان خانه", "صيدلية", "صيدليه"],
    categoryHints: ["pharmacy", "drugstore", "دەرمانخانە", "صيدلية", "صيدليه"]
  },
  {
    id: "hospital",
    aliases: ["hospital", "clinic", "medical center", "نەخۆشخانە", "نەخۆش خانه", "کلینیک", "مستشفى", "مستوصف", "عيادة", "مركز صحي"],
    categoryHints: ["hospital", "clinic", "medical", "نەخۆشخانە", "کلینیک", "مستشفى", "عيادة", "مركز صحي"]
  },
  {
    id: "fuel",
    aliases: ["fuel", "petrol", "gas station", "fuel station", "وێزگەی بەنزین", "پمپەی بەنزین", "محطة وقود", "بنزين"],
    categoryHints: ["fuel", "petrol", "gas station", "وێزگەی بەنزین", "محطة وقود", "بنزين"]
  },
  {
    id: "restaurant",
    aliases: ["restaurant", "food", "خواردنگە", "مطعم", "مطاعم"],
    categoryHints: ["restaurant", "خواردنگە", "مطعم"]
  },
  {
    id: "cafe",
    aliases: ["cafe", "coffee", "coffee shop", "کافێ", "قهوه خانه", "مقهى", "كافيه"],
    categoryHints: ["cafe", "coffee", "کافێ", "مقهى", "كافيه"]
  },
  {
    id: "hotel",
    aliases: ["hotel", "motel", "guest house", "هوتێل", "میوانخانە", "فندق", "نزل"],
    categoryHints: ["hotel", "motel", "هوتێل", "میوانخانە", "فندق", "نزل"]
  },
  {
    id: "airport",
    aliases: ["airport", "airfield", "heliport", "فرۆکەخانە", "هێلیپۆرت", "مطار", "مهبط طائرات"],
    categoryHints: ["airport", "airfield", "heliport", "فرۆکەخانە", "مطار", "مهبط طائرات"]
  },
  {
    id: "school",
    aliases: ["school", "primary school", "high school", "قوتابخانە", "مدرسة", "مدرسه"],
    categoryHints: ["school", "قوتابخانە", "مدرسة", "مدرسه"]
  },
  {
    id: "university",
    aliases: ["university", "college", "institute", "زانکۆ", "کۆلێژ", "پەیمانگا", "جامعة", "كلية", "معهد"],
    categoryHints: ["university", "college", "institute", "زانکۆ", "کۆلێژ", "پەیمانگا", "جامعة", "كلية", "معهد"]
  },
  {
    id: "mall",
    aliases: ["mall", "shopping center", "shopping centre", "بازاڕ", "مۆڵ", "مول", "سوق", "مجمع تجاري"],
    categoryHints: ["mall", "shopping", "بازاڕ", "مۆڵ", "مول", "سوق", "مجمع تجاري"]
  },
  {
    id: "carshowroom",
    aliases: ["car showroom", "auto showroom", "car dealer", "پێشانگای ئۆتۆمبێل", "پێشانگای سەیارە", "معرض سيارات", "وكالة سيارات"],
    categoryHints: ["car showroom", "auto showroom", "car dealer", "پێشانگای ئۆتۆمبێل", "معرض سيارات", "وكالة سيارات"]
  },
  {
    id: "pool",
    aliases: ["swimming pool", "pool", "مەلەوانگە", "مسبح", "حوض سباحة"],
    categoryHints: ["swimming pool", "pool", "مەلەوانگە", "مسبح", "حوض سباحة"]
  },
  {
    id: "checkpoint",
    aliases: ["checkpoint", "check point", "security checkpoint", "بازگە", "خاڵی پشکنین", "نقطة تفتيش", "سيطرة"],
    categoryHints: ["checkpoint", "security checkpoint", "بازگە", "خاڵی پشکنین", "نقطة تفتيش", "سيطرة"]
  },
  {
    id: "telecom",
    aliases: ["korek", "asiacell", "zain", "telecom", "mobile tower", "cell tower", "بورجی مۆبایل", "برج اتصالات", "شركة اتصالات"],
    categoryHints: ["korek", "asiacell", "zain", "telecom", "mobile tower", "cell tower", "بورجی مۆبایل", "برج اتصالات", "شركة اتصالات"]
  }
];

const CORE_SEARCH_INTENT_IDS = new Set(CORE_SEARCH_INTENT_GROUPS.map((group) => group.id));
const TAXONOMY_SEARCH_INTENT_GROUPS: readonly SearchIntentGroup[] = ATLAS_TAXONOMY
  .filter((entry) => !CORE_SEARCH_INTENT_IDS.has(entry.id))
  .map((entry) => ({
    id: entry.id,
    aliases: [...new Set([entry.id.replace(/_/g, " "), entry.label.ku, entry.label.ar, entry.label.en, ...entry.aliases])],
    categoryHints: [...new Set([entry.id.replace(/_/g, " "), entry.label.ku, entry.label.ar, entry.label.en, ...entry.aliases])]
  }));
const SEARCH_INTENT_GROUPS: readonly SearchIntentGroup[] = [...CORE_SEARCH_INTENT_GROUPS, ...TAXONOMY_SEARCH_INTENT_GROUPS];

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => SEARCH_DIGITS[digit] ?? digit);
}

export function normalizeStaticSearch(value: string): string {
  return normalizeDigits(value)
    .toLocaleLowerCase("en-US")
    .normalize("NFKC")
    .replace(SEARCH_INVISIBLE_RE, "")
    .replace(SEARCH_DIACRITICS_RE, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ە")
    .replace(/ھ/g, "ه")
    .replace(SEARCH_SEPARATOR_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_INTENT_GROUPS = SEARCH_INTENT_GROUPS.map((group) => ({
  ...group,
  aliases: group.aliases.map(normalizeStaticSearch),
  categoryHints: group.categoryHints.map(normalizeStaticSearch)
}));
const NORMALIZED_CORE_INTENT_GROUPS = CORE_SEARCH_INTENT_GROUPS.map((group) => ({
  ...group,
  aliases: group.aliases.map(normalizeStaticSearch),
  categoryHints: group.categoryHints.map(normalizeStaticSearch)
}));
const TAXONOMY_INTENT_IDS = new Set<string>(ATLAS_TAXONOMY.map((entry) => entry.id));

function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function containsWordSequence(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  return (` ${text} `).includes(` ${phrase} `);
}

function intentGroupsForQuery(phrase: string): Array<(typeof NORMALIZED_INTENT_GROUPS)[number]> {
  const exact = NORMALIZED_INTENT_GROUPS.filter((group) => group.aliases.some((alias) => containsWordSequence(phrase, alias)));
  if (exact.length > 0) return exact;

  // A single Latin category word may contain one keyboard typo (for example
  // “banl” for “bank”). Resolve that typo only against the small, curated core
  // intent catalog so ordinary place-name searches are never over-filtered.
  const queryWords = words(phrase);
  if (queryWords.length !== 1 || !/^[a-z]{4,}$/u.test(queryWords[0])) return [];
  const token = queryWords[0];
  return NORMALIZED_CORE_INTENT_GROUPS.filter((group) =>
    group.aliases.some((alias) => /^[a-z]{4,}$/u.test(alias) && !alias.includes(" ") && limitedEditDistance(alias, token, 1) <= 1)
  );
}

export function searchIntentIdsForCategory(category: string, supportingText = ""): string[] {
  const canonical = category.trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_");
  const normalized = normalizeStaticSearch([category.replace(/_/g, " "), supportingText].filter(Boolean).join(" | "));
  const ids: string[] = [];
  if (TAXONOMY_INTENT_IDS.has(canonical)) ids.push(canonical);
  for (const group of NORMALIZED_CORE_INTENT_GROUPS) {
    if (group.categoryHints.some((hint) => containsWordSequence(normalized, hint))) ids.push(group.id);
  }
  return [...new Set(ids)];
}

export function prepareStaticSearchQuery(query: string): PreparedStaticSearchQuery {
  const normalized = normalizeStaticSearch(query);
  const matchedIntentGroups = intentGroupsForQuery(normalized);
  const consumedTokens = new Set(matchedIntentGroups.flatMap((group) => group.aliases.flatMap(words)));
  const normalizedWords = words(normalized);
  const fuzzySingleIntent = normalizedWords.length === 1 && matchedIntentGroups.length > 0 &&
    matchedIntentGroups.some((group) => group.aliases.some((alias) =>
      !alias.includes(" ") && /^[a-z]{4,}$/u.test(alias) && limitedEditDistance(alias, normalizedWords[0], 1) <= 1
    ));
  const meaningfulTokens = normalizedWords.filter((token) =>
    !SEARCH_STOPWORDS.has(token) && !consumedTokens.has(token) && !(fuzzySingleIntent && token === normalizedWords[0])
  );
  const intentIds = [...new Set(matchedIntentGroups.map((group) => group.id))];
  const tokens = [...new Set([...meaningfulTokens, ...intentIds])];
  return {
    phrase: meaningfulTokens.length > 0 ? meaningfulTokens.join(" ") : intentIds.join(" ") || normalized,
    tokens,
    intentIds
  };
}

function isShortAsciiToken(value: string): boolean {
  return value.length <= 3 && /^[a-z0-9]+$/u.test(value);
}

function phraseMatch(text: string, phrase: string): "exact" | "prefix" | "contains" | null {
  if (!text || !phrase) return null;
  if (text === phrase) return "exact";
  if (isShortAsciiToken(phrase)) {
    const textWords = words(text);
    if (textWords.some((word) => word === phrase)) return "exact";
    return null;
  }
  if (text.startsWith(`${phrase} `) || text.startsWith(phrase)) return "prefix";
  if (containsWordSequence(text, phrase) || text.includes(phrase)) return "contains";
  return null;
}

function limitedEditDistance(a: string, b: string, maximum: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[b.length];
}

function tokenQuality(text: string, token: string): number {
  const textWords = words(text);
  if (!textWords.length || !token) return 0;
  if (textWords.includes(token)) return 5;

  const shortAscii = isShortAsciiToken(token);
  if (!shortAscii && textWords.some((word) => word.startsWith(token))) return 4;
  if (token.length >= 4 && textWords.some((word) => token.startsWith(word) && word.length >= 3)) return 3;
  if (token.length >= 4 && textWords.some((word) => word.includes(token))) return 2;

  const maximum = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;
  if (maximum > 0 && textWords.some((word) => word.length >= 4 && limitedEditDistance(word, token, maximum) <= maximum)) return 2;
  return 0;
}

function tokenCoverageScore(text: string, tokens: readonly string[]): number {
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    const quality = tokenQuality(text, token);
    if (quality === 0) return 0;
    score += quality * 120;
  }
  return score;
}

function kindWeight(kind: string): number {
  return kind === "place" ? 90 : kind === "street" ? 80 : kind === "poi" ? 60 : kind === "building" ? 45 : 25;
}

export function scoreStaticSearchNames(primaryName: string, allNames: string, query: PreparedStaticSearchQuery): number {
  const { phrase } = query;
  if (phrase.length < 2) return 0;

  let score = 0;
  const primaryMatch = phraseMatch(primaryName, phrase);
  const allMatch = phraseMatch(allNames, phrase);
  if (primaryMatch === "exact") score += 6_000;
  else if (primaryMatch === "prefix") score += 3_000;
  else if (primaryMatch === "contains") score += 1_350;

  if (allMatch === "exact") score += 5_400;
  else if (allMatch === "prefix") score += 2_350;
  else if (allMatch === "contains") score += 1_050;
  return score;
}

export function scoreStaticSearchProfile(profile: StaticSearchTextProfile, query: PreparedStaticSearchQuery, kind: string): number {
  const { phrase, tokens, intentIds } = query;
  if (phrase.length < 2 && tokens.length === 0) return 0;

  let score = scoreStaticSearchNames(profile.primaryName, profile.allNames, query);
  const primaryMatch = phraseMatch(profile.primary, phrase);
  const allMatch = phraseMatch(profile.all, phrase);
  if (primaryMatch === "exact") score += 2_300;
  else if (primaryMatch === "prefix") score += 1_850;
  else if (primaryMatch === "contains") score += 720;

  if (allMatch === "exact") score += 1_700;
  else if (allMatch === "prefix") score += 1_350;
  else if (allMatch === "contains") score += 460;

  const profileIntentIds = new Set(words(profile.intent || ""));
  if (intentIds.length > 0) {
    const matchingIntents = intentIds.filter((intent) => profileIntentIds.has(intent));
    if (matchingIntents.length === intentIds.length) score += 4_200 + matchingIntents.length * 600;
    else if (matchingIntents.length > 0) score += 1_500;
  }

  const primaryTokenScore = tokenCoverageScore(profile.primary, tokens);
  const allTokenScore = tokenCoverageScore(profile.all, tokens);
  if (primaryTokenScore > 0) score += primaryTokenScore + 520;
  else if (allTokenScore > 0) score += allTokenScore;

  return score > 0 ? score + kindWeight(kind) : 0;
}

export function loadStaticSearchManifest(): Promise<StaticSearchManifest> {
  if (!manifestPromise) {
    manifestPromise = fetchPersistentJson<StaticSearchManifest>(dataAssetUrl("data/kri/kri-search-shards-manifest.json"), "Search manifest")
      .catch((error) => {
        manifestPromise = null;
        throw error;
      });
  }
  return manifestPromise;
}
