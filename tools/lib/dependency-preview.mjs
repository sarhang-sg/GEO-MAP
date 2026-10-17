import { sha256 } from "./project.mjs";

const versionFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function dependencyDefinitionHash(value) {
  const stable = structuredClone(value);
  for (const field of versionFields) {
    if (!stable[field]) continue;
    for (const name of Object.keys(stable[field])) stable[field][name] = "<version>";
  }
  return sha256(Buffer.from(JSON.stringify(stable)));
}

export function previewPolicy(packageJson, lock) {
  if (!lock.packages?.[""]) throw new Error("Dependency lock has no root package.");
  return {
    packageDefinitionSha256: dependencyDefinitionHash(packageJson),
    lockRootDefinitionSha256: dependencyDefinitionHash(lock.packages[""])
  };
}
