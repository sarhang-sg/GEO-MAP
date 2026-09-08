#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const release = JSON.parse(await readFile(resolve(ROOT, "release.config.json"), "utf8"));
const metadataPath = resolve(ROOT, "public/releases/latest.json");
const downloadsDirectory = resolve(ROOT, "public/downloads");
const apkName = `NAV-KURD-${release.appVersion}.apk`;
const apkPath = resolve(downloadsDirectory, apkName);
const minimumApkBytes = 10 * 1024 * 1024;
const maximumApkBytes = 95 * 1024 * 1024;

await mkdir(downloadsDirectory, { recursive: true });
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (metadata.version !== release.appVersion) {
  throw new Error("Android release metadata does not match release.config.json.");
}
if (!Number.isSafeInteger(release.androidVersionCode) || release.androidVersionCode < 1) {
  throw new Error("release.config.json has no valid Android version code.");
}
if (metadata.packageName !== "com.navkurd.app") {
  throw new Error("Android release package name is not canonical.");
}

metadata.versionCode = release.androidVersionCode;
metadata.publishedAt = `${release.releaseDate}T00:00:00Z`;

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertApkContainer(path, bytes) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, header.length, 0);
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new Error("Android release is not an APK/ZIP container.");
    }

    const tailLength = Math.min(bytes, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tail.length, bytes - tailLength);
    if (tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0) {
      throw new Error("Android release has no valid ZIP end record.");
    }
  } finally {
    await handle.close();
  }
}

let apkInfo = null;
try {
  apkInfo = await stat(apkPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!apkInfo) {
  metadata.directApkAvailable = false;
  metadata.directApkUrl = null;
  delete metadata.apkBytes;
  delete metadata.apkSha256;
  console.log(`Android direct download disabled: ${apkName} is not embedded.`);
} else {
  if (!apkInfo.isFile() || apkInfo.size < minimumApkBytes || apkInfo.size > maximumApkBytes) {
    throw new Error(`Android release size is unsafe: ${apkInfo.size} bytes.`);
  }
  await assertApkContainer(apkPath, apkInfo.size);
  metadata.directApkAvailable = true;
  metadata.directApkUrl = `/downloads/${apkName}`;
  metadata.apkBytes = apkInfo.size;
  metadata.apkSha256 = await sha256(apkPath);
  console.log(`Android direct download verified: ${apkName} / ${apkInfo.size} bytes / ${metadata.apkSha256}.`);
}

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
