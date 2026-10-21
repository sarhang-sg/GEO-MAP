#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const data = resolve(root, "public/data/kri");
const fullPath = resolve(data, "kri-search-index.json");
const manifestPath = resolve(data, "kri-search-index-manifest.json");
const shardsManifestPath = resolve(data, "kri-search-shards-manifest.json");

const qualityPath = resolve(data, "kri-canonical-data-quality-report.json");
const provenancePath = resolve(data, "kri-data-provenance.json");
const poiReportPath = resolve(data, "kri-poi-catalog-report.json");
const releaseConfig = JSON.parse(await readFile(resolve(root, "release.config.json"), "utf8"));
const languages = ["ku", "ar", "en"];
const payload = JSON.parse(await readFile(fullPath, "utf8"));
const items = Array.isArray(payload.items) ? payload.items : [];

const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
const coordinate = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(5) : "";
const fingerprint = (item) => [
  normalize(item.k), normalize(item.c), normalize(item.n_ku), normalize(item.n_ar), normalize(item.n_en),
  coordinate(item.x), coordinate(item.y)
].join("\u001f");
const sourcePriority = (source) => {
  const value = String(source ?? "");
  if (/^osm-(?:node|way|relation)-/u.test(value)) return 4;
  if (/^geonames-/u.test(value)) return 3;
  if (/^osm-natural-/u.test(value)) return 2;
  return 1;
};

const selected = new Map();
let removed = 0;
for (const item of items) {
  const key = fingerprint(item);
  const previous = selected.get(key);
  if (!previous) {
    selected.set(key, item);
    continue;
  }
  removed += 1;
  if (sourcePriority(item.s) > sourcePriority(previous.s)) selected.set(key, item);
}
const deduplicated = [...selected.values()];
const sourceRecords = Math.max(
  Number(payload.runtime_deduplication?.source_records || 0),
  items.length
);
payload.items = deduplicated;
payload.published_records = deduplicated.length;
payload.runtime_deduplication = {
  schema: "NAV KURD strict search identity v1",
  source_records: sourceRecords,
  removed_records: Math.max(0, sourceRecords - deduplicated.length),
  key: "kind + category + exact language names + coordinates rounded to 5 decimals",
  source_preference: "direct OSM element > GeoNames > derived natural duplicate"
};
await writeFile(fullPath, `${JSON.stringify(payload)}\n`);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const shardFiles = {};
for (const language of languages) {
  const nameKey = `n_${language}`;
  const queryKey = `q_${language}`;
  const categoryKey = `c_${language}`;
  const compactItems = deduplicated
    .filter((item) => String(item[nameKey] ?? "").trim())
    .map((item) => {
      const selectedName = String(item[nameKey] ?? "").trim();
      const selectedQuery = String(item[queryKey] ?? "").trim();
      const selectedCategory = String(item[categoryKey] ?? "").trim();
      const compact = {
        n: selectedName,
        q: selectedQuery || selectedName,
        k: item.k,
        c: item.c,
        x: item.x,
        y: item.y,
        s: item.s,
        [nameKey]: selectedName,
        [queryKey]: selectedQuery || selectedName,
        [categoryKey]: selectedCategory || undefined
      };
      return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== undefined && value !== ""));
    });
  const shard = {
    version: payload.version,
    language,
    language_policy: payload.language_policy,
    records: compactItems.length,
    compact_schema: "NAV KURD selected-language compact search shard v2",
    items: compactItems
  };
  const file = `kri-search-index-${language}.json`;
  const body = Buffer.from(`${JSON.stringify(shard)}\n`);
  await writeFile(resolve(data, file), body);
  shardFiles[language] = { file, records: compactItems.length, bytes: body.byteLength, sha256: sha256(body) };
}
const fullBody = await readFile(fullPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = payload.version;
manifest.schema = "NAV KURD exact-language compact search shards v4";
manifest.file = null;
manifest.fallback = null;
manifest.records = deduplicated.length;
manifest.bytes = fullBody.byteLength;
manifest.sha256 = sha256(fullBody);
manifest.files = shardFiles;
manifest.runtime_policy = "Only the selected language shard is fetched and cached on demand; the full audit index is not deployed.";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const shardsManifest = JSON.parse(await readFile(shardsManifestPath, "utf8"));
shardsManifest.version = payload.version;
shardsManifest.schema = "NAV KURD exact-language compact search shards v4";
shardsManifest.files = shardFiles;
delete shardsManifest.fallback;
shardsManifest.runtime_policy = manifest.runtime_policy;
await writeFile(shardsManifestPath, `${JSON.stringify(shardsManifest, null, 2)}\n`);

const quality = JSON.parse(await readFile(qualityPath, "utf8"));
const kindCounts = Object.fromEntries([...new Set(deduplicated.map((item) => item.k))]
  .sort()
  .map((kind) => [kind, deduplicated.filter((item) => item.k === kind).length]));
quality.release = releaseConfig.releaseId;
quality.app_version = releaseConfig.appVersion;
quality.published.search_records = deduplicated.length;
quality.published.search_source_records = sourceRecords;
quality.published.search_removed_strict_duplicates = Math.max(0, sourceRecords - deduplicated.length);
quality.published.search_kind_counts = kindCounts;
quality.exact_language_coverage.search = Object.fromEntries(languages.map((language) => [language, shardFiles[language].records]));
quality.policy = "Source-backed operational data. Strict duplicate search identities are removed deterministically; verified Kurdish aliases are applied where available, otherwise the source-original name is preserved as an explicit fallback; no proper name is invented.";
await writeFile(qualityPath, `${JSON.stringify(quality, null, 2)}\n`);

const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
provenance.release = releaseConfig.releaseId;
provenance.app_version = releaseConfig.appVersion;
provenance.map_data_version = releaseConfig.mapDataVersion;
provenance.counts = {
  ...(provenance.counts || {}),
  search_records: deduplicated.length,
  search_source_records: sourceRecords,
  search_removed_strict_duplicates: Math.max(0, sourceRecords - deduplicated.length),
  search_kind_counts: kindCounts
};
await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

const poiReport = JSON.parse(await readFile(poiReportPath, "utf8"));
poiReport.release = releaseConfig.releaseId;
poiReport.app_version = releaseConfig.appVersion;
poiReport.version = releaseConfig.mapDataVersion;
poiReport.search_records = deduplicated.length;
poiReport.files = {
  ...(poiReport.files || {}),
  search: {
    file: "kri-search-index.json",
    bytes: fullBody.byteLength,
    sha256: sha256(fullBody)
  }
};
await writeFile(poiReportPath, `${JSON.stringify(poiReport, null, 2)}\n`);

console.log(`Optimized search runtime: ${sourceRecords} source -> ${deduplicated.length} unique; removed ${Math.max(0, sourceRecords - deduplicated.length)} strict duplicates.`);
