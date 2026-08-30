import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

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

function runIntegrationHubOnce(targetPath) {
  return execFileSync(process.execPath, ["src/run.mjs"], {
    cwd: targetPath,
    encoding: "utf8",
  });
}

function assertCompleteSourceEvidence(sourceEvidence) {
  for (const evidence of sourceEvidence) {
    assert.ok(evidence.summary, "Source evidence is missing its concise summary.");
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
    assert.ok(Array.isArray(evidence.receipt.purposeTags));
    assert.ok(Array.isArray(evidence.receipt.issues));
  }
}

function assertIntegrationHubPacket(packet, expectedSourceCount) {
  assert.equal(packet.profile, "integration-hub");
  assert.equal(packet.sourceEvidence?.length, expectedSourceCount);
  assertCompleteSourceEvidence(packet.sourceEvidence);
  assert.equal(packet.reconciliation?.canonicalIdentity?.party_id, "SHARED-0042");
  assert.equal(packet.reconciliation?.deterministicAcrossInputOrder, true);
  assert.equal(packet.reconciliation?.humanReviewRequired, true);
  assert.equal(packet.reconciliation?.nonMutating, true);
  assert.equal(packet.reconciliation?.alternativesPreserved, true);
  assert.equal(packet.reconciliation?.preserveAll?.resolution, "preserve_all");
  assert.equal(packet.reconciliation?.preserveAll?.selectedValue, null);
  assert.ok(packet.reconciliation?.preserveAll?.candidates?.length >= 2);
  assert.equal(
    packet.reconciliation?.preferAuthority?.resolution,
    "preferred_authority"
  );
  assert.notEqual(
    packet.reconciliation?.preferAuthority?.selectedWithinProposal,
    null
  );
  assert.ok(packet.reconciliation?.preferAuthority?.candidates?.length >= 2);
  assert.equal(packet.humanReview?.status, "pending_human_review");
  assert.equal(packet.humanReview?.proposalOnly, true);
  assert.ok(packet.humanReview?.issues?.length >= expectedSourceCount);
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
}

function runDeterministicIntegrationHub(targetPath, expectedSourceCount) {
  const firstRun = runIntegrationHubOnce(targetPath);
  const secondRun = runIntegrationHubOnce(targetPath);
  assert.equal(
    firstRun,
    secondRun,
    "Generated integration-hub output must be byte-for-byte deterministic."
  );
  const packet = JSON.parse(firstRun);
  assertIntegrationHubPacket(packet, expectedSourceCount);
  return packet;
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function exerciseIntegrationHubExperiments(targetPath) {
  const baseline = runDeterministicIntegrationHub(targetPath, 2);
  const baselineSelection =
    baseline.reconciliation.preferAuthority.selectedWithinProposal;

  const policyPath = path.join(targetPath, "authority-policy.json");
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  const registryPriorities = policy.prioritiesByDomain?.registry_status;
  assert.ok(
    Array.isArray(registryPriorities) && registryPriorities.length >= 2,
    "The synthetic authority policy must contain reversible priorities."
  );
  policy.prioritiesByDomain.registry_status = [...registryPriorities].reverse();
  await writeJson(policyPath, policy);

  const reversed = runDeterministicIntegrationHub(targetPath, 2);
  assert.notDeepEqual(
    reversed.reconciliation.preferAuthority.selectedWithinProposal,
    baselineSelection,
    "Reversing authority priorities must change the proposed selection."
  );
  assert.notEqual(
    reversed.reconciliation.authorityPolicy.policyHash,
    baseline.reconciliation.authorityPolicy.policyHash,
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

  const expanded = runDeterministicIntegrationHub(targetPath, 3);
  assert.ok(
    expanded.sourceEvidence.some(
      ({ receipt }) => receipt.sourceRecordKey === "GAMMA-0042"
    ),
    "A third source-records/*.json file must be discovered automatically."
  );
  assert.ok(expanded.reconciliation.preserveAll.candidates.length >= 3);
  assert.ok(expanded.reconciliation.preferAuthority.candidates.length >= 3);
  assert.deepEqual(
    expanded.reconciliation.preferAuthority.selectedWithinProposal,
    reversed.reconciliation.preferAuthority.selectedWithinProposal,
    "An unranked third authority must not displace the ranked proposal."
  );
  assert.notEqual(
    expanded.evidencePacketHash,
    reversed.evidencePacketHash,
    "Adding source evidence must change the evidence packet hash."
  );

  return { baseline, reversed, expanded };
}
