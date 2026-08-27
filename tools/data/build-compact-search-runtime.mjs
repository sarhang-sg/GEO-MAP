#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dataRoot = resolve(root, "public/data/kri");
const release = JSON.parse(await readFile(resolve(root, "release.config.json"), "utf8"));
const manifestPath = resolve(dataRoot, "kri-search-shards-manifest.json");
const languages = ["ku", "ar", "en"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const coordinate = (value) => Math.round(Number(value) * 100000);

const runtimeFiles = {};
for (const language of languages) {
  const sourceFile = `kri-search-index-${language}.json`;
  const source = JSON.parse(await readFile(resolve(dataRoot, sourceFile), "utf8"));
  if (!Array.isArray(source.items) || source.items.length === 0) {
    throw new Error(`Search source is empty: ${sourceFile}`);
  }

  const kinds = [...new Set(source.items.map((item) => String(item.k ?? "")))].sort();
  const categories = [...new Set(source.items.map((item) => String(item.c ?? "")))].sort();
  const kindIndex = new Map(kinds.map((value, index) => [value, index]));
  const categoryIndex = new Map(categories.map((value, index) => [value, index]));

  const items = source.items.map((item) => {
    const name = String(item.n ?? item[`n_${language}`] ?? "").trim();
    const fullQuery = String(item.q ?? item[`q_${language}`] ?? name).trim();
    let queryTail = fullQuery;
    if (fullQuery === name) queryTail = "";
    else if (fullQuery.startsWith(`${name} | `)) queryTail = fullQuery.slice(name.length + 3);
    return [
      name,
      queryTail,
      kindIndex.get(String(item.k ?? "")) ?? 0,
      categoryIndex.get(String(item.c ?? "")) ?? 0,
      coordinate(item.x),
      coordinate(item.y)
    ];
  });

  const payload = {
    schema: "NAV KURD compact search runtime v1",
    version: release.mapDataVersion,
    language,
    records: items.length,
    coordinate_scale: 100000,
    kinds,
    categories,
    items
  };
  const outputFile = `kri-search-runtime-${language}.json`;
  const body = Buffer.from(`${JSON.stringify(payload)}\n`);
  await writeFile(resolve(dataRoot, outputFile), body);
  runtimeFiles[language] = {
    file: outputFile,
    records: items.length,
    bytes: body.byteLength,
    sha256: sha256(body)
  };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = release.mapDataVersion;
manifest.schema = "NAV KURD compact worker search manifest v1";
manifest.files = runtimeFiles;
manifest.runtime_policy = "The selected-language compact dictionary payload is fetched only after search opens, parsed exclusively in a Web Worker and persisted by version; source/audit indexes are excluded from production.";
manifest.payload_schema = "NAV KURD compact search runtime v1";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built compact worker search payloads: ${languages.map((language) => `${language}=${runtimeFiles[language].bytes} bytes`).join(", ")}`);
