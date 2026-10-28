#!/usr/bin/env node
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const atlasDir = resolve(root, "public/assets/icons/atlas");
const manifestPath = resolve(atlasDir, "manifest.json");
const outputPath = resolve(atlasDir, "bundle.json");
const groupsDir = resolve(atlasDir, "groups");
const groupManifestPath = resolve(atlasDir, "groups-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.items) || manifest.items.length < 400) {
  throw new Error("Atlas icon manifest is incomplete.");
}

const icons = {};
const grouped = new Map();
for (const item of manifest.items) {
  if (!item?.id || !item?.asset || !item?.group) throw new Error("Atlas icon manifest contains an invalid item.");
  const svg = await readFile(resolve(root, "public", item.asset), "utf8");
  if (!/^<\?xml[\s\S]*<svg\b/u.test(svg) || !svg.includes("</svg>")) {
    throw new Error(`Atlas icon SVG is invalid: ${item.asset}`);
  }
  icons[item.id] = svg;
  const bucket = grouped.get(item.group) ?? {};
  bucket[item.id] = svg;
  grouped.set(item.group, bucket);
}

const canonical = JSON.stringify(icons);
const payload = {
  schema: "NAV KURD Atlas Icon Bundle v1",
  count: Object.keys(icons).length,
  generatedAt: manifest.generatedAt,
  sha256: createHash("sha256").update(canonical).digest("hex"),
  icons
};
await writeFile(outputPath, `${JSON.stringify(payload)}\n`);

await rm(groupsDir, { recursive: true, force: true });
await mkdir(groupsDir, { recursive: true });
const groupManifest = {
  schema: "NAV KURD Atlas Icon Group Manifest v1",
  count: payload.count,
  generatedAt: manifest.generatedAt,
  groups: {},
  icons: {}
};
for (const [group, groupIcons] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const groupCanonical = JSON.stringify(groupIcons);
  const groupPayload = {
    schema: "NAV KURD Atlas Icon Group Bundle v1",
    group,
    count: Object.keys(groupIcons).length,
    sha256: createHash("sha256").update(groupCanonical).digest("hex"),
    icons: groupIcons
  };
  const file = `groups/${group}.json`;
  const raw = `${JSON.stringify(groupPayload)}\n`;
  await writeFile(resolve(atlasDir, file), raw);
  groupManifest.groups[group] = {
    file: `assets/icons/atlas/${file}`,
    count: groupPayload.count,
    bytes: Buffer.byteLength(raw),
    sha256: createHash("sha256").update(raw).digest("hex")
  };
  for (const id of Object.keys(groupIcons)) groupManifest.icons[id] = group;
}
await writeFile(groupManifestPath, `${JSON.stringify(groupManifest)}\n`);
console.log(`Generated atlas icon fallback bundle plus ${Object.keys(groupManifest.groups).length} lazy group bundles for ${payload.count} SVG assets.`);
