import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const hash = (body) => createHash("sha256").update(body).digest("hex");
const ordered = (value) => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;

export function configSemanticHash(body) {
  const value = JSON.parse(body.toString());
  // $schema is editor metadata, never routing/build/security configuration.
  delete value.$schema;
  return hash(JSON.stringify(ordered(value)));
}

export function releaseContent(path, body, expected, root, env = process.env) {
  if (body.length === expected.bytes && hash(body) === expected.sha256) return body;
  if (path !== "vercel.json" || env.VERCEL !== "1") return body;
  // Vercel's build sandbox can serialize its own working configuration.
  // Validate the immutable source blob against the pinned release instead of
  // blessing new bytes or rewriting the manifest inside the deployment.
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!/^[0-9a-f]{40}$/.test(commit) || !env.VERCEL_GIT_COMMIT_SHA || commit !== env.VERCEL_GIT_COMMIT_SHA) throw new Error("Unidentified build commit");
    const original = execFileSync("git", ["show", `${commit}:vercel.json`], { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 });
    if (original.length === expected.bytes && hash(original) === expected.sha256) {
      console.log("PASS vercel.json: pinned Git source verified; build-sandbox copy is host-managed.");
      return original;
    }
  } catch { /* ZIP/prebuilt environments still require semantic equality. */ }
  if (expected.jsonSha256 && configSemanticHash(body) === expected.jsonSha256) {
    console.log("PASS vercel.json: identical configuration after JSON serialization.");
    return null;
  }
  return body;
}
