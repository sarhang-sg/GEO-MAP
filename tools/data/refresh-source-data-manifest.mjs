#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const path = "data-src/source-data-manifest.json";
const manifest = JSON.parse(await readFile(path, "utf8"));
const digest = (body) => createHash("sha256").update(body).digest("hex");

for (const entry of manifest.entries) {
  const stored = await readFile(entry.source);
  if (entry.compression === "gzip") {
    const body = gunzipSync(stored);
    entry.bytes = body.length;
    entry.sha256 = digest(body);
    entry.archive_bytes = stored.length;
    entry.archive_sha256 = digest(stored);
  } else {
    entry.bytes = stored.length;
    entry.sha256 = digest(stored);
    delete entry.archive_bytes;
    delete entry.archive_sha256;
  }
}

await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`PASS refreshed source-data manifest: ${manifest.entries.length} files`);
