#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFile(resolve(root, path), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const [
  main,
  localities,
  searchService,
  searchWorkerClient,
  ownerPlaces,
  offlinePack,
  languageAssets,
  serviceWorker,
  offlineBuilder
] = await Promise.all([
  read("src/main.ts"),
  read("src/lib/locality-language-pack.ts"),
  read("src/lib/search-service.ts"),
  read("src/lib/search-worker-client.ts"),
  read("src/lib/owner-places-controller.ts"),
  read("src/lib/offline-map-pack.ts"),
  read("src/lib/language-asset-cache.ts"),
  read("public/sw.js"),
  read("tools/build/build-offline-runtime.mjs")
]);

assert(main.includes("const criticalSearchCount = localCoreEnabled"), "Web search metadata returned to the critical map path.");
assert(main.includes("languageAssetCache!.warmProperties(language)"), "Unused language packs are parsed on the page thread again.");
assert(localities.includes("applyPropertyPayload(features, properties, language, false)"), "Initial locality hydration performs replacement cleanup again.");
assert(searchService.includes("PREPARED_QUERY_CACHE_LIMIT = 48"), "Prepared search-query cache is missing or unbounded.");
assert(searchWorkerClient.includes("inFlightSearches.get(cacheKey)"), "Identical search-worker requests are no longer coalesced.");
assert(ownerPlaces.includes("private refreshPromise: Promise<void> | null"), "Owner-place refresh requests are no longer coalesced.");
assert(offlinePack.includes("unchangedVerifiedFile"), "Unchanged verified PMTiles are re-hashed on every launch.");
assert(offlinePack.includes("private readonly completeFiles"), "Completed OPFS PMTiles snapshots are not reused for range reads.");
assert(languageAssets.includes('"WARM_LANGUAGE_ASSETS"'), "Language prefetch left the service-worker cache owner.");
assert(serviceWorker.includes("const CACHE_TRIM_WRITE_BATCH = 16"), "Cache trimming returned to per-write full scans.");
assert(serviceWorker.includes("versionedDataFetches.get(key)"), "Concurrent immutable-data requests are no longer coalesced.");
assert(serviceWorker.includes("cache.match(absolute(entry.path))"), "Optional shell warming refetches cached assets.");
assert(offlineBuilder.includes('path.startsWith("assets/icons/social/")'), "Noncritical social artwork returned to the atomic startup shell.");

console.log("PASS Phase 4 performance contracts: critical startup, search, PMTiles, language, PWA and network coalescing.");
