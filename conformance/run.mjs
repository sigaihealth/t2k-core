import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateReferenceReplay,
  evaluateReferenceReward,
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

const trustVectors = JSON.parse(
  await fs.readFile(
    path.join(root, "vectors/trust-hardening-v1.json"),
    "utf8"
  )
);
assert.equal(
  trustVectors.vectorType,
  "t2k.trust-hardening-conformance",
  "trust-hardening vectors must declare their contract"
);
const minimalTemplate = JSON.parse(
  await fs.readFile(path.join(root, "valid/minimal.json"), "utf8")
);
for (const vector of trustVectors.deploymentCompilation) {
  const manifests = vector.versions.map((version) => ({
    ...structuredClone(minimalTemplate),
    ontologyId: vector.ontologyId,
    ontologyVersion: version.ontologyVersion,
    label: `${vector.name} ${version.ontologyVersion}`,
    status: version.status,
  }));
  const result = compileOntologyPackSet({
    manifests,
    roots: [{ ontologyId: vector.ontologyId, version: vector.rootVersion }],
    mode: "deployment",
  });
  assert.equal(result.status, vector.expectedStatus, vector.name);
  if (vector.expectedOntologyVersion) {
    assert.equal(result.packs[0]?.ontologyVersion, vector.expectedOntologyVersion);
  }
  if (vector.expectedDiagnostic) {
    assert.ok(
      result.diagnostics.some((item) => item.code === vector.expectedDiagnostic),
      `${vector.name} must report ${vector.expectedDiagnostic}`
    );
  }
}

for (const vector of trustVectors.replayEpisodeIdentity) {
  assert.throws(
    () =>
      evaluateReferenceReplay({
        candidateSpecification: trustVectors.replaySpecification,
        baselineSpecification: trustVectors.replaySpecification,
        episodes: vector.episodes,
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes(vector.expectedErrorContains),
    vector.name
  );
}

for (const vector of trustVectors.rewardEvaluation) {
  if (vector.expectedErrorContains) {
    assert.throws(
      () =>
        evaluateReferenceReward({
          rewardSpec: vector.rewardSpec,
          observations: vector.observations,
          evidenceMode: vector.evidenceMode,
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes(vector.expectedErrorContains),
      vector.name
    );
    continue;
  }
  const result = evaluateReferenceReward({
    rewardSpec: vector.rewardSpec,
    observations: vector.observations,
    evidenceMode: vector.evidenceMode,
  });
  assert.equal(result.lifecycleStatus, vector.expectedLifecycleStatus, vector.name);
  assert.ok(
    result.dimensions[0]?.explanation.includes(
      vector.expectedExplanationContains
    ),
    vector.name
  );
}

const boundStructuredMapping = {
  ...structuredClone(structuredManifest.sourceMappings[0]),
  ...trustVectors.sourceBinding.selectors,
};
for (const vector of trustVectors.sourceBinding.cases) {
  const result = executeSourceMapping({
    mapping: boundStructuredMapping,
    envelope: { ...structuredEnvelope, ...vector.overrides },
  });
  assert.equal(result.receipt.status, vector.expectedStatus, vector.name);
  if (vector.expectedIssue) {
    assert.ok(
      result.receipt.issues.some((item) => item.code === vector.expectedIssue),
      `${vector.name} must report ${vector.expectedIssue}`
    );
  }
}

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
  `T2K conformance passed: ${validFiles.length} valid, ${invalidFiles.length} schema-invalid, ${compilerInvalidFiles.length} compiler-invalid, ${trustVectors.deploymentCompilation.length + trustVectors.replayEpisodeIdentity.length + trustVectors.rewardEvaluation.length + trustVectors.sourceBinding.cases.length} language-neutral trust vectors, deterministic hashes and governed source execution verified.`
);
