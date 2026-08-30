import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { semanticHash } from "@t2kai/core/compiler";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const COMPLETE_RECEIPT_FIELDS = [
  "receiptVersion",
  "status",
  "sourceSystem",
  "sourceLocator",
  "sourceRecordKey",
  "sourceSchemaVersion",
  "authenticationState",
  "authorityRef",
  "dataClassification",
  "purposeTags",
  "retentionPolicy",
  "mappingId",
  "mappingVersion",
  "mappingHash",
  "sourcePayloadHash",
  "canonicalOutputHash",
  "idempotencyKey",
  "eventTime",
  "observedTime",
  "lateArrival",
  "duplicate",
  "humanReviewRequired",
  "driftPolicy",
  "lateArrivalPolicy",
  "issues",
  "receiptHash",
];
const COMPLETE_PROPOSAL_FIELDS = [
  "proposalVersion",
  "status",
  "objectRef",
  "identity",
  "fields",
  "policyId",
  "policyVersion",
  "policyHash",
  "inputReceiptHashes",
  "includedReceiptHashes",
  "inputHash",
  "issues",
  "humanReviewRequired",
  "nonMutating",
  "alternativesPreserved",
  "proposalHash",
];

function runIntegrationHubOnce(targetPath) {
  return execFileSync(process.execPath, ["src/run.mjs"], {
    cwd: targetPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertCompleteSourceEvidence(sourceEvidence) {
  for (const evidence of sourceEvidence) {
    assert.ok(evidence.summary, "Source evidence is missing its concise summary.");
    assert.ok(
      evidence.canonicalRecord,
      "Source evidence is missing its complete canonical record."
    );
    assert.equal(typeof evidence.canonicalRecord.objectRef, "string");
    assert.ok(Array.isArray(evidence.canonicalRecord.fields));
    assert.equal(typeof evidence.canonicalRecord.identity, "object");
    assert.ok(evidence.receipt, "Source evidence is missing its complete receipt.");
    for (const field of COMPLETE_RECEIPT_FIELDS) {
      assert.ok(
        Object.hasOwn(evidence.receipt, field),
        `Source evidence receipt is missing ${field}.`
      );
    }
    assert.equal(
      evidence.summary.receiptHash,
      evidence.receipt.receiptHash,
      "The source summary must identify its included complete receipt."
    );
    assert.equal(evidence.receipt.status, "mapped");
    assert.equal(evidence.receipt.authenticationState, "unknown");
    assert.equal(evidence.receipt.humanReviewRequired, true);
    assert.match(evidence.receipt.receiptHash, SHA256_HEX);
    assert.match(evidence.receipt.mappingHash, SHA256_HEX);
    assert.match(evidence.receipt.sourcePayloadHash, SHA256_HEX);
    assert.match(evidence.receipt.canonicalOutputHash, SHA256_HEX);
    assert.equal(
      evidence.receipt.canonicalOutputHash,
      semanticHash(evidence.canonicalRecord),
      "The included canonical record must match its receipt-bound output hash."
    );
    assert.ok(Array.isArray(evidence.receipt.purposeTags));
    assert.ok(Array.isArray(evidence.receipt.issues));
  }
}

function assertCompleteProposal(proposal) {
  assert.ok(
    proposal && typeof proposal === "object" && !Array.isArray(proposal),
    "The complete reconciliation proposal is missing."
  );
  for (const field of COMPLETE_PROPOSAL_FIELDS) {
    assert.ok(
      Object.hasOwn(proposal, field),
      `Reconciliation proposal is missing ${field}.`
    );
  }
  assert.ok(Array.isArray(proposal.fields));
  assert.ok(Array.isArray(proposal.issues));
  assert.match(proposal.proposalHash, SHA256_HEX);
  const { proposalHash, ...proposalWithoutHash } = proposal;
  assert.equal(
    proposalHash,
    semanticHash(proposalWithoutHash),
    "The complete reconciliation proposal must verify against its hash."
  );
}

function reconciliationField(packet, resolution) {
  return packet.reconciliation.proposal.fields.find(
    (field) => field.resolution === resolution
  );
}

function assertIntegrationHubPacket(
  packet,
  expectedSourceCount,
  expectedCoreVersion
) {
  assert.equal(packet.profile, "integration-hub");
  assert.deepEqual(packet.coreRuntime, {
    packageName: "@t2kai/core",
    packageVersion: expectedCoreVersion,
  });
  assert.equal(packet.sourceEvidence?.length, expectedSourceCount);
  assertCompleteSourceEvidence(packet.sourceEvidence);
  assert.ok(packet.authorityPolicy, "The complete authority policy is missing.");

  const proposal = packet.reconciliation?.proposal;
  const reverseProposal = packet.reconciliation?.reverseInputOrderProposal;
  const orderCheck = packet.reconciliation?.forwardReverseInputOrderCheck;
  assertCompleteProposal(proposal);
  assertCompleteProposal(reverseProposal);
  assert.deepEqual(
    proposal,
    reverseProposal,
    "Forward and reverse inputs must produce the same complete proposal."
  );
  assert.equal(proposal.identity?.party_id, "SHARED-0042");
  assert.equal(proposal.policyHash, semanticHash(packet.authorityPolicy));
  assert.equal(proposal.humanReviewRequired, true);
  assert.equal(proposal.nonMutating, true);
  assert.equal(proposal.alternativesPreserved, true);
  const evidenceReceiptHashes = packet.sourceEvidence
    .map(({ receipt }) => receipt.receiptHash)
    .sort();
  assert.deepEqual([...proposal.inputReceiptHashes].sort(), evidenceReceiptHashes);
  assert.deepEqual(
    [...proposal.includedReceiptHashes].sort(),
    evidenceReceiptHashes
  );

  assert.equal(orderCheck?.comparisonScope, "forward_and_reverse_input_order_only");
  assert.equal(orderCheck?.allPermutationsChecked, expectedSourceCount === 2);
  assert.equal(orderCheck?.proposalHashesMatch, true);
  assert.equal(orderCheck?.forwardProposalHash, proposal.proposalHash);
  assert.equal(orderCheck?.reverseProposalHash, reverseProposal.proposalHash);
  assert.equal(orderCheck?.forwardReceiptHashes?.length, expectedSourceCount);
  assert.deepEqual(
    orderCheck?.reverseReceiptHashes,
    [...orderCheck.forwardReceiptHashes].reverse()
  );
  assert.equal(
    Object.hasOwn(packet.reconciliation, "deterministicAcrossInputOrder"),
    false,
    "The packet must not overstate a forward/reverse check as general determinism."
  );

  const preserveAll = reconciliationField(packet, "preserve_all");
  const preferAuthority = reconciliationField(packet, "preferred_authority");
  assert.equal(preserveAll?.selectedValue, null);
  assert.ok(preserveAll?.candidates?.length >= 2);
  assert.notEqual(preferAuthority?.selectedValue, null);
  assert.ok(preferAuthority?.candidates?.length >= 2);
  assert.equal(packet.humanReview?.status, "pending_human_review");
  assert.equal(packet.humanReview?.proposalOnly, true);
  assert.deepEqual(
    packet.humanReview?.issues,
    proposal.issues,
    "Human review must receive every reconciliation issue without reduction."
  );
  assert.ok(proposal.issues.length >= expectedSourceCount);
  assert.equal(packet.boundaries?.syntheticDataOnly, true);
  assert.equal(packet.boundaries?.sourceRecordsMutated, false);
  assert.equal(packet.boundaries?.sourceAuthenticationEstablished, false);
  assert.equal(packet.boundaries?.acceptedTruthCreated, false);
  assert.equal(packet.boundaries?.authoritySelectionIsProposalOnly, true);
  assert.equal(
    packet.boundaries?.externalAuthenticationAndDispositionRequired,
    true
  );
  assert.match(packet.evidencePacketHash, SHA256_HEX);
  const { evidencePacketHash, ...packetWithoutHash } = packet;
  assert.equal(
    evidencePacketHash,
    semanticHash(packetWithoutHash),
    "The complete review packet, including its core runtime version, must verify against its hash."
  );
  const changedRuntime = structuredClone(packetWithoutHash);
  changedRuntime.coreRuntime.packageVersion = `${expectedCoreVersion}-different`;
  assert.notEqual(
    semanticHash(changedRuntime),
    evidencePacketHash,
    "Changing the core runtime version must change the packet hash."
  );
}

function runDeterministicIntegrationHub(
  targetPath,
  expectedSourceCount,
  expectedCoreVersion
) {
  const firstRun = runIntegrationHubOnce(targetPath);
  const secondRun = runIntegrationHubOnce(targetPath);
  assert.equal(
    firstRun,
    secondRun,
    "Generated integration-hub output must be byte-for-byte deterministic."
  );
  const packet = JSON.parse(firstRun);
  assertIntegrationHubPacket(packet, expectedSourceCount, expectedCoreVersion);
  return packet;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bumpPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match, "The synthetic authority policy must use a semantic version.");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function assertContextualJsonParseError(targetPath) {
  const relativePath = "source-records/malformed-envelope.json";
  await fs.writeFile(path.join(targetPath, relativePath), "{\n", "utf8");

  let failure;
  try {
    runIntegrationHubOnce(targetPath);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, "Malformed JSON must fail the generated runner.");
  const diagnostic = `${failure.message ?? ""}\n${failure.stderr ?? ""}`;
  assert.match(diagnostic, /Invalid JSON in source-records\/malformed-envelope\.json/);
}

export async function exerciseIntegrationHubExperiments(targetPath) {
  const installedCoreManifest = JSON.parse(
    await fs.readFile(
      path.join(targetPath, "node_modules/@t2kai/core/package.json"),
      "utf8"
    )
  );
  const expectedCoreVersion = installedCoreManifest.version;
  const baseline = runDeterministicIntegrationHub(
    targetPath,
    2,
    expectedCoreVersion
  );
  const baselineSelection = reconciliationField(
    baseline,
    "preferred_authority"
  ).selectedValue;

  const policyPath = path.join(targetPath, "authority-policy.json");
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  const registryPriorities = policy.prioritiesByDomain?.registry_status;
  assert.ok(
    Array.isArray(registryPriorities) && registryPriorities.length >= 2,
    "The synthetic authority policy must contain reversible priorities."
  );
  policy.prioritiesByDomain.registry_status = [...registryPriorities].reverse();
  policy.policyVersion = bumpPatchVersion(policy.policyVersion);
  await writeJson(policyPath, policy);

  const reversed = runDeterministicIntegrationHub(
    targetPath,
    2,
    expectedCoreVersion
  );
  assert.notDeepEqual(
    reconciliationField(reversed, "preferred_authority").selectedValue,
    baselineSelection,
    "Reversing authority priorities must change the proposed selection."
  );
  assert.notEqual(
    reversed.reconciliation.proposal.policyVersion,
    baseline.reconciliation.proposal.policyVersion,
    "Changing authority priorities must bump the policy version."
  );
  assert.notEqual(
    reversed.reconciliation.proposal.policyHash,
    baseline.reconciliation.proposal.policyHash,
    "Reversing authority priorities must change the policy hash."
  );
  assert.notEqual(
    reversed.evidencePacketHash,
    baseline.evidencePacketHash,
    "Reversing authority priorities must change the evidence packet hash."
  );

  const thirdSourceRecord = {
    sourceSystem: "synthetic-registry-gamma",
    sourceLocator: "synthetic://registry-gamma/party/GAMMA-0042",
    sourceRecordKey: "GAMMA-0042",
    sourceSchemaVersion: "party-record-v1",
    eventTime: "2026-08-29T15:02:00.000Z",
    observedTime: "2026-08-29T15:02:09.000Z",
    authenticationState: "unknown",
    authorityRef: "synthetic_registry_gamma",
    dataClassification: "synthetic_demo",
    purposeTags: ["integration_hub_demo"],
    retentionPolicy: {
      policyId: "synthetic-demo-30d",
      expiresAt: "2026-09-28",
    },
    payload: {
      record_id: "GAMMA-0042",
      party_key: " shared-0042 ",
      display_name: "Sample Services Cooperative",
      registry_state: "suspended",
      event_time: "2026-08-29T15:02:00.000Z",
      observed_time: "2026-08-29T15:02:09.000Z",
    },
  };
  await writeJson(
    path.join(targetPath, "source-records", "registry-gamma.json"),
    thirdSourceRecord
  );

  const expanded = runDeterministicIntegrationHub(
    targetPath,
    3,
    expectedCoreVersion
  );
  assert.ok(
    expanded.sourceEvidence.some(
      ({ receipt }) => receipt.sourceRecordKey === "GAMMA-0042"
    ),
    "A third source-records/*.json file must be discovered automatically."
  );
  assert.ok(reconciliationField(expanded, "preserve_all").candidates.length >= 3);
  assert.ok(
    reconciliationField(expanded, "preferred_authority").candidates.length >= 3
  );
  assert.deepEqual(
    reconciliationField(expanded, "preferred_authority").selectedValue,
    reconciliationField(reversed, "preferred_authority").selectedValue,
    "An unranked third authority must not displace the ranked proposal."
  );
  assert.notEqual(
    expanded.evidencePacketHash,
    reversed.evidencePacketHash,
    "Adding source evidence must change the evidence packet hash."
  );

  await assertContextualJsonParseError(targetPath);

  return { baseline, reversed, expanded };
}
