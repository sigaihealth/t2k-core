import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseOntologyPackManifest,
  validateOntologyPackManifest,
} from "../packages/core/dist/index.js";
import { compileOntologyPackSet } from "../packages/core/dist/compiler.js";

const root = path.dirname(fileURLToPath(import.meta.url));

async function jsonFiles(directory) {
  return (await fs.readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(directory, name));
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseObjectKeys(item)])
  );
}

const validFiles = await jsonFiles(path.join(root, "valid"));
const invalidFiles = await jsonFiles(path.join(root, "invalid"));

for (const file of validFiles) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  const validation = validateOntologyPackManifest(manifest);
  assert.equal(validation.valid, true, `${path.basename(file)} must be valid`);
  assert.ok(parseOntologyPackManifest(manifest), `${path.basename(file)} must parse`);

  const request = {
    manifests: [manifest],
    roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }],
  };
  const first = compileOntologyPackSet(request);
  const reordered = compileOntologyPackSet({
    ...request,
    manifests: [reverseObjectKeys(manifest)],
  });
  assert.equal(first.status, "valid", `${path.basename(file)} must compile`);
  assert.equal(reordered.status, "valid", `${path.basename(file)} must compile reordered`);
  assert.equal(
    first.resolutionHash,
    reordered.resolutionHash,
    `${path.basename(file)} must hash deterministically`
  );
}

for (const file of invalidFiles) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  const validation = validateOntologyPackManifest(manifest);
  assert.equal(validation.valid, false, `${path.basename(file)} must be invalid`);
  assert.equal(
    parseOntologyPackManifest(manifest),
    null,
    `${path.basename(file)} must not parse through the current dialect`
  );
}

const canonicalSchema = await fs.readFile(
  path.resolve(root, "../schemas/t2k-ontology-pack.v1.schema.json"),
  "utf8"
);
const packageSchema = await fs.readFile(
  path.resolve(root, "../packages/core/src/schema/t2k-ontology-pack.v1.schema.json"),
  "utf8"
);
assert.equal(packageSchema, canonicalSchema, "package and canonical schemas must match byte-for-byte");

console.log(
  `T2K conformance passed: ${validFiles.length} valid, ${invalidFiles.length} invalid, deterministic hashes verified.`
);
