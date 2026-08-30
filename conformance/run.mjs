import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeSourceMapping,
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
const compilerInvalidFiles = await jsonFiles(
  path.join(root, "compiler-invalid")
);

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

for (const file of compilerInvalidFiles) {
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  const validation = validateOntologyPackManifest(manifest);
  assert.equal(
    validation.valid,
    true,
    `${path.basename(file)} must be schema-valid before compiler checks`
  );
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
  assert.equal(first.status, "invalid", `${path.basename(file)} must fail compilation`);
  assert.equal(
    reordered.status,
    "invalid",
    `${path.basename(file)} must fail reordered compilation`
  );
  assert.equal(
    first.resolutionHash,
    reordered.resolutionHash,
    `${path.basename(file)} must fail deterministically`
  );
}

const structuredManifest = parseOntologyPackManifest(
  JSON.parse(
    await fs.readFile(
      path.join(root, "valid/source-mapping-structured.json"),
      "utf8"
    )
  )
);
assert.ok(structuredManifest, "structured source fixture must parse");
const structuredPayload = {
  record_id: "RECORD-001",
  person_id: " person-001 ",
  name: "  Synthetic   Person ",
  event_time: "2026-08-29T16:00:00.000Z",
  observed_time: "2026-08-29T16:00:05.000Z",
};
const structuredEnvelope = {
  sourceSystem: "synthetic-conformance-api",
  sourceLocator: "synthetic://conformance/person-api/RECORD-001",
  sourceRecordKey: "RECORD-001",
  sourceSchemaVersion: "person-v1",
  payload: structuredPayload,
  eventTime: structuredPayload.event_time,
  observedTime: structuredPayload.observed_time,
  authenticationState: "system_asserted",
  authorityRef: "synthetic_person_api",
  dataClassification: "synthetic_restricted",
  purposeTags: ["conformance"],
  retentionPolicy: { policyId: "synthetic" },
};
const structuredResult = executeSourceMapping({
  mapping: structuredManifest.sourceMappings[0],
  envelope: structuredEnvelope,
});
assert.equal(structuredResult.receipt.status, "mapped");
assert.deepEqual(structuredResult.canonicalRecord.identity, {
  person_id: "PERSON-001",
});

const legacyManifest = parseOntologyPackManifest(
  JSON.parse(
    await fs.readFile(
      path.join(root, "valid/source-mapping-legacy.json"),
      "utf8"
    )
  )
);
assert.ok(legacyManifest, "legacy source fixture must parse");
const legacyResult = executeSourceMapping({
  mapping: legacyManifest.sourceMappings[0],
  envelope: structuredEnvelope,
});
assert.equal(legacyResult.receipt.status, "rejected");
assert.ok(
  legacyResult.receipt.issues.some(
    (item) => item.code === "source_mapping_not_executable"
  )
);

const duplicateManifest = parseOntologyPackManifest(
  JSON.parse(
    await fs.readFile(
      path.join(root, "compiler-invalid/duplicate-source-mapping-target.json"),
      "utf8"
    )
  )
);
assert.ok(duplicateManifest, "duplicate source fixture must parse");
const duplicateMapping = structuredClone(duplicateManifest.sourceMappings[0]);
duplicateMapping.fieldMappings[1].targetProperty = "person_id";
const duplicateResult = executeSourceMapping({
  mapping: duplicateMapping,
  envelope: {
    ...structuredEnvelope,
    payload: {
      ...structuredPayload,
      alternate_person_id: "PERSON-999",
    },
  },
});
assert.equal(duplicateResult.receipt.status, "rejected");
assert.deepEqual(duplicateResult.canonicalRecord.identity, {});
assert.ok(
  duplicateResult.receipt.issues.some(
    (item) => item.code === "duplicate_target_property_mapping"
  )
);

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
  `T2K conformance passed: ${validFiles.length} valid, ${invalidFiles.length} schema-invalid, ${compilerInvalidFiles.length} compiler-invalid, deterministic hashes and governed source execution verified.`
);
