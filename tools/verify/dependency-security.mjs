#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { assert } from "../lib/project.mjs";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const expected = {
  "brace-expansion": "5.0.9",
  nanoid: "3.3.18",
  postcss: "8.5.26",
  tar: "7.5.22",
};

for (const [name, version] of Object.entries(expected)) {
  assert(pkg.overrides?.[name] === version, `Missing exact security override ${name}@${version}.`);
  const entry = lock.packages?.[`node_modules/${name}`];
  assert(entry?.version === version, `package-lock resolved ${name}@${entry?.version ?? "missing"}; expected ${version}.`);
}
console.log(`PASS dependency security pins: ${Object.entries(expected).map(([n,v]) => `${n}@${v}`).join(", ")}`);
