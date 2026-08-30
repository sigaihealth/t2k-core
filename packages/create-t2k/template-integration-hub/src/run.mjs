import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeSourceMapping,
  reconcileCanonicalRecords,
  validateOntologyPackManifest,
} from "@t2kai/core";
import {
  compileOntologyPackSet,
  compareCanonicalStrings,
  semanticHash,
} from "@t2kai/core/compiler";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadPackageManifest = createRequire(import.meta.url);

async function readJson(relativePath) {
  const contents = await fs.readFile(path.join(root, relativePath), "utf8");
  try {
    return JSON.parse(contents);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new SyntaxError(`Invalid JSON in ${relativePath}${detail}`, {
      cause: error,
    });
  }
}

async function readSourceRecords() {
  const sourceDirectory = path.join(root, "source-records");
  const sourceFiles = (await fs.readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".json")
    .map((entry) => entry.name)
    .sort(compareCanonicalStrings);

  assert.ok(
    sourceFiles.length >= 2,
    "The integration-hub profile requires at least two source-records/*.json files."
  );

  return Promise.all(
    sourceFiles.map((sourceFile) =>
      readJson(path.posix.join("source-records", sourceFile))
    )
  );
}

const manifest = await readJson("ontology-pack.json");
const authorityPolicy = await readJson("authority-policy.json");
const sourceRecords = await readSourceRecords();
const sourceSnapshot = structuredClone(sourceRecords);
const corePackageManifest = loadPackageManifest("@t2kai/core/package.json");
assert.equal(
  corePackageManifest.name,
  "@t2kai/core",
  "The integration packet must identify the loaded core runtime."
);
assert.ok(
  typeof corePackageManifest.version === "string" &&
    corePackageManifest.version.length > 0,
  "The loaded core runtime must expose an exact package version."
);

const validation = validateOntologyPackManifest(manifest);
assert.equal(
  validation.valid,
  true,
  `Integration-hub manifest failed validation: ${JSON.stringify(validation.errors)}`
);

const compilation = compileOntologyPackSet({
  manifests: [manifest],
  roots: [
    {
      ontologyId: manifest.ontologyId,
      version: manifest.ontologyVersion,
    },
  ],
});
assert.equal(compilation.status, "valid", JSON.stringify(compilation.diagnostics));

const mapping = manifest.sourceMappings.find(
  (candidate) => candidate.id === "synthetic_party_record_v1"
);
assert.ok(mapping, "The integration-hub source mapping is missing.");

const mappedResults = sourceRecords.map((sourceRecord) => {
  const { payload, ...envelopeMetadata } = sourceRecord;
  return executeSourceMapping({
    mapping,
    envelope: {
      ...envelopeMetadata,
      payload: structuredClone(payload),
      contentHash: semanticHash(payload),
    },
  });
});

assert.ok(
  mappedResults.every((result) => result.receipt.status === "mapped"),
  "Every synthetic source record must map successfully."
);
assert.ok(
  mappedResults.every((result) => result.receipt.humanReviewRequired),
  "Every source receipt must retain the explicit human checkpoint."
);
assert.ok(
  mappedResults.every(
    (result) => result.receipt.authenticationState === "unknown"
  ),
  "The synthetic profile must not claim source authentication."
);
assert.equal(
  new Set(mappedResults.map((result) => result.receipt.receiptHash)).size,
  mappedResults.length,
  "Each source record must produce independent receipt-bound evidence."
);
assert.equal(
  new Set(
    mappedResults.map((result) => semanticHash(result.canonicalRecord.identity))
  ).size,
  1,
  "Every discovered source record must map to one shared canonical identity."
);
assert.ok(
  Object.keys(mappedResults[0].canonicalRecord.identity).length > 0,
  "The shared canonical identity must not be empty."
);
assert.deepEqual(sourceRecords, sourceSnapshot, "Source mapping mutated its input.");

const mappedSnapshot = structuredClone(mappedResults);
const reconciliation = reconcileCanonicalRecords({
  results: mappedResults,
  authorityPolicy,
});
const reverseOrderReconciliation = reconcileCanonicalRecords({
  results: [...mappedResults].reverse(),
  authorityPolicy,
});
assert.deepEqual(
  mappedResults,
  mappedSnapshot,
  "Canonical reconciliation mutated mapped source evidence."
);
assert.equal(reconciliation.status, "needs_review");
assert.equal(reconciliation.humanReviewRequired, true);
assert.equal(reconciliation.nonMutating, true);
assert.equal(reconciliation.alternativesPreserved, true);
assert.equal(
  reconciliation.proposalHash,
  reverseOrderReconciliation.proposalHash,
  "Reconciliation must be deterministic across source input order."
);

const preserveAllField = reconciliation.fields.find(
  (field) =>
    field.conflictPolicy === "preserve_all" &&
    field.resolution === "preserve_all"
);
const preferAuthorityField = reconciliation.fields.find(
  (field) =>
    field.conflictPolicy === "prefer_authority" &&
    field.resolution === "preferred_authority"
);
assert.ok(
  preserveAllField,
  "At least one conflicting field must exercise preserve_all reconciliation."
);
assert.equal(preserveAllField.selectedValue, null);
assert.ok(preserveAllField.candidates.length >= 2);
assert.ok(
  preferAuthorityField,
  "At least one conflicting field must exercise prefer_authority reconciliation."
);
assert.notEqual(preferAuthorityField.selectedValue, null);
assert.ok(preferAuthorityField.candidates.length >= 2);

const packetWithoutHash = {
  profile: "integration-hub",
  coreRuntime: {
    packageName: corePackageManifest.name,
    packageVersion: corePackageManifest.version,
  },
  ontology: `${manifest.ontologyId}@${manifest.ontologyVersion}`,
  resolutionHash: compilation.resolutionHash,
  authorityPolicy: structuredClone(authorityPolicy),
  sourceEvidence: mappedResults
    .map((result) => ({
      summary: {
        sourceSystem: result.receipt.sourceSystem,
        sourceRecordKey: result.receipt.sourceRecordKey,
        authorityRef: result.receipt.authorityRef,
        authenticationState: result.receipt.authenticationState,
        receiptHash: result.receipt.receiptHash,
        humanReviewRequired: result.receipt.humanReviewRequired,
      },
      canonicalRecord: result.canonicalRecord,
      receipt: result.receipt,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(
        left.receipt.receiptHash,
        right.receipt.receiptHash
      )
    ),
  reconciliation: {
    proposal: reconciliation,
    reverseInputOrderProposal: reverseOrderReconciliation,
    forwardReverseInputOrderCheck: {
      comparisonScope: "forward_and_reverse_input_order_only",
      allPermutationsChecked: mappedResults.length === 2,
      forwardReceiptHashes: mappedResults.map(
        (result) => result.receipt.receiptHash
      ),
      reverseReceiptHashes: [...mappedResults]
        .reverse()
        .map((result) => result.receipt.receiptHash),
      forwardProposalHash: reconciliation.proposalHash,
      reverseProposalHash: reverseOrderReconciliation.proposalHash,
      proposalHashesMatch:
        reconciliation.proposalHash === reverseOrderReconciliation.proposalHash,
    },
  },
  humanReview: {
    status: "pending_human_review",
    proposalOnly: true,
    issues: reconciliation.issues,
  },
  boundaries: {
    syntheticDataOnly: true,
    sourceRecordsMutated: false,
    sourceAuthenticationEstablished: false,
    acceptedTruthCreated: false,
    authoritySelectionIsProposalOnly: true,
    externalAuthenticationAndDispositionRequired: true,
  },
};
const output = {
  ...packetWithoutHash,
  evidencePacketHash: semanticHash(packetWithoutHash),
};

console.log(JSON.stringify(output, null, 2));
