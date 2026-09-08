#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

const release = JSON.parse(await readFile("release.config.json", "utf8"));
const sourceManifest = JSON.parse(await readFile("data-src/source-data-manifest.json", "utf8"));
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const write = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const digest = (body) => createHash("sha256").update(body).digest("hex");
const meta = async (path) => {
  const body = await readFile(path);
  return { file: path.split("/").at(-1), bytes: body.length, sha256: digest(body) };
};
const sourceEntry = (stage) => {
  const entry = sourceManifest.entries.find((candidate) => candidate.stage === stage);
  if (!entry) throw new Error(`Missing source-data manifest entry for ${stage}`);
  return entry;
};

const targets = [
  ["public/data/kri/kri-canonical-data-quality-report.json", (payload) => ({ ...payload, release: release.releaseId, app_version: release.appVersion, map_data_version: release.mapDataVersion, generated_at: release.hardeningDate })],
  ["public/data/kri/kri-data-provenance.json", (payload) => ({ ...payload, release: release.releaseId, app_version: release.appVersion, map_data_version: release.mapDataVersion, version: release.mapDataVersion, last_reviewed: release.hardeningDate })],
  ["public/data/kri/kri-poi-catalog-report.json", (payload) => ({ ...payload, release: release.releaseId, app_version: release.appVersion, version: release.mapDataVersion, last_reviewed: release.hardeningDate })],
  ["public/data/kri/kri-data-quality-report.json", (payload) => ({ ...payload, release: release.mapDataVersion, generated_at: release.hardeningDate })],
  ["public/data/kri/kirkuk-verified-name-corrections.json", (payload) => ({ ...payload, source_register_release: payload.source_register_release || payload.release, release: release.mapDataVersion, last_reviewed: release.hardeningDate })],
  ["data-src/generated/search/kri-search-index-manifest.json", (payload) => ({ ...payload, version: release.mapDataVersion })],
  ["public/data/kri/kri-search-shards-manifest.json", (payload) => ({ ...payload, version: release.mapDataVersion })],
  ["public/data/kri/kri-viewport-poi-shards-manifest.json", (payload) => ({ ...payload, version: release.mapDataVersion })],
];
for (const [path, transform] of targets) {
  await write(path, transform(await read(path)));
}

const runtimeSearch = await read("public/data/kri/kri-search-shards-manifest.json");
const poiStage = "public/data/kri/kri-pois.geojson";
const localityStage = "public/data/kri/kri-localities.geojson";
const poiRuntimePath = "data-src/generated/kri-pois-runtime.geojson";
const poiPayload = await read(poiStage);
const localityPayload = await read(localityStage);
const poiCount = Array.isArray(poiPayload.features) ? poiPayload.features.length : 0;
const localityCount = Array.isArray(localityPayload.features) ? localityPayload.features.length : 0;
const poiSource = sourceEntry(poiStage);
const localitySource = sourceEntry(localityStage);
const poiRuntime = await meta(poiRuntimePath);
const base = await read("public/data/kri/kri-base-map-manifest.json");

base.release = release.appVersion;
base.release_id = release.releaseId;
base.map_data_version = release.mapDataVersion;
base.format = "PMTiles v3 + production POI GeoJSON/viewport shards + compact multilingual worker search";
base.search = {
  ...runtimeSearch,
  source_manifest: "data-src/generated/search/kri-search-index-manifest.json",
  compressed_source_archive: sourceEntry("public/data/kri/kri-search-index.json").source,
};
base.localities = {
  source_path: localitySource.source,
  file: localitySource.source.split("/").at(-1),
  bytes: localitySource.bytes,
  sha256: localitySource.sha256,
  records: localityCount,
  runtime_manifest: "kri-localities-language-manifest.json",
};
base.canonical_pois = {
  ...(base.canonical_pois || {}),
  catalog: {
    source_path: poiSource.logical_source || poiSource.source,
    compressed_source_archive: poiSource.compression === "gzip" ? poiSource.source : null,
    file: (poiSource.logical_source || poiSource.source).split("/").at(-1),
    bytes: poiSource.bytes,
    sha256: poiSource.sha256,
    archive_bytes: poiSource.archive_bytes,
    archive_sha256: poiSource.archive_sha256,
    records: poiCount,
  },
  runtime: { source_path: poiRuntimePath, ...poiRuntime, records: poiCount },
  render_file: "kri-pois-render.geojson",
  viewport_manifest: "kri-viewport-poi-shards-manifest.json",
};
base.source_data_policy = "Canonical, quarantine and build-intermediate data is separated under data-src; large source-only catalogs are deterministic gzip archives and are materialized only inside the release wrapper.";
await write("public/data/kri/kri-base-map-manifest.json", base);
console.log(`PASS release metadata alignment: ${release.appVersion} / ${release.mapDataVersion}`);
