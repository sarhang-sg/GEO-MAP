import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const posixPath = (path) => relative(ROOT, path).split(sep).join("/");

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readText(path) {
  return readFile(resolve(ROOT, path), "utf8");
}

export async function readJson(path) {
  return JSON.parse(await readText(path));
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(path) {
  return sha256(await readFile(resolve(ROOT, path)));
}

export async function fileMeta(path) {
  const absolute = resolve(ROOT, path);
  const info = await stat(absolute);
  return { path: posixPath(absolute), bytes: info.size, sha256: await sha256File(path) };
}

export async function walk(directory = ROOT, options = {}) {
  const excluded = new Set(options.excludeDirectories ?? [
    ".git", ".vercel", "node_modules", "dist", ".data-inputs", ".build-cache",
    "__pycache__", ".pytest_cache", ".mypy_cache"
  ]);
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory() && excluded.has(entry.name)) continue;
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(resolve(directory));
  return files.sort((a, b) => posixPath(a).localeCompare(posixPath(b)));
}

export async function fileExists(path) {
  try { await stat(resolve(ROOT, path)); return true; } catch { return false; }
}

export async function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(resolve(ROOT, fromFile)), specifier);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".mjs", ".json", ".css"].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx", ".js", ".mjs", ".json", ".css"].map((extension) => resolve(base, `index${extension}`))
  ];
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isFile()) return posixPath(candidate); } catch { /* continue */ }
  }
  return null;
}

export function importSpecifiers(source) {
  const values = new Set();
  const pattern = /(?:\bimport\s+(?:[^"']+?\s+from\s+)?|\bexport\s+[^"']*?\s+from\s+|\bimport\s*\()\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) values.add(match[1]);
  return [...values];
}

export function extension(path) {
  return extname(path).toLocaleLowerCase("en-US");
}
