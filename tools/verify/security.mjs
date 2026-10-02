#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, assert, posixPath, readJson, readText, walk } from "../lib/project.mjs";

const vercel = await readJson("vercel.json");
const catchAll = vercel.headers?.find((entry) => entry.source === "/(.*)");
const headers = new Map((catchAll?.headers ?? []).map((entry) => [entry.key.toLocaleLowerCase("en-US"), entry.value]));
for (const name of [
  "content-security-policy", "strict-transport-security", "x-content-type-options",
  "referrer-policy", "permissions-policy", "cross-origin-opener-policy", "cross-origin-resource-policy"
]) assert(headers.has(name), `Missing security header: ${name}`);
const csp = headers.get("content-security-policy") ?? "";
for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "upgrade-insecure-requests"])
  assert(csp.includes(directive), `CSP missing ${directive}`);
assert(vercel.headers?.some((entry) => entry.source === "/api/(.*)"), "API no-store/security policy is missing.");

const files = await walk(ROOT);
const secretPatterns = [
  /\bservice_role\b\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/iu,
  /\b(?:sk_live|sk_test)_[A-Za-z0-9]{20,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bghp_[A-Za-z0-9]{30,}\b/u
];
const secretHits = [];
for (const file of files) {
  const path = posixPath(file);
  if (/\.(?:png|jpe?g|webp|gif|ttf|woff2?|pmtiles|zip)$/iu.test(path)) continue;
  if (path === ".env.example") continue;
  const body = await readFile(file, "utf8").catch(() => "");
  for (const pattern of secretPatterns) if (pattern.test(body)) secretHits.push(path);
}
assert(secretHits.length === 0, `Potential committed secrets:\n${[...new Set(secretHits)].join("\n")}`);

const sqlFiles = (await walk(resolve(ROOT, "supabase/migrations"))).filter((path) => path.endsWith(".sql"));
const sql = (await Promise.all(sqlFiles.map((path) => readFile(path, "utf8")))).join("\n").toLocaleLowerCase("en-US");
const publicTables = [...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/gu)].map((match) => match[1]);
for (const table of new Set(publicTables)) {
  assert(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "u").test(sql), `RLS is not enabled for public.${table}`);
}
const securityDefiners = (sql.match(/security\s+definer/gu) ?? []).length;
const searchPaths = (sql.match(/set\s+search_path\s*=/gu) ?? []).length;
assert(searchPaths >= securityDefiners, "One or more SECURITY DEFINER functions lack an explicit search_path.");
assert(!sql.includes("grant all on schema public to anon"), "Anonymous broad schema grant detected.");


const pkg = await readJson("package.json");
const lock = await readJson("package-lock.json");
assert(lock.lockfileVersion === 3, "package-lock.json must use lockfile version 3.");
const lockRoot = lock.packages?.[""];
assert(lockRoot?.name === pkg.name && lockRoot?.version === pkg.version, "Package lock root identity mismatch.");
for (const field of ["dependencies", "devDependencies"]) {
  const declared = pkg[field] ?? {};
  const locked = lockRoot?.[field] ?? {};
  assert(JSON.stringify(declared) === JSON.stringify(locked), `package-lock root ${field} differs from package.json.`);
  for (const [name, range] of Object.entries(declared)) {
    assert(typeof range === "string" && !/^(?:latest|\*|file:|git(?:\+|:)|https?:)/iu.test(range), `Unpinned or non-registry dependency declaration: ${name}@${range}`);
  }
}
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  const resolved = typeof entry?.resolved === "string" ? entry.resolved : "";
  assert(!/^http:/iu.test(resolved), `Insecure dependency transport in lockfile: ${path}`);
  assert(!/^(?:git(?:\+|:)|file:)/iu.test(resolved), `Non-registry dependency source in lockfile: ${path}`);
  if (entry?.integrity !== undefined) assert(/^sha512-[A-Za-z0-9+/=]+$/u.test(entry.integrity), `Invalid lockfile integrity field: ${path}`);
}

const env = await readText(".env.example");
assert(!/SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY/u.test(env), "Service-role secrets must not be exposed to the client environment.");
console.log(`PASS security: hardened headers/CSP, locked registry dependencies, ${new Set(publicTables).size} RLS tables, ${securityDefiners} SECURITY DEFINER functions with bounded search paths, no committed secrets.`);
