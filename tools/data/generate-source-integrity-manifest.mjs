#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, posixPath, readJson, sha256, walk } from "../lib/project.mjs";

const release = await readJson("release.config.json");
const sourceDataManifest = await readJson("data-src/source-data-manifest.json");
const transientStagePaths = new Set(sourceDataManifest.entries.map((entry) => entry.stage));
const outputPath = "public/data/kri/source-integrity-manifest.json";
const roots = [
  resolve(ROOT, "public/data/kri"),
  resolve(ROOT, "public/assets/icons/atlas")
];
const isAtomicTempPath = (path) => /(?:^|\/)\.[^/]+\.[A-Za-z0-9]{6}$/u.test(path);
const files = {};
for (const root of roots) {
  for (const absolute of await walk(root)) {
    const relative = posixPath(absolute);
    if (relative === outputPath || transientStagePaths.has(relative)) continue;
    if (isAtomicTempPath(relative)) continue;
    if (/\.(?:tmp|log|zip|sha256)$/iu.test(relative)) continue;
    const body = await readFile(absolute);
    files[relative] = { bytes: body.length, sha256: sha256(body) };
  }
}
const manifest = {
  schema: "NAV KURD published data integrity manifest v1",
  release: release.releaseId,
  appVersion: release.appVersion,
  mapDataVersion: release.mapDataVersion,
  generatedForDate: release.releaseDate,
  fileCount: Object.keys(files).length,
  totalBytes: Object.values(files).reduce((sum, entry) => sum + entry.bytes, 0),
  files
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`PASS published data integrity manifest: ${manifest.fileCount} files / ${manifest.totalBytes} bytes.`);
