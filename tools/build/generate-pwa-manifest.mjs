#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_APP_ID,
  CANONICAL_ORIGIN,
  DISPLAY_OVERRIDE,
  EDGE_SIDE_PANEL,
  MANIFEST_ID,
  MANIFEST_SCOPE,
  MANIFEST_START_URL,
  SCOPE_EXTENSIONS
} from "./pwa-manifest-contract.mjs";
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
manifest.display_override = [...DISPLAY_OVERRIDE];
manifest.edge_side_panel = { ...EDGE_SIDE_PANEL };
manifest.scope_extensions = SCOPE_EXTENSIONS.map((entry) => ({ ...entry }));
manifest.related_applications = [{ platform: "webapp", url: `${CANONICAL_ORIGIN}/manifest.webmanifest`, id: CANONICAL_APP_ID }];
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
