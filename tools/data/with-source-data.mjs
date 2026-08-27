#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const argv = process.argv.slice(2);
const shouldSync = argv[0] === "--sync";
if (shouldSync) argv.shift();
const [command, ...args] = argv;
if (!command) {
  throw new Error("Usage: with-source-data.mjs [--sync] <command> [...args]");
}

function resolveCommand(cmd, commandArgs) {
  if (process.platform !== "win32") {
    return { executable: cmd, args: commandArgs };
  }

  const normalized = cmd.toLowerCase();
  if (normalized === "npm" && process.env.npm_execpath) {
    return {
      executable: process.execPath,
      args: [process.env.npm_execpath, ...commandArgs],
    };
  }

  if (normalized === "npm" || normalized === "npx") {
    return { executable: `${cmd}.cmd`, args: commandArgs };
  }

  return { executable: cmd, args: commandArgs };
}

const run = (cmd, commandArgs) => new Promise((ok, fail) => {
  const resolved = resolveCommand(cmd, commandArgs);
  const child = spawn(resolved.executable, resolved.args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  child.on("error", fail);
  child.on("close", (code) => code === 0
    ? ok()
    : fail(new Error(`${cmd} exited ${code}`)));
});

const digest = (body) => createHash("sha256").update(body).digest("hex");
const sourceManifestPath = resolve(root, "data-src/source-data-manifest.json");
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const protectedSourcePaths = [
  "data-src/source-data-manifest.json",
  ...sourceManifest.entries.map((entry) => entry.source),
];

async function sourceSnapshot() {
  const snapshot = new Map();
  for (const relative of protectedSourcePaths) {
    snapshot.set(relative, digest(await readFile(resolve(root, relative))));
  }
  return snapshot;
}

function assertUnchanged(before, after) {
  const changed = [];
  for (const [relative, hash] of before) {
    if (after.get(relative) !== hash) changed.push(relative);
  }
  if (changed.length) {
    throw new Error(
      `Normal release preparation mutated canonical source data. ` +
      `Use the explicit --sync maintenance mode only after reviewing data changes: ${changed.join(", ")}`,
    );
  }
}

const before = await sourceSnapshot();
let failure;
let commandCompleted = false;
try {
  await run(process.execPath, ["tools/data/source-data-stage.mjs", "stage"]);
  await run(command, args);
  if (shouldSync) {
    await run(process.execPath, ["tools/data/source-data-stage.mjs", "sync"]);
  } else {
    assertUnchanged(before, await sourceSnapshot());
  }
  commandCompleted = true;
} catch (error) {
  failure = error;
} finally {
  try {
    await run(process.execPath, ["tools/data/source-data-stage.mjs", "unstage"]);
  } catch (error) {
    failure ||= error;
  }
}

if (failure) throw failure;
if (!commandCompleted) throw new Error("Source-data wrapped command did not complete.");
console.log(`PASS source-data wrapper mode: ${shouldSync ? "explicit-sync" : "read-only-build"}`);
