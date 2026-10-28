#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const iconSource = resolve(process.argv[2] ?? "");
const logoSource = resolve(process.argv[3] ?? "");
const outputDirectory = resolve(root, "public/assets/icons/nav-kurd");

const iconFiles = [
  ...Array.from({ length: 15 }, (_, index) => `${index + 1}.png`),
  "profile.png",
  "delete.png",
  "speed-time.png",
  "file_00000000337081f4a240a36663e9481f.png",
];

const outputName = (name) => {
  if (/^\d+\.png$/u.test(name)) return name.replace(".png", "").padStart(2, "0");
  if (name.startsWith("file_")) return "steps";
  return name.replace(".png", "");
};

function svgWithEmbeddedPng(bytes) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254" role="img">',
    `  <image width="1254" height="1254" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${bytes.toString("base64")}"/>`,
    '</svg>',
    '',
  ].join("\n");
}

await mkdir(outputDirectory, { recursive: true });
const manifest = [];
for (const file of iconFiles) {
  const bytes = await readFile(resolve(iconSource, file));
  const name = outputName(file);
  await writeFile(resolve(outputDirectory, `${name}.svg`), svgWithEmbeddedPng(bytes));
  manifest.push({
    name,
    source: basename(file),
    dimensions: "1254x1254",
    format: "lossless embedded PNG in SVG",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

await copyFile(logoSource, resolve(root, "public/assets/nav-kurd-logo.png"));
await copyFile(logoSource, resolve(root, "public/icons/nav-kurd-logo.png"));
await copyFile(logoSource, resolve(root, "public/icons/nav-kurd-logo-source.png"));
await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify({ schema: 1, frame: "1254x1254", icons: manifest }, null, 2)}\n`);

console.log(`Installed ${manifest.length} lossless SVG icons and the NAV KURD blue logo.`);
