#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_ID, MANIFEST_START_URL, MANIFEST_SCOPE, CANONICAL_APP_ID, CANONICAL_ORIGIN, SCOPE_EXTENSIONS } from "./pwa-manifest-contract.mjs";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestPath = resolve(root, "public/manifest.webmanifest");
const offlinePath = resolve(root, "public/offline-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const offline = JSON.parse(await readFile(offlinePath, "utf8"));
const release = JSON.parse(await readFile(resolve(root, "release.config.json"), "utf8"));
manifest.version = release.appVersion;
manifest.id = MANIFEST_ID;
manifest.start_url = MANIFEST_START_URL;
manifest.scope = MANIFEST_SCOPE;
manifest.scope_extensions = SCOPE_EXTENSIONS.map((entry) => ({ ...entry }));
manifest.related_applications = [{ platform: "webapp", url: `${CANONICAL_ORIGIN}/manifest.webmanifest`, id: CANONICAL_APP_ID }];
if (Array.isArray(manifest.widgets) && manifest.widgets[0]) {
  manifest.widgets[0].ms_ac_template = `${CANONICAL_ORIGIN}/widgets/nav-kurd-atlas-template.json`;
  manifest.widgets[0].data = `${CANONICAL_ORIGIN}/widgets/nav-kurd-atlas-data.json`;
  manifest.widgets[0].multiple = false;
}
const iarc = process.env.NAV_KURD_IARC_RATING_ID?.trim() || "";
if (iarc) {
  if (!/^[A-Za-z0-9._:-]{6,160}$/u.test(iarc)) throw new Error("NAV_KURD_IARC_RATING_ID has an invalid format.");
  manifest.iarc_rating_id = iarc;
} else delete manifest.iarc_rating_id;
offline.release = release.appVersion;
offline.mapEdition = release.mapEdition;
offline.mapDataVersion = release.mapDataVersion;
offline.cacheSchemaVersion = release.cacheSchemaVersion;
offline.offlinePackVersion = release.offlinePackVersion;
await Promise.all([
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(offlinePath, `${JSON.stringify(offline, null, 2)}\n`),
]);
console.log(`PWA/offline manifests normalized for ${release.appVersion}${iarc ? " with verified IARC ID" : " without an invented IARC ID"}.`);
