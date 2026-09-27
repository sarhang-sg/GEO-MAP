#!/usr/bin/env node
// Dependabot changes resolved versions. Validate the committed source first,
// then prepare a local manifest for this one preview build only.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { ROOT, assert, sha256 } from "../lib/project.mjs";
import { previewPolicy } from "../lib/dependency-preview.mjs";
import { releaseContent } from "../lib/release-content.mjs";

const isPreview = process.env.VERCEL_ENV === "preview"
  && /^dependabot\/npm_and_yarn\//u.test(process.env.VERCEL_GIT_COMMIT_REF || "");
const isDependabotPr = process.env.GITHUB_EVENT_NAME === "pull_request"
  && /^dependabot\/npm_and_yarn\//u.test(process.env.GITHUB_HEAD_REF || "");
if (!isPreview && !isDependabotPr) process.exit(0);

const path = "RELEASE_MANIFEST.json";
const baselineBytes = await readFile(path);
const baseline = JSON.parse(baselineBytes);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const policy = previewPolicy(pkg, lock);
assert(baseline.dependencyPreview?.packageDefinitionSha256 === policy.packageDefinitionSha256,
  "Dependency preview altered package scripts, fields, names or security overrides.");
assert(baseline.dependencyPreview?.lockRootDefinitionSha256 === policy.lockRootDefinitionSha256,
  "Dependency preview altered lockfile root configuration or dependency names.");
assert(pkg.version === baseline.version && lock.version === baseline.version,
  "Dependency preview changed the application release identity.");
let updated = false;
try {
  execFileSync(process.execPath, ["tools/release/generate-release-manifest.mjs"], { cwd: ROOT, stdio: "inherit" });
  updated = true;
  const candidate = JSON.parse(await readFile(path, "utf8"));
  // Vercel may serialize vercel.json in its build sandbox without changing
  // its configuration. Keep the pinned Git source entry in this preview-only
  // manifest, using the same validation as the production release verifier.
  const originalConfig = baseline.files["vercel.json"];
  const builtConfig = candidate.files["vercel.json"];
  assert(originalConfig && builtConfig, "Dependency preview is missing vercel.json.");
  if (JSON.stringify(builtConfig) !== JSON.stringify(originalConfig)) {
    const trusted = releaseContent("vercel.json", await readFile("vercel.json"), originalConfig, ROOT);
    assert(trusted === null || (trusted.length === originalConfig.bytes && sha256(trusted) === originalConfig.sha256),
      "Dependency preview changed protected source: vercel.json");
    candidate.files["vercel.json"] = originalConfig;
    candidate.totalBytes += originalConfig.bytes - builtConfig.bytes;
    await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`);
  }
  assert(candidate.fileCount === baseline.fileCount, "Dependency preview changed the source inventory.");
  assert(candidate.release === baseline.release && candidate.mapDataVersion === baseline.mapDataVersion,
    "Dependency preview changed the map or release identity.");
  for (const [name, entry] of Object.entries(baseline.files)) {
    if (name === "package.json" || name === "package-lock.json") continue;
    assert(JSON.stringify(candidate.files[name]) === JSON.stringify(entry), `Dependency preview changed protected source: ${name}`);
  }
  assert(sha256(Buffer.from(JSON.stringify(candidate.dependencyPreview))) === sha256(Buffer.from(JSON.stringify(policy))),
    "Dependency preview policy changed during manifest generation.");
  execFileSync(process.execPath, ["tools/verify/release.mjs"], { cwd: ROOT, stdio: "inherit" });
  execFileSync(process.execPath, ["tools/verify/dependency-security.mjs"], { cwd: ROOT, stdio: "inherit" });
  console.log("PASS Dependabot version-only preview; production release manifest is unchanged.");
} catch (error) {
  if (updated) await writeFile(path, baselineBytes);
  throw error;
}
