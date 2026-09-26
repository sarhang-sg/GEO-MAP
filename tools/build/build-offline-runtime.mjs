#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = resolve(root, "dist");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const release = JSON.parse(await readFile(resolve(root, "release.config.json"), "utf8"));
const manifestPath = resolve(dist, "offline-manifest.json");
const swPath = resolve(dist, "sw.js");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (pkg.version !== release.appVersion) throw new Error("package.json version is not aligned with release.config.json.");
if (release.serviceWorkerRelease !== release.appVersion) throw new Error("Service worker release is not aligned with app version.");
if (!Number.isInteger(release.cacheSchemaVersion) || release.cacheSchemaVersion < 1) throw new Error("Invalid cache schema version.");

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const distFiles = await filesRecursively(dist);
const hashedBuildAssetPattern = /^assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/u;
const generatedAssets = distFiles
  .map((file) => relative(dist, file).split(sep).join("/"))
  .filter((file) => file === "index.html" || hashedBuildAssetPattern.test(file))
  .filter((file) => !file.endsWith(".map"));

const indexHtml = await readFile(resolve(dist, "index.html"), "utf8");
const directBuildAssets = new Set(
  [...indexHtml.matchAll(/(?:src|href)=["']\/?(assets\/[^"'?#]+)["']/gu)]
    .map((match) => match[1])
    .filter((path) => hashedBuildAssetPattern.test(path))
);

async function addStaticModuleDependencies(assetPath, required) {
  if (!assetPath.endsWith(".js") || required.has(assetPath)) return;
  required.add(assetPath);
  const source = await readFile(resolve(dist, assetPath), "utf8");
  const importPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.\.?\/[^"']+)["']/gu;
  for (const match of source.matchAll(importPattern)) {
    const dependency = posix.normalize(posix.join(posix.dirname(assetPath), match[1]));
    if (hashedBuildAssetPattern.test(dependency)) await addStaticModuleDependencies(dependency, required);
  }
}

const requiredBuildAssets = new Set();
for (const assetPath of directBuildAssets) {
  if (assetPath.endsWith(".js")) await addStaticModuleDependencies(assetPath, requiredBuildAssets);
  else requiredBuildAssets.add(assetPath);
}

const requiredStaticAssets = new Set([
  "index.html",
  "pwa-init.js",
  "manifest.webmanifest",
  "offline-manifest.json",
  "offline.html",
  "offline.css",
  "offline.js",
  "icons/nav-kurd-logo.png",
  "fonts/RedHatDisplay-Variable.woff2",
  "fonts/UniQAIDAR-Money-Heist-002.ttf",
  "fonts/DroidLogo-Bold.ttf",
  "icons/nav-kurd-icon-192.png",
  "icons/favicon-32x32.png",
  "assets/icons/social/instagram.svg"
]);

const existing = new Map(
  manifest.assets
    .filter((entry) => entry.path)
    .map((entry) => [entry.path, { ...entry, required: false }])
);
existing.delete("icons/kri-map.svg");
for (const obsoleteLoaderAsset of [
  "assets/nav-kurd-loader.gif",
  "assets/nav-kurd-loader.webp",
  "assets/nav-kurd-loader-offline.gif",
  "assets/nav-kurd-loader-offline.webp",
  "assets/nav-kurd-loader-restored.gif",
  "assets/nav-kurd-loader-restored.webp",
]) existing.delete(obsoleteLoaderAsset);
for (const path of generatedAssets) {
  existing.set(path, {
    ...(existing.get(path) ?? {}),
    path,
    required: requiredBuildAssets.has(path),
    warm: true
  });
}
for (const path of requiredStaticAssets) {
  existing.set(path, { ...(existing.get(path) ?? {}), path, required: true, warm: true });
}
for (const path of ["icons/nav-kurd-logo.png", "icons/nav-kurd-icon-512.png", "icons/apple-touch-icon.png"]) {
  existing.set(path, { ...(existing.get(path) ?? {}), path, required: false, warm: true });
}

// UI artwork referenced by About, Support, navigation and native settings is
// part of the one-time offline runtime. This prevents broken placeholders when
// those sections are opened after connectivity has been lost.
const offlineUiAssets = distFiles
  .map((file) => relative(dist, file).split(sep).join("/"))
  .filter((path) => path.startsWith("assets/icons/nav-kurd/")
    || path.startsWith("assets/icons/social/")
    || path.startsWith("assets/promo/")
    || path.startsWith("assets/support/")
    || path.startsWith("assets/native/")
    || path.startsWith("legal/")
    || path === "assets/android-brand.jpg"
    || path === "assets/nav-kurd-logo.png"
    || path === "icons/nav-kurd-logo.png");
for (const path of offlineUiAssets) {
  existing.set(path, {
    ...(existing.get(path) ?? {}),
    path,
    required: false,
    warm: true,
    offlineRuntime: true,
  });
}

manifest.schema = "NAV KURD Offline Runtime Manifest v2";
manifest.release = release.appVersion;
manifest.mapEdition = release.mapEdition;
manifest.mapDataVersion = release.mapDataVersion;
manifest.cacheSchemaVersion = release.cacheSchemaVersion;
manifest.offlinePackVersion = release.offlinePackVersion;
manifest.generatedAt = new Date().toISOString();
const sortedAssets = [...existing.values()].sort((a, b) => a.path.localeCompare(b.path));
const materializedAssets = [];
for (const entry of sortedAssets) {
  try {
    const info = await stat(resolve(dist, entry.path));
    materializedAssets.push({ ...entry, bytes: info.size });
  } catch (error) {
    if (entry.required || error?.code !== "ENOENT") throw error;
    // Canonical source/audit catalogs can stay protected in public/ while the
    // production dist contains only their bounded runtime derivatives.
  }
}
manifest.assets = materializedAssets;

// `offline-manifest.json` is itself part of the atomic shell. Its size must
// describe the manifest being written, not the older copy from `public/` that
// Vite placed in `dist/`. Resolve the self-reference before the manifest and
// service-worker catalog are finalized. The serialized length converges as
// soon as the decimal width of the byte count is stable.
const manifestEntry = manifest.assets.find((entry) => entry.path === "offline-manifest.json");
if (!manifestEntry) throw new Error("Offline runtime manifest must inventory itself.");
let manifestJson = "";
for (let attempt = 0; attempt < 8; attempt += 1) {
  manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const serializedBytes = Buffer.byteLength(manifestJson);
  if (manifestEntry.bytes === serializedBytes) break;
  manifestEntry.bytes = serializedBytes;
}
manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
if (manifestEntry.bytes !== Buffer.byteLength(manifestJson)) {
  throw new Error("Offline runtime manifest size did not converge.");
}

const requiredAssets = manifest.assets.filter((entry) => entry.required);
const requiredBytes = requiredAssets.reduce((sum, entry) => sum + entry.bytes, 0);
if (requiredAssets.length > 16) throw new Error(`Atomic shell has too many required files: ${requiredAssets.length}.`);
if (requiredBytes > 3.5 * 1024 * 1024) throw new Error(`Atomic shell exceeds 3.5 MiB: ${requiredBytes} bytes.`);
for (const entry of requiredAssets) await stat(resolve(dist, entry.path));

await writeFile(manifestPath, manifestJson);
let sw = await readFile(swPath, "utf8");
const replacements = new Map([
  ["__KRI_RELEASE_ID__", release.serviceWorkerRelease],
  ["__KRI_CACHE_SCHEMA__", String(release.cacheSchemaVersion)],
  ["__KRI_MAP_DATA_VERSION__", release.mapDataVersion],
  ["__KRI_OFFLINE_PACK_VERSION__", release.offlinePackVersion],
  ["__KRI_PRECACHE__", JSON.stringify(manifest.assets)]
]);
for (const [placeholder, value] of replacements) sw = sw.replace(placeholder, value);
for (const placeholder of replacements.keys()) {
  if (sw.includes(placeholder)) throw new Error(`Service worker placeholder was not fully replaced: ${placeholder}`);
}
await writeFile(swPath, sw);
console.log(`Offline runtime prepared for release ${release.appVersion}: ${requiredAssets.length} atomic assets / ${(requiredBytes / 1048576).toFixed(2)} MiB, ${manifest.assets.length} catalog assets, cache schema ${release.cacheSchemaVersion}.`);
