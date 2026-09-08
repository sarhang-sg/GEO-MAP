#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { ROOT, posixPath, readJson, sha256, walk } from "../lib/project.mjs";

const release = await readJson("release.config.json");
const sourceDataManifest = await readJson("data-src/source-data-manifest.json");
const transientStagePaths = new Set(sourceDataManifest.entries.map((entry) => entry.stage));
const excludedDirectories = new Set([
  ".git", ".vercel", "node_modules", "dist", ".data-inputs", ".build-cache",
  "__pycache__", ".pytest_cache", ".mypy_cache", ".idea", ".vscode"
]);
const excludedFiles = new Set(["RELEASE_MANIFEST.json", ".DS_Store"]);
const isAtomicTempPath = (path) => /(?:^|\/)\.[^/]+\.[A-Za-z0-9]{6}$/u.test(path);
const entries = {};
for (const file of await walk(ROOT, { excludeDirectories: [...excludedDirectories] })) {
  const path = posixPath(file);
  const name = path.split("/").at(-1) ?? path;
  if (excludedFiles.has(path) || excludedFiles.has(name) || transientStagePaths.has(path)) continue;
  if (isAtomicTempPath(path)) continue;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) continue;
  if (/\.(?:pyc|pyo|log|tmp|zip|sha256)$/iu.test(name)) continue;
  const body = await readFile(file);
  entries[path] = { bytes: body.length, sha256: sha256(body) };
}
const manifest = {
  schema: "NAV KURD production source manifest v1",
  release: release.releaseId,
  version: release.appVersion,
  mapDataVersion: release.mapDataVersion,
  cacheSchemaVersion: release.cacheSchemaVersion,
  offlinePackVersion: release.offlinePackVersion,
  generatedForDate: release.releaseDate,
  secretSafe: true,
  fileCount: Object.keys(entries).length,
  totalBytes: Object.values(entries).reduce((sum, entry) => sum + entry.bytes, 0),
  files: entries
};
await writeFile("RELEASE_MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`PASS release manifest: ${manifest.fileCount} files / ${manifest.totalBytes} bytes.`);
