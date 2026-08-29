#!/usr/bin/env node
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = resolve(ROOT, "dist");
const releasePath = resolve(dist, "releases/latest.json");
const metadata = JSON.parse(await readFile(releasePath, "utf8"));

// Native shells must never embed the standalone installer inside their own
// assets. Their platform update flow remains available through APKPure/store
// metadata, while the canonical website retains the verified direct binary.
await rm(resolve(dist, "downloads"), { recursive: true, force: true });
metadata.directApkAvailable = false;
metadata.directApkUrl = null;
delete metadata.apkBytes;
delete metadata.apkSha256;
await writeFile(releasePath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log("Prepared native web assets without recursively embedded installers.");
