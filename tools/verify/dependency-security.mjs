#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { assert } from "../lib/project.mjs";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const expected = {
  nanoid: "3.3.18",
  postcss: "8.5.26",
};
const expectedTooling = {
  typescript: "5.9.3",
};
const requiredAndroidBindings = [
  "@rolldown/binding-android-arm64",
  "lightningcss-android-arm64",
];

for (const [name, version] of Object.entries(expected)) {
  assert(pkg.overrides?.[name] === version, `Missing exact security override ${name}@${version}.`);
  const entry = lock.packages?.[`node_modules/${name}`];
  assert(entry?.version === version, `package-lock resolved ${name}@${entry?.version ?? "missing"}; expected ${version}.`);
}

for (const [name, version] of Object.entries(expectedTooling)) {
  assert(pkg.devDependencies?.[name] === version, `Missing exact toolchain pin ${name}@${version}.`);
  const entry = lock.packages?.[`node_modules/${name}`];
  assert(entry?.version === version, `package-lock resolved ${name}@${entry?.version ?? "missing"}; expected ${version}.`);
}

for (const name of requiredAndroidBindings) {
  assert(lock.packages?.[`node_modules/${name}`], `package-lock is missing Android/Termux binding ${name}.`);
}

const unsupportedTypeScriptNativePackage = Object.keys(lock.packages ?? {})
  .find((name) => name.startsWith("node_modules/@typescript/typescript-"));
assert(!unsupportedTypeScriptNativePackage, `Unsupported native TypeScript package remains: ${unsupportedTypeScriptNativePackage}.`);

console.log(
  `PASS dependency pins: ${[
    ...Object.entries(expected),
    ...Object.entries(expectedTooling),
  ].map(([name, version]) => `${name}@${version}`).join(", ")}; Android build bindings present.`,
);
