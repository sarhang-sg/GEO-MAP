#!/usr/bin/env node
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dataDir = resolve(root, "public/data/kri");
const manifestPath = resolve(dataDir, "kri-localities-language-manifest.json");
const offlineManifestPath = resolve(root, "public/offline-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const languages = ["ku", "ar", "en"];

const canonicalGeometrySource = manifest.files?.ku?.file;
if (!canonicalGeometrySource) throw new Error("Missing canonical Kurdish locality geometry source.");
const canonicalPayload = JSON.parse(await readFile(resolve(dataDir, canonicalGeometrySource), "utf8"));
const geometryFeatures = (canonicalPayload.features ?? []).map((feature) => {
  const properties = feature?.properties ?? {};
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      id: String(properties.id ?? ""),
      place: String(properties.place ?? ""),
      category: String(properties.category ?? ""),
      population: properties.population ?? null
    }
  };
});
if (geometryFeatures.length !== manifest.files.ku.records || geometryFeatures.some((feature) => !feature.properties.id || feature.geometry?.type !== "Point")) {
  throw new Error("Locality runtime geometry identity mismatch.");
}
const geometryFile = "kri-localities-runtime-base.geojson";
const geometryPayload = {
  type: "FeatureCollection",
  schema: "NAV KURD locality geometry runtime v1",
  version: manifest.version,
  records: geometryFeatures.length,
  features: geometryFeatures
};
const geometrySerialized = `${JSON.stringify(geometryPayload)}\n`;
await writeFile(resolve(dataDir, geometryFile), geometrySerialized);
manifest.geometry_file = geometryFile;
manifest.geometry_records = geometryFeatures.length;
manifest.geometry_bytes = (await stat(resolve(dataDir, geometryFile))).size;
manifest.geometry_sha256 = createHash("sha256").update(geometrySerialized).digest("hex");

const clusterPlaces = new Set(["village", "locality", "hamlet", "suburb"]);
const minorFeatures = geometryFeatures.filter((feature) => clusterPlaces.has(feature.properties.place));
const majorFeatures = geometryFeatures.filter((feature) => !clusterPlaces.has(feature.properties.place));
const majorFile = "kri-localities-major-runtime.geojson";
const majorPayload = { type: "FeatureCollection", schema: "NAV KURD major locality runtime v1", version: manifest.version, records: majorFeatures.length, features: majorFeatures };
const majorSerialized = `${JSON.stringify(majorPayload)}\n`;
await writeFile(resolve(dataDir, majorFile), majorSerialized);
manifest.major_file = majorFile;
manifest.major_records = majorFeatures.length;
manifest.major_bytes = (await stat(resolve(dataDir, majorFile))).size;
manifest.major_sha256 = createHash("sha256").update(majorSerialized).digest("hex");
manifest.minor_records = minorFeatures.length;

const mercatorCell = (coordinate, zoom) => {
  const longitude = Number(coordinate[0]);
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, Number(coordinate[1])));
  const scale = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * scale);
  const radians = latitude * Math.PI / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale);
  return [x, y];
};
const clusterBands = [
  { mapZoom: 7, cellZoom: 9, expansionZoom: 8.2 },
  { mapZoom: 8, cellZoom: 10, expansionZoom: 9.2 },
  { mapZoom: 9, cellZoom: 11, expansionZoom: 10.4 }
];
const staticClusters = [];
for (const band of clusterBands) {
  const groups = new Map();
  for (const feature of minorFeatures) {
    const [x, y] = mercatorCell(feature.geometry.coordinates, band.cellZoom);
    const key = `${x}/${y}`;
    const group = groups.get(key) ?? { x, y, longitude: 0, latitude: 0, count: 0 };
    group.longitude += Number(feature.geometry.coordinates[0]);
    group.latitude += Number(feature.geometry.coordinates[1]);
    group.count += 1;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.count < 2) continue;
    staticClusters.push({
      type: "Feature",
      id: `locality-cluster-${band.mapZoom}-${group.x}-${group.y}`,
      geometry: { type: "Point", coordinates: [group.longitude / group.count, group.latitude / group.count] },
      properties: {
        id: `locality-cluster-${band.mapZoom}-${group.x}-${group.y}`,
        cluster_zoom: band.mapZoom,
        expansion_zoom: band.expansionZoom,
        point_count: group.count,
        point_count_abbreviated: group.count >= 1000 ? `${Math.round(group.count / 100) / 10}k` : String(group.count)
      }
    });
  }
}
const clusterFile = "kri-localities-cluster-runtime.geojson";
const clusterPayload = { type: "FeatureCollection", schema: "NAV KURD precomputed locality clusters v1", version: manifest.version, records: staticClusters.length, source_records: minorFeatures.length, features: staticClusters };
const clusterSerialized = `${JSON.stringify(clusterPayload)}\n`;
await writeFile(resolve(dataDir, clusterFile), clusterSerialized);
manifest.cluster_file = clusterFile;
manifest.cluster_records = staticClusters.length;
manifest.cluster_source_records = minorFeatures.length;
manifest.cluster_bytes = (await stat(resolve(dataDir, clusterFile))).size;
manifest.cluster_sha256 = createHash("sha256").update(clusterSerialized).digest("hex");

for (const language of languages) {
  const sourceFile = manifest.files?.[language]?.file;
  if (!sourceFile) throw new Error(`Missing locality language source for ${language}.`);
  const payload = JSON.parse(await readFile(resolve(dataDir, sourceFile), "utf8"));
  const items = (payload.features ?? []).map((feature) => {
    const properties = feature?.properties ?? {};
    return [
      String(properties.id ?? ""),
      String(properties.name ?? ""),
      properties.name_verified === true ? 1 : 0,
      String(properties[`admin_governorate_${language}`] ?? ""),
      String(properties[`admin_district_${language}`] ?? ""),
      String(properties[`admin_subdistrict_${language}`] ?? ""),
      String(properties[`category_${language}`] ?? ""),
      language === "ku" ? String(properties.name_ku_status ?? "") : ""
    ];
  });
  if (items.length !== manifest.files[language].records || items.some((item) => !item[0])) {
    throw new Error(`Locality language delta identity mismatch for ${language}.`);
  }
  const delta = {
    schema: "NAV KURD locality language properties v1",
    version: manifest.version,
    language,
    records: items.length,
    fields: ["id", "name", "name_verified", "admin_governorate", "admin_district", "admin_subdistrict", "category", "name_status"],
    items
  };
  const file = `kri-localities-properties-${language}.json`;
  const serialized = `${JSON.stringify(delta)}\n`;
  await writeFile(resolve(dataDir, file), serialized);
  const bytes = (await stat(resolve(dataDir, file))).size;
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  manifest.files[language].properties_file = file;
  manifest.files[language].properties_bytes = bytes;
  manifest.files[language].properties_sha256 = sha256;
}
manifest.runtime_policy = "Load the compact canonical geometry once, then apply exact-language property diffs by stable locality id.";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const offline = JSON.parse(await readFile(offlineManifestPath, "utf8"));
const assets = Array.isArray(offline.assets) ? offline.assets : [];
const geometryPath = `data/kri/${manifest.geometry_file}`;
const geometryExisting = assets.find((entry) => entry.path === geometryPath);
const geometryEntry = { path: geometryPath, required: true, warm: true, offlineRuntime: true, localityGeometry: true };
if (geometryExisting) Object.assign(geometryExisting, geometryEntry);
else assets.push(geometryEntry);
const majorPath = `data/kri/${manifest.major_file}`;
const majorExisting = assets.find((entry) => entry.path === majorPath);
const majorEntry = { path: majorPath, required: true, warm: true, offlineRuntime: true, localityMajor: true };
if (majorExisting) Object.assign(majorExisting, majorEntry);
else assets.push(majorEntry);
const clusterPath = `data/kri/${manifest.cluster_file}`;
const clusterExisting = assets.find((entry) => entry.path === clusterPath);
const clusterEntry = { path: clusterPath, required: true, warm: true, offlineRuntime: true, localityCluster: true };
if (clusterExisting) Object.assign(clusterExisting, clusterEntry);
else assets.push(clusterEntry);
for (const language of languages) {
  const path = `data/kri/${manifest.files[language].properties_file}`;
  const existing = assets.find((entry) => entry.path === path);
  const entry = { path, required: false, warm: false, offlineRuntime: true, language, languageAsset: true };
  if (existing) Object.assign(existing, entry);
  else assets.push(entry);
}
offline.assets = assets.sort((a, b) => String(a.path).localeCompare(String(b.path)));
await writeFile(offlineManifestPath, `${JSON.stringify(offline, null, 2)}\n`);
console.log("Generated compact locality geometry, partitioned map sources and language property packs for ku/ar/en.");
