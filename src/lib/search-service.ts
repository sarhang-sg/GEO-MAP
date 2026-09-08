import { languageValue, placeRank } from "./geo-format";
import { yieldToMainThread } from "./performance";
import {
  normalizeStaticSearch,
  prepareStaticSearchQuery,
  scoreStaticSearchProfile,
  searchIntentIdsForCategory,
  type PreparedStaticSearchQuery,
  type StaticSearchItem,
  type StaticSearchTextProfile
} from "./static-search";
import type { AtlasPlace } from "./atlas-places";
import { atlasPlaceTypeSearchTerms } from "./atlas-taxonomy";
import type { Language, LocalityFeature, SearchChoice } from "./types";

export type SearchServiceOptions = {
  getLanguage: () => Language;
  getLocalities: () => LocalityFeature[];
  getOwnerPlaces: () => AtlasPlace[];
  searchStatic: (term: string, language: Language, limit: number) => Promise<StaticSearchItem[]>;
};

const SEARCH_RESULT_LIMIT = 24;
const LOCAL_RESULT_LIMIT = 8;
const OWNER_RESULT_LIMIT = 8;
const SPATIAL_SEARCH_CANDIDATE_LIMIT = 120;
const SPATIAL_SEARCH_RADIUS_KM = 110;
const LOCALITY_BUILD_CHUNK = 160;
const QUICK_BUILD_CHUNK = 256;
const QUICK_LOCALITY_PLACES = new Set(["city", "town", "suburb", "hamlet"]);

type SearchAnchor = { coordinate: [number, number]; score: number };
type LocalitySearchEntry = {
  feature: LocalityFeature;
  profile: StaticSearchTextProfile;
  normalizedNames: readonly string[];
  rank: number;
  populationBonus: number;
  tokens: readonly string[];
};
type LocalitySearchIndex = {
  source: LocalityFeature[];
  entries: LocalitySearchEntry[];
  byToken: Map<string, LocalitySearchEntry[]>;
  byPrefix: Map<string, LocalitySearchEntry[]>;
};

function distanceKm(a: [number, number], b: [number, number]): number {
  const radius = 6371.0088;
  const toRadians = (value: number): number => value * Math.PI / 180;
  const deltaLatitude = toRadians(b[1] - a[1]);
  const deltaLongitude = toRadians(b[0] - a[0]);
  const latitudeA = toRadians(a[1]);
  const latitudeB = toRadians(b[1]);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function languageStaticName(item: StaticSearchItem, language: Language): string {
  return language === "ku" ? item.n_ku || "" : language === "ar" ? item.n_ar || "" : item.n_en || "";
}

function coordinateKey(longitude: number, latitude: number, name: string): string {
  return `${longitude.toFixed(5)}:${latitude.toFixed(5)}:${normalizeStaticSearch(name)}`;
}

function addIndexValue(index: Map<string, LocalitySearchEntry[]>, key: string, entry: LocalitySearchEntry): void {
  if (!key) return;
  const bucket = index.get(key);
  if (bucket) bucket.push(entry);
  else index.set(key, [entry]);
}

function intersectEntries(groups: readonly LocalitySearchEntry[][]): LocalitySearchEntry[] {
  if (groups.length === 0) return [];
  if (groups.length === 1) return groups[0];
  const [smallest, ...rest] = [...groups].sort((a, b) => a.length - b.length);
  const sets = rest.map((group) => new Set(group));
  return smallest.filter((entry) => sets.every((set) => set.has(entry)));
}

function insertTopLocality(
  output: Array<{ feature: LocalityFeature; score: number }>,
  candidate: { feature: LocalityFeature; score: number },
  limit: number
): void {
  let low = 0;
  let high = output.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (output[middle].score >= candidate.score) low = middle + 1;
    else high = middle;
  }
  output.splice(low, 0, candidate);
  if (output.length > limit) output.pop();
}

/**
 * Search ranking for localities, owner places and the deferred static catalog.
 *
 * The old implementation synchronously normalized and indexed all 12,125
 * localities from an idle/setTimeout callback. On mobile that single task could
 * occupy the main thread for more than a second and the same work could be
 * repeated by the first keystroke. This implementation keeps a tiny instant
 * index for important settlements and builds the complete locality index in
 * cooperative chunks without ever blocking a frame.
 */
export class SearchService {
  private readonly getLanguage: () => Language;
  private readonly getLocalities: () => LocalityFeature[];
  private readonly getOwnerPlaces: () => AtlasPlace[];
  private readonly searchStatic: SearchServiceOptions["searchStatic"];
  private readonly quickIndexes = new Map<Language, LocalitySearchIndex>();
  private readonly localityIndexes = new Map<Language, LocalitySearchIndex>();
  private readonly activeQuickBuilds = new Map<Language, { source: LocalityFeature[]; promise: Promise<LocalitySearchIndex | null> }>();
  private buildGeneration = 0;
  private quickGeneration = 0;
  private activeBuild: Promise<void> | null = null;
  private activeBuildLanguage: Language | null = null;
  private activeBuildSource: LocalityFeature[] | null = null;

  constructor(options: SearchServiceOptions) {
    this.getLanguage = options.getLanguage;
    this.getLocalities = options.getLocalities;
    this.getOwnerPlaces = options.getOwnerPlaces;
    this.searchStatic = options.searchStatic;
  }

  activateLanguage(language: Language): void {
    this.buildGeneration += 1;
    this.quickGeneration += 1;
    this.activeBuild = null;
    this.activeBuildLanguage = null;
    this.activeBuildSource = null;
    this.activeQuickBuilds.clear();
    for (const cachedLanguage of [...this.quickIndexes.keys()]) {
      if (cachedLanguage !== language) this.quickIndexes.delete(cachedLanguage);
    }
    for (const cachedLanguage of [...this.localityIndexes.keys()]) {
      if (cachedLanguage !== language) this.localityIndexes.delete(cachedLanguage);
    }
  }

  async warmLocalities(): Promise<void> {
    const language = this.getLanguage();
    const source = this.getLocalities();
    const cached = this.localityIndexes.get(language);
    if (cached?.source === source) return;
    if (this.activeBuild && this.activeBuildLanguage === language && this.activeBuildSource === source) return this.activeBuild;

    const generation = ++this.buildGeneration;
    const task = (async () => {
      await this.ensureQuickIndex(language, source);
      if (generation !== this.buildGeneration || language !== this.getLanguage() || source !== this.getLocalities()) return;
      await this.buildFullIndex(source, language, generation);
    })().finally(() => {
      if (this.activeBuild === task) {
        this.activeBuild = null;
        this.activeBuildLanguage = null;
        this.activeBuildSource = null;
      }
    });
    this.activeBuild = task;
    this.activeBuildLanguage = language;
    this.activeBuildSource = source;
    return task;
  }

  searchFast(term: string): SearchChoice[] {
    const query = prepareStaticSearchQuery(term);
    if (query.phrase.length < 2 && query.tokens.length === 0) return [];
    const language = this.getLanguage();
    const source = this.getLocalities();
    const cached = this.quickIndexes.get(language);
    if (cached?.source !== source) void this.ensureQuickIndex(language, source);
    const index = cached?.source === source ? cached : null;
    const anchor = index ? this.resolveSpatialAnchor(query, index) : null;
    const spatialIntent = Boolean(anchor && query.intentIds.length > 0);
    const locals = index && !spatialIntent ? this.searchLocalities(query, index) : [];
    const owners = this.searchOwnerPlaces(query, anchor);
    return this.mergeChoices([...owners, ...locals]);
  }

  async search(term: string): Promise<SearchChoice[]> {
    const query = prepareStaticSearchQuery(term);
    if (query.phrase.length < 2 && query.tokens.length === 0) return [];
    const language = this.getLanguage();
    const source = this.getLocalities();
    const basePromise = this.searchBaseMap(term, query, null);
    const quick = await this.ensureQuickIndex(language, source);
    if (language !== this.getLanguage() || source !== this.getLocalities()) return [];
    const full = this.localityIndexes.get(language);
    const index = full?.source === source ? full : quick;
    const anchor = index ? this.resolveSpatialAnchor(query, index) : null;
    const spatialIntent = Boolean(anchor && query.intentIds.length > 0);
    const locals = index && !spatialIntent ? this.searchLocalities(query, index) : [];
    const owners = this.searchOwnerPlaces(query, anchor);
    const bases = anchor && query.intentIds.length > 0 ? await this.searchBaseMap(term, query, anchor) : await basePromise;
    return this.mergeChoices([...owners, ...bases, ...locals]);
  }

  private createEntry(feature: LocalityFeature, language: Language): LocalitySearchEntry {
    const p = feature.properties;
    const primaryName = languageValue(p, language);
    const rawNames = [
      p.name_ku,
      p.name_ar,
      p.name_en,
      p.search_key_ku,
      p.search_key_ar,
      p.search_key_en,
      p.search_key,
      primaryName
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    const normalizedNames = [...new Set(rawNames.flatMap((value) => value.split("|")).map(normalizeStaticSearch).filter(Boolean))];
    const allNames = [primaryName, p.name_ku, p.name_ar, p.name_en].filter(Boolean).join(" | ");
    const all = [
      primaryName,
      ...rawNames,
      p.place,
      p.admin_governorate_ku,
      p.admin_governorate_ar,
      p.admin_governorate_en,
      p.admin_district_ku,
      p.admin_district_ar,
      p.admin_district_en
    ].filter(Boolean).join(" | ");
    const populationValue = Number.parseInt(String(p.population ?? "0"), 10);
    const profile: StaticSearchTextProfile = {
      primary: normalizeStaticSearch([primaryName, p.search_key].filter(Boolean).join(" | ")),
      all: normalizeStaticSearch(all),
      primaryName: normalizeStaticSearch(primaryName),
      allNames: normalizeStaticSearch(allNames),
      intent: ""
    };
    return {
      feature,
      normalizedNames,
      rank: placeRank(p.place),
      populationBonus: Number.isFinite(populationValue) && populationValue > 0
        ? Math.min(650, Math.log10(populationValue + 1) * 100)
        : 0,
      profile,
      tokens: [...new Set(profile.all.split(" ").filter((token) => token.length >= 2))]
    };
  }

  private appendEntry(index: LocalitySearchIndex, entry: LocalitySearchEntry): void {
    index.entries.push(entry);
    const prefixes = new Set<string>();
    for (const token of entry.tokens) {
      addIndexValue(index.byToken, token, entry);
      prefixes.add(token.slice(0, Math.min(2, token.length)));
      if (token.length >= 3) prefixes.add(token.slice(0, 3));
    }
    for (const prefix of prefixes) addIndexValue(index.byPrefix, prefix, entry);
  }

  private ensureQuickIndex(language: Language, source: LocalityFeature[]): Promise<LocalitySearchIndex | null> {
    const cached = this.quickIndexes.get(language);
    if (cached?.source === source) return Promise.resolve(cached);
    const active = this.activeQuickBuilds.get(language);
    if (active?.source === source) return active.promise;
    const generation = ++this.quickGeneration;
    const promise = (async (): Promise<LocalitySearchIndex | null> => {
      const index: LocalitySearchIndex = { source, entries: [], byToken: new Map(), byPrefix: new Map() };
      for (let offset = 0; offset < source.length; offset += QUICK_BUILD_CHUNK) {
        if (generation !== this.quickGeneration || language !== this.getLanguage() || source !== this.getLocalities()) return null;
        const end = Math.min(source.length, offset + QUICK_BUILD_CHUNK);
        for (let position = offset; position < end; position += 1) {
          const feature = source[position];
          const place = String(feature.properties.place ?? "").toLocaleLowerCase("en-US");
          const population = Number.parseInt(String(feature.properties.population ?? "0"), 10);
          if (!QUICK_LOCALITY_PLACES.has(place) && !(Number.isFinite(population) && population > 0)) continue;
          this.appendEntry(index, this.createEntry(feature, language));
        }
        await yieldToMainThread();
      }
      if (generation !== this.quickGeneration || language !== this.getLanguage() || source !== this.getLocalities()) return null;
      this.quickIndexes.set(language, index);
      return index;
    })().finally(() => {
      const current = this.activeQuickBuilds.get(language);
      if (current?.promise === promise) this.activeQuickBuilds.delete(language);
    });
    this.activeQuickBuilds.set(language, { source, promise });
    return promise;
  }

  private async buildFullIndex(source: LocalityFeature[], language: Language, generation: number): Promise<void> {
    const index: LocalitySearchIndex = { source, entries: [], byToken: new Map(), byPrefix: new Map() };
    for (let offset = 0; offset < source.length; offset += LOCALITY_BUILD_CHUNK) {
      if (generation !== this.buildGeneration || language !== this.getLanguage() || source !== this.getLocalities()) return;
      const end = Math.min(source.length, offset + LOCALITY_BUILD_CHUNK);
      for (let indexPosition = offset; indexPosition < end; indexPosition += 1) {
        this.appendEntry(index, this.createEntry(source[indexPosition], language));
      }
      await yieldToMainThread();
    }
    if (generation === this.buildGeneration && language === this.getLanguage() && source === this.getLocalities()) {
      this.localityIndexes.set(language, index);
    }
  }

  private localityCandidates(index: LocalitySearchIndex, query: PreparedStaticSearchQuery): LocalitySearchEntry[] {
    const textTokens = query.tokens.filter((token) => !query.intentIds.includes(token));
    if (textTokens.length === 0) return index.entries;
    const exactGroups = textTokens.map((token) => index.byToken.get(token) ?? []).filter((group) => group.length > 0);
    if (exactGroups.length === textTokens.length) {
      const exact = intersectEntries(exactGroups);
      if (exact.length > 0) return exact;
    }
    const prefixGroups = textTokens
      .map((token) => index.byPrefix.get(token.slice(0, Math.min(3, token.length)))
        ?? index.byPrefix.get(token.slice(0, Math.min(2, token.length)))
        ?? [])
      .filter((group) => group.length > 0);
    if (prefixGroups.length > 0) {
      const prefixed = intersectEntries(prefixGroups);
      if (prefixed.length > 0) return prefixed;
    }
    // Never fall back to a 12k synchronous scan. The static worker performs the
    // broad/fuzzy pass and the quick index still supplies important settlements.
    return index.entries.length <= 600 ? index.entries : [];
  }

  private searchLocalities(query: PreparedStaticSearchQuery, index: LocalitySearchIndex): SearchChoice[] {
    const candidates: Array<{ feature: LocalityFeature; score: number }> = [];
    for (const entry of this.localityCandidates(index, query)) {
      const score = scoreStaticSearchProfile(entry.profile, query, "place") + entry.rank;
      if (score <= entry.rank) continue;
      insertTopLocality(candidates, { feature: entry.feature, score }, LOCAL_RESULT_LIMIT);
    }
    return candidates.map((entry): SearchChoice => ({ type: "local", feature: entry.feature }));
  }

  private searchOwnerPlaces(query: PreparedStaticSearchQuery, anchor: SearchAnchor | null): SearchChoice[] {
    const language = this.getLanguage();
    const candidates: Array<{ place: AtlasPlace; score: number; distance: number }> = [];
    const effectiveQuery = anchor && query.intentIds.length > 0
      ? { phrase: query.intentIds.join(" "), tokens: [...query.intentIds], intentIds: [...query.intentIds] }
      : query;

    for (const place of this.getOwnerPlaces()) {
      const metadataValues = Object.values(place.metadata ?? {}).filter((value): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean");
      const primaryName = language === "ku" ? place.name_ku : language === "ar" ? place.name_ar || "" : place.name_en || "";
      if (!primaryName) continue;
      const categoryTerms = atlasPlaceTypeSearchTerms(place.category);
      const allNames = [place.name_ku, place.name_ar, place.name_en, primaryName].filter(Boolean).join(" | ");
      const all = [allNames, place.category, ...(place.tags ?? []), ...categoryTerms, ...metadataValues.map(String)].join(" | ");
      const profile: StaticSearchTextProfile = {
        primary: normalizeStaticSearch([primaryName, place.category].filter(Boolean).join(" | ")),
        all: normalizeStaticSearch(all),
        primaryName: normalizeStaticSearch(primaryName),
        allNames: normalizeStaticSearch(allNames),
        intent: searchIntentIdsForCategory(place.category, categoryTerms.join(" | ")).join(" ")
      };
      const distance = anchor ? distanceKm(anchor.coordinate, [place.longitude, place.latitude]) : 0;
      const proximityBonus = anchor ? Math.max(0, 2_400 - distance * 22) : 0;
      const score = scoreStaticSearchProfile(profile, effectiveQuery, "poi") + 120 + proximityBonus;
      if (score <= 120 || (anchor && query.intentIds.length > 0 && distance > SPATIAL_SEARCH_RADIUS_KM)) continue;
      candidates.push({ place, score, distance });
    }

    candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
    return candidates.slice(0, OWNER_RESULT_LIMIT).map((entry): SearchChoice => ({ type: "owner", place: entry.place }));
  }

  private async searchBaseMap(term: string, query: PreparedStaticSearchQuery, anchor: SearchAnchor | null): Promise<SearchChoice[]> {
    try {
      if (anchor && query.intentIds.length > 0) {
        const items = await this.searchStatic(query.intentIds.join(" "), this.getLanguage(), SPATIAL_SEARCH_CANDIDATE_LIMIT);
        const ranked = items
          .filter((item) => {
            const itemIntents = new Set(searchIntentIdsForCategory(item.c, [item.c_ku, item.c_ar, item.c_en, item.k].filter(Boolean).join(" | ")));
            return query.intentIds.every((intent) => itemIntents.has(intent));
          })
          .map((item) => ({ item, distance: distanceKm(anchor.coordinate, [item.x, item.y]) }))
          .filter((entry) => entry.distance <= SPATIAL_SEARCH_RADIUS_KM)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, SEARCH_RESULT_LIMIT);
        return ranked.map(({ item }): SearchChoice => ({ type: "base", item }));
      }
      const items = await this.searchStatic(term, this.getLanguage(), SEARCH_RESULT_LIMIT);
      return items.map((item): SearchChoice => ({ type: "base", item }));
    } catch {
      return [];
    }
  }

  private resolveSpatialAnchor(query: PreparedStaticSearchQuery, index: LocalitySearchIndex): SearchAnchor | null {
    if (query.intentIds.length === 0) return null;
    const locationTokens = query.tokens.filter((token) => !query.intentIds.includes(token));
    if (locationTokens.length === 0) return null;
    const target = normalizeStaticSearch(locationTokens.join(" "));
    if (target.length < 2) return null;
    const targetWords = target.split(" ").filter(Boolean);
    const anchorQuery: PreparedStaticSearchQuery = { phrase: target, tokens: targetWords, intentIds: [] };
    let best: SearchAnchor | null = null;
    for (const entry of this.localityCandidates(index, anchorQuery)) {
      let lexicalScore = 0;
      for (const name of entry.normalizedNames) {
        if (name === target) lexicalScore = Math.max(lexicalScore, 12_000);
        else if (name.startsWith(`${target} `) || target.startsWith(`${name} `)) lexicalScore = Math.max(lexicalScore, 7_000);
        else if (name.includes(target)) lexicalScore = Math.max(lexicalScore, 4_000);
        else {
          const nameWords = new Set(name.split(" ").filter(Boolean));
          const coverage = targetWords.filter((word) => nameWords.has(word)).length;
          if (coverage === targetWords.length) lexicalScore = Math.max(lexicalScore, 2_500 + coverage * 300);
        }
      }
      if (lexicalScore === 0) continue;
      const score = lexicalScore + entry.rank * 10 + entry.populationBonus;
      if (best && score <= best.score) continue;
      const coordinate = entry.feature.geometry.coordinates;
      best = { coordinate: [coordinate[0], coordinate[1]], score };
    }
    return best;
  }

  private mergeChoices(choices: SearchChoice[]): SearchChoice[] {
    const language = this.getLanguage();
    const output: SearchChoice[] = [];
    const seen = new Set<string>();
    for (const choice of choices) {
      const key = choice.type === "local"
        ? coordinateKey(choice.feature.geometry.coordinates[0], choice.feature.geometry.coordinates[1], languageValue(choice.feature.properties, language))
        : choice.type === "owner"
          ? coordinateKey(choice.place.longitude, choice.place.latitude, language === "ku" ? choice.place.name_ku : language === "ar" ? choice.place.name_ar || "" : choice.place.name_en || "")
          : coordinateKey(choice.item.x, choice.item.y, languageStaticName(choice.item, language));
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(choice);
      if (output.length >= SEARCH_RESULT_LIMIT) break;
    }
    return output;
  }
}
