#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const spriteRoot = resolve(root, "public/assets/icons/atlas/runtime-sprite");
const manifestPath = resolve(spriteRoot, "nav-kurd-poi-runtime.json");
const release = JSON.parse(await readFile(resolve(root, "release.config.json"), "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

for (const variant of manifest.variants ?? []) {
  const image = await readFile(resolve(spriteRoot, variant.image));
  const digest = createHash("sha256").update(image).digest("hex");
  if (image.length !== variant.bytes || digest !== variant.sha256) {
    throw new Error(`Runtime sprite integrity mismatch: ${variant.image}`);
  }
}

manifest.release = release.appVersion;
await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
console.log(`PASS runtime sprite metadata: ${release.appVersion}`);
