#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ROOT, assert, fileExists, posixPath, readJson, sha256, walk } from "../lib/project.mjs";

const release = await readJson("release.config.json");
const manifest = await readJson("RELEASE_MANIFEST.json");
const sourceDataManifest = await readJson("data-src/source-data-manifest.json");
assert(manifest.schema === "NAV KURD production source manifest v1", "Release manifest schema mismatch.");
assert(manifest.release === release.releaseId && manifest.version === release.appVersion, "Release manifest identity mismatch.");
assert(manifest.mapDataVersion === release.mapDataVersion, "Release manifest map data mismatch.");

const excludedDirectories = [
  ".git", ".vercel", "node_modules", "dist", ".data-inputs", ".build-cache",
  "__pycache__", ".pytest_cache", ".mypy_cache", ".idea", ".vscode"
];
const transientStagePaths = new Set(sourceDataManifest.entries.map((entry) => entry.stage));
const isAtomicTempPath = (path) => /(?:^|\/)\.[^/]+\.[A-Za-z0-9]{6}$/u.test(path);
const actualPaths = new Set();
for (const absolute of await walk(ROOT, { excludeDirectories: excludedDirectories })) {
  const path = posixPath(absolute);
  const name = basename(path);
  if (path === "RELEASE_MANIFEST.json" || transientStagePaths.has(path) || name === ".DS_Store") continue;
  if (isAtomicTempPath(path)) continue;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) continue;
  if (/\.(?:pyc|pyo|log|tmp|zip|sha256)$/iu.test(name)) continue;
  actualPaths.add(path);
}
const expectedPaths = new Set(Object.keys(manifest.files ?? {}));
const missing = [...expectedPaths].filter((path) => !actualPaths.has(path));
const extra = [...actualPaths].filter((path) => !expectedPaths.has(path));
assert(missing.length === 0 && extra.length === 0, `Release manifest file-set mismatch:\nmissing=${missing.join(", ")}\nextra=${extra.join(", ")}`);

let bytes = 0;
for (const [path, expected] of Object.entries(manifest.files ?? {})) {
  assert(await fileExists(path), `Release manifest file missing: ${path}`);
  const body = await readFile(path);
  assert(body.length === expected.bytes, `Release manifest byte mismatch: ${path}`);
  assert(sha256(body) === expected.sha256, `Release manifest hash mismatch: ${path}`);
  bytes += body.length;
}
assert(expectedPaths.size === manifest.fileCount, "Release manifest file count mismatch.");
assert(bytes === manifest.totalBytes, "Release manifest total byte mismatch.");
console.log(`PASS release integrity: ${manifest.fileCount} files / ${bytes} bytes; no unmanifested source.`);
