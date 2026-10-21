#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestPath = resolve(root, "data-src/source-data-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const mode = process.argv[2];

if (!["stage", "sync", "unstage", "verify"].includes(mode)) {
  throw new Error("Usage: source-data-stage.mjs stage|sync|unstage|verify");
}

const digest = (body) => createHash("sha256").update(body).digest("hex");
const exists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

function sourcePath(entry) {
  return resolve(root, entry.source);
}

function stagePath(entry) {
  return resolve(root, entry.stage);
}

async function readCanonicalBody(entry) {
  const storedPath = sourcePath(entry);
  const stored = await readFile(storedPath);

  if (entry.compression === "gzip") {
    if (entry.archive_bytes !== undefined && stored.length !== entry.archive_bytes) {
      throw new Error(`Compressed source byte mismatch: ${entry.source}`);
    }
    if (entry.archive_sha256 && digest(stored) !== entry.archive_sha256) {
      throw new Error(`Compressed source integrity mismatch: ${entry.source}`);
    }
    const body = gunzipSync(stored);
    if (body.length !== entry.bytes || digest(body) !== entry.sha256) {
      throw new Error(`Source data integrity mismatch after gzip decode: ${entry.source}`);
    }
    return body;
  }

  if (stored.length !== entry.bytes || digest(stored) !== entry.sha256) {
    throw new Error(`Source data integrity mismatch: ${entry.source}`);
  }
  return stored;
}

async function writeStoredSource(entry, body) {
  const storedPath = sourcePath(entry);
  await mkdir(dirname(storedPath), { recursive: true });

  entry.bytes = body.length;
  entry.sha256 = digest(body);

  if (entry.compression === "gzip") {
    const archive = Buffer.from(gzipSync(body, { level: 9, mtime: 0 }));
    // Normalize the gzip OS header byte so archives are byte-identical on Linux, macOS and Windows.
    if (archive.length > 9) archive[9] = 255;
    await writeFile(storedPath, archive);
    entry.archive_bytes = archive.length;
    entry.archive_sha256 = digest(archive);
    return;
  }

  await writeFile(storedPath, body);
  delete entry.archive_bytes;
  delete entry.archive_sha256;
}

if (mode === "sync") {
  for (const entry of manifest.entries) {
    const staged = stagePath(entry);
    if (!(await exists(staged))) {
      throw new Error(`Cannot sync missing staged source: ${entry.stage}`);
    }
    await writeStoredSource(entry, await readFile(staged));
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`PASS source-data sync: ${manifest.entries.length} files`);
  process.exit(0);
}

for (const entry of manifest.entries) {
  const staged = stagePath(entry);
  const body = await readCanonicalBody(entry);

  if (mode === "stage") {
    await mkdir(dirname(staged), { recursive: true });
    await writeFile(staged, body);
  }

  if (mode === "unstage") {
    await rm(staged, { force: true });
  }

  if (mode === "verify" && (await exists(staged))) {
    throw new Error(`Source-only data leaked into public: ${entry.stage}`);
  }
}

console.log(`PASS source-data ${mode}: ${manifest.entries.length} files`);
