#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = resolve(root, "dist");
const sourceOnlyFiles = [
  "data/kri/kri-pois.geojson",
  "data/kri/kri-pois-runtime.geojson",
  "data/kri/kri-localities.geojson",
  "data/kri/kri-localities-render.geojson",
  "data/kri/kri-localities-render-ku.geojson",
  "data/kri/kri-localities-render-ar.geojson",
  "data/kri/kri-localities-render-en.geojson",
  "data/kri/kri-pois-render.geojson",
  "data/kri/kri-natural-features.geojson",
  "data/kri/kri-search-index.json",
  "data/kri/kri-search-index-ku.json",
  "data/kri/kri-search-index-ar.json",
  "data/kri/kri-search-index-en.json",
  "data/kri/kri-poi-quarantine.json",
  "data/kri/kri-data-quality-quarantine.json",
  "data/kri/kri-poi-catalog-report.json",
  "data/kri/kri-canonical-data-quality-report.json",
  "data/kri/kri-base-map-manifest.json",
  "data/kri/kri-data-provenance.json",
  "data/kri/source-integrity-manifest.json",
];
const dataDirectory = resolve(dist, "data/kri");
const atomicTempFiles = (await readdir(dataDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /^\..+\.[A-Za-z0-9]{6}$/u.test(entry.name))
  .map((entry) => `data/kri/${entry.name}`);
const prunedFiles = [...sourceOnlyFiles, ...atomicTempFiles];
await Promise.all(prunedFiles.map((file) => rm(resolve(dist, file), { force: true })));
console.log(`Pruned ${prunedFiles.length} source/audit/temp files from production dist.`);
