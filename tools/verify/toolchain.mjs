#!/usr/bin/env node
const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) throw new Error(`Node.js 24.x is required; current runtime is ${process.versions.node}.`);
if (process.argv.includes("--require-npm")) {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const npmMajor = Number(/npm\/(\d+)/u.exec(userAgent)?.[1] ?? 0);
  if (npmMajor !== 11) throw new Error(`npm 11.x is required; detected ${userAgent || "unknown npm"}.`);
}
console.log(`PASS toolchain: Node ${process.versions.node}.`);
