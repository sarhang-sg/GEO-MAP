/// <reference lib="webworker" />
import {
  normalizeStaticSearch,
  prepareStaticSearchQuery,
  scoreStaticSearchNames,
  scoreStaticSearchProfile,
  searchIntentIdsForCategory,
  type PreparedStaticSearchQuery,
  type StaticSearchItem,
  type StaticSearchManifest,
  type StaticSearchTextProfile
} from "../lib/static-search";
import type { Language } from "../lib/types";
import { decodeSearchPayload, type SearchPayload } from "../lib/compact-search-payload";
import { fetchPersistentJson } from "../lib/persistent-json-cache";

type IndexedItem = {
  item: StaticSearchItem;
  profile: StaticSearchTextProfile;
};
type PreparedIndex = {
  language: Language;
  entries: IndexedItem[];
  byIntent: Map<string, number[]>;
  byPrefix: Map<string, number[]>;
  resultCache: Map<string, StaticSearchItem[]>;
};
type WorkerRequest =
  | { type: "activate" | "init"; id: number; manifestUrl: string; language: Language }
  | { type: "search"; id: number; query: string; language: Language; limit: number; manifestUrl: string };
type WorkerResponse =
  | { type: "ready"; id: number; records: number; language: Language }
  | { type: "results"; id: number; items: StaticSearchItem[] }
  | { type: "error"; id: number; message: string };

type RankedItem = { entry: IndexedItem; score: number; name: string };

let manifestUrl = "";
let manifestPromise: Promise<StaticSearchManifest> | null = null;
let activeLanguage: Language = "ku";
let activeIndex: PreparedIndex | null = null;
let activeLoad: Promise<PreparedIndex> | null = null;
let generation = 0;

function post(response: WorkerResponse): void { self.postMessage(response); }
function languageName(item: StaticSearchItem, language: Language): string {
  return language === "ku" ? item.n_ku || item.n || "" : language === "ar" ? item.n_ar || item.n || "" : item.n_en || item.n || "";
}
function languageQuery(item: StaticSearchItem, language: Language): string {
  return language === "ku" ? item.q_ku || item.q || "" : language === "ar" ? item.q_ar || item.q || "" : item.q_en || item.q || "";
}
function languageCategory(item: StaticSearchItem, language: Language): string {
  return language === "ku" ? item.c_ku || item.c || "" : language === "ar" ? item.c_ar || item.c || "" : item.c_en || item.c || "";
}
function addPosting(index: Map<string, number[]>, key: string, itemIndex: number): void {
  if (!key) return;
  const bucket = index.get(key);
  if (bucket) bucket.push(itemIndex);
  else index.set(key, [itemIndex]);
}
function workerYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds only compact prefix and intent postings. The previous worker retained
 * each 69k entry in exact-token, prefix and initial-letter object arrays, which
 * created a very large object graph and browser-wide GC pauses. Numeric
 * postings keep the catalog isolated in the worker with substantially lower
 * memory pressure.
 */
async function prepare(items: StaticSearchItem[], language: Language): Promise<PreparedIndex> {
  const entries: IndexedItem[] = [];
  const byIntent = new Map<string, number[]>();
  const byPrefix = new Map<string, number[]>();

  for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
    const item = items[sourceIndex];
    const currentName = languageName(item, language);
    if (!currentName) continue;
    const currentQuery = languageQuery(item, language);
    const currentCategory = languageCategory(item, language);
    const allNames = [currentName, item.n].filter(Boolean).join(" | ");
    const allQueries = [currentQuery, item.q].filter(Boolean).join(" | ");
    const allCategories = [currentCategory, item.c, item.k].filter(Boolean).join(" | ");
    const intentIds = searchIntentIdsForCategory(item.c, allCategories);
    const profile: StaticSearchTextProfile = {
      primary: normalizeStaticSearch([currentName, currentQuery, currentCategory, item.c].filter(Boolean).join(" | ")),
      all: normalizeStaticSearch([allNames, allQueries, allCategories].filter(Boolean).join(" | ")),
      primaryName: normalizeStaticSearch(currentName),
      allNames: normalizeStaticSearch(allNames),
      intent: intentIds.join(" ")
    };
    const entryIndex = entries.length;
    entries.push({ item, profile });
    for (const intent of intentIds) addPosting(byIntent, intent, entryIndex);
    const prefixes = new Set<string>();
    for (const token of profile.all.split(" ")) {
      if (token.length < 2) continue;
      prefixes.add(token.slice(0, 2));
      if (token.length >= 3) prefixes.add(token.slice(0, 3));
    }
    for (const prefix of prefixes) addPosting(byPrefix, prefix, entryIndex);
    if (sourceIndex > 0 && sourceIndex % 1400 === 0) await workerYield();
  }
  return { language, entries, byIntent, byPrefix, resultCache: new Map() };
}

async function getManifest(url: string): Promise<StaticSearchManifest> {
  if (manifestPromise && manifestUrl === url) return manifestPromise;
  manifestUrl = url;
  activeIndex = null;
  activeLoad = null;
  manifestPromise = fetchPersistentJson<StaticSearchManifest>(url, "Search manifest")
    .catch((error) => { manifestPromise = null; throw error; });
  return manifestPromise;
}
function activate(language: Language): number {
  if (activeLanguage === language) return generation;
  activeLanguage = language;
  activeIndex = null;
  activeLoad = null;
  generation += 1;
  return generation;
}
async function ensureIndex(language: Language, url: string): Promise<PreparedIndex> {
  const loadGeneration = activate(language);
  if (activeIndex?.language === language) return activeIndex;
  if (activeLoad) return activeLoad;

  const task = getManifest(url).then(async (manifest) => {
    const file = manifest.files?.[language]?.file || manifest.fallback || manifest.file || `kri-search-index-${language}.json`;
    const indexUrl = new URL(file, url).toString();
    const payload = await fetchPersistentJson<SearchPayload>(indexUrl, `Search index (${language})`);
    const prepared = await prepare(decodeSearchPayload(payload, language), language);
    if (generation === loadGeneration && activeLanguage === language) activeIndex = prepared;
    return prepared;
  }).finally(() => {
    if (activeLoad === task) activeLoad = null;
  });
  activeLoad = task;
  return task;
}

function intersectPostings(groups: readonly number[][]): number[] {
  if (groups.length === 0) return [];
  if (groups.length === 1) return groups[0];
  const [smallest, ...rest] = [...groups].sort((a, b) => a.length - b.length);
  const sets = rest.map((group) => new Set(group));
  return smallest.filter((itemIndex) => sets.every((set) => set.has(itemIndex)));
}
function candidateIds(index: PreparedIndex, query: PreparedStaticSearchQuery): number[] | null {
  if (query.intentIds.length > 0) {
    const intentGroups = query.intentIds.map((intent) => index.byIntent.get(intent) ?? []);
    if (intentGroups.every((group) => group.length > 0)) {
      const matched = intersectPostings(intentGroups);
      if (matched.length > 0) return matched;
    }
  }
  const textTokens = query.tokens.filter((token) => !query.intentIds.includes(token));
  if (textTokens.length > 0) {
    const groups = textTokens.map((token) => index.byPrefix.get(token.slice(0, Math.min(3, token.length)))
      ?? index.byPrefix.get(token.slice(0, Math.min(2, token.length)))
      ?? []);
    if (groups.every((group) => group.length > 0)) {
      const matched = intersectPostings(groups);
      if (matched.length > 0) return matched;
    }
    const available = groups.filter((group) => group.length > 0);
    if (available.length > 0) return [...available].sort((a, b) => a.length - b.length)[0];
  }
  // A broad scan is safe inside the worker and avoids false negatives for
  // transliteration/alias queries, but no such scan ever runs on the UI thread.
  return null;
}
function insertRanked(output: RankedItem[], candidate: RankedItem, limit: number): void {
  let low = 0;
  let high = output.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = output[middle];
    if (current.score > candidate.score || (current.score === candidate.score && current.name <= candidate.name)) low = middle + 1;
    else high = middle;
  }
  output.splice(low, 0, candidate);
  if (output.length > limit) output.pop();
}
function search(index: PreparedIndex, rawQuery: string, limit: number, language: Language): StaticSearchItem[] {
  const query = prepareStaticSearchQuery(rawQuery);
  if (query.phrase.length < 2 && query.tokens.length === 0) return [];
  const cacheKey = `${limit}:${query.phrase}`;
  const cached = index.resultCache.get(cacheKey);
  if (cached) return cached;

  const ids = candidateIds(index, query);
  const ranked: RankedItem[] = [];
  const seen = new Set<string>();
  const visit = (entry: IndexedItem): void => {
    const textScore = scoreStaticSearchProfile(entry.profile, query, entry.item.k);
    if (textScore <= 0) return;
    const score = textScore + scoreStaticSearchNames(entry.profile.primaryName, entry.profile.allNames, query);
    const key = `${entry.item.x}:${entry.item.y}:${entry.item.s || entry.profile.primaryName}`;
    if (seen.has(key)) return;
    seen.add(key);
    insertRanked(ranked, { entry, score, name: languageName(entry.item, language) }, limit);
  };
  if (ids) {
    for (const itemIndex of ids) {
      const entry = index.entries[itemIndex];
      if (entry) visit(entry);
    }
  } else {
    for (const entry of index.entries) visit(entry);
  }
  const result = ranked.map(({ entry }) => entry.item);
  index.resultCache.set(cacheKey, result);
  if (index.resultCache.size > 72) index.resultCache.delete(index.resultCache.keys().next().value ?? "");
  return result;
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "search") {
    void ensureIndex(request.language, request.manifestUrl)
      .then((index) => post({ type: "ready", id: request.id, records: index.entries.length, language: request.language }))
      .catch((error) => post({ type: "error", id: request.id, message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  void ensureIndex(request.language, request.manifestUrl)
    .then((index) => post({ type: "results", id: request.id, items: search(index, request.query, request.limit, request.language) }))
    .catch((error) => post({ type: "error", id: request.id, message: error instanceof Error ? error.message : String(error) }));
});
