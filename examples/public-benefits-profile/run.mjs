import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluatePurposeLimitedAccess,
  executeSourceMapping,
  reconcileCanonicalRecords,
  resolveEntityCandidates,
  validateOntologyPackManifest,
} from "../../packages/core/dist/index.js";
import {
  compileOntologyPackSet,
  semanticHash,
} from "../../packages/core/dist/compiler.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "ontology-pack.json"), "utf8")
);

const validation = validateOntologyPackManifest(manifest);
assert.equal(
  validation.valid,
  true,
  `Synthetic benefits manifest failed schema validation: ${JSON.stringify(validation.errors)}`
);

const compilation = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }],
});
assert.equal(compilation.status, "valid", JSON.stringify(compilation.diagnostics));

const mapping = (id) => {
  const value = manifest.sourceMappings.find((candidate) => candidate.id === id);
  assert.ok(value, `Missing source mapping ${id}`);
  return value;
};

const envelope = (overrides) => {
  const value = {
    sourceSystem: "synthetic-source",
    sourceLocator: "synthetic://record/1",
    sourceRecordKey: "record-1",
    sourceSchemaVersion: "legacy-person-v3",
    payload: {},
    eventTime: "2026-08-29T16:00:00.000Z",
    observedTime: "2026-08-29T16:00:05.000Z",
    authenticationState: "system_asserted",
    authorityRef: "synthetic_authority",
    dataClassification: "synthetic_restricted",
    purposeTags: ["benefit_profile_reconciliation"],
    retentionPolicy: { policyId: "synthetic-7y", expiresAt: "2033-08-29" },
    ...overrides,
  };
  return { ...value, contentHash: semanticHash(value.payload) };
};

const identityPayload = {
  record_id: "IDENTITY-0001",
  profile_key: " demo-001 ",
  display_name: "  Sample   Claimant ",
  birth_date: "1980-01-02",
  enumeration: "active",
  event_time: "2026-08-29T15:55:00.000Z",
  observed_time: "2026-08-29T16:00:00.000Z",
};
const identity = executeSourceMapping({
  mapping: mapping("legacy_identity_snapshot_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-mainframe",
    sourceLocator: "synthetic://identity/mainframe/IDENTITY-0001",
    payload: identityPayload,
  }),
});
assert.equal(identity.receipt.status, "mapped");
assert.equal(identity.canonicalRecord.identity.profile_id, "DEMO-001");
assert.equal(identity.canonicalRecord.fields[1].provenance.authenticationState, "system_asserted");
assert.equal(identity.receipt.humanReviewRequired, false);

const secondaryIdentityPayload = {
  ...identityPayload,
  record_id: "IDENTITY-0002",
  display_name: " Sample A. Claimant ",
  enumeration: "pending",
  event_time: "2026-08-29T15:56:00.000Z",
  observed_time: "2026-08-29T16:00:20.000Z",
};
const secondaryIdentity = executeSourceMapping({
  mapping: mapping("legacy_identity_snapshot_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-secondary-registry",
    sourceLocator: "synthetic://identity/secondary/IDENTITY-0002",
    sourceRecordKey: "IDENTITY-0002",
    authorityRef: "synthetic_secondary_registry",
    payload: secondaryIdentityPayload,
  }),
});
assert.equal(secondaryIdentity.receipt.status, "mapped");

const authorityPolicy = {
  policyId: "synthetic-party-authority",
  policyVersion: "1.0.0",
  prioritiesByDomain: {
    enumeration: ["synthetic_authority", "synthetic_secondary_registry"],
  },
};
const reconciliation = reconcileCanonicalRecords({
  results: [identity, secondaryIdentity],
  authorityPolicy,
});
const reconciliationAgain = reconcileCanonicalRecords({
  results: [secondaryIdentity, identity],
  authorityPolicy,
});
assert.equal(reconciliation.status, "proposed");
assert.equal(reconciliation.humanReviewRequired, false);
assert.equal(reconciliation.nonMutating, true);
assert.equal(reconciliation.alternativesPreserved, true);
assert.equal(reconciliation.proposalHash, reconciliationAgain.proposalHash);
const reconciledEnumeration = reconciliation.fields.find(
  (field) => field.propertyRef === "enumeration_state"
);
const reconciledNames = reconciliation.fields.find(
  (field) => field.propertyRef === "normalized_name"
);
assert.equal(reconciledEnumeration?.resolution, "preferred_authority");
assert.equal(reconciledEnumeration?.selectedValue, "enumerated");
assert.equal(reconciledNames?.resolution, "preserve_all");
assert.equal(reconciledNames?.selectedValue, null);
assert.equal(reconciledNames?.candidates.length, 2);

const driftPayload = {
  ...identityPayload,
  record_id: "IDENTITY-DRIFT-0001",
  unexpected_source_flag: "synthetic-schema-change",
};
const driftedIdentity = executeSourceMapping({
  mapping: mapping("legacy_identity_snapshot_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-mainframe",
    sourceLocator: "synthetic://identity/mainframe/IDENTITY-DRIFT-0001",
    sourceRecordKey: "IDENTITY-DRIFT-0001",
    payload: driftPayload,
  }),
});
assert.equal(driftedIdentity.receipt.status, "quarantined");
assert.equal(driftedIdentity.receipt.humanReviewRequired, true);
assert.ok(
  driftedIdentity.receipt.issues.some(
    (issue) =>
      issue.code === "unmapped_source_fields" &&
      issue.message.includes("$.unexpected_source_flag")
  )
);

const replay = executeSourceMapping({
  mapping: mapping("legacy_identity_snapshot_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-mainframe",
    sourceLocator: "synthetic://identity/mainframe/IDENTITY-0001",
    payload: identityPayload,
  }),
  acceptedIdempotencyRecords: [
    {
      idempotencyKey: identity.receipt.idempotencyKey,
      sourcePayloadHash: identity.receipt.sourcePayloadHash,
      canonicalOutputHash: identity.receipt.canonicalOutputHash,
    },
  ],
});
assert.equal(replay.receipt.status, "duplicate");
assert.equal(replay.receipt.duplicate, true);
assert.equal(replay.receipt.idempotencyKey, identity.receipt.idempotencyKey);
assert.equal(replay.receipt.canonicalOutputHash, identity.receipt.canonicalOutputHash);

const contactPayload = {
  assertion_id: "CONTACT-0001",
  profile_key: "demo-001",
  phone: "0100",
  assurance: " phishing-resistant ",
  event_time: "2026-08-29T15:58:00.000Z",
  observed_time: "2026-08-29T16:00:30.000Z",
};
const authenticatedContact = executeSourceMapping({
  mapping: mapping("claimant_contact_assertion_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-claimant-api",
    sourceLocator: "synthetic://claimant/contact-api/CONTACT-0001",
    sourceRecordKey: "CONTACT-0001",
    sourceSchemaVersion: "contact-assertion-v1",
    authenticationState: "authenticated",
    authorityRef: "synthetic_claimant",
    payload: contactPayload,
    eventTime: contactPayload.event_time,
    observedTime: contactPayload.observed_time,
    purposeTags: ["claimant_contact_update"],
  }),
});
assert.equal(authenticatedContact.receipt.status, "mapped");
assert.equal(authenticatedContact.receipt.authenticationState, "authenticated");

const earningsPayload = {
  row_id: "EARNINGS-0001",
  claim_key: "claim-2026-001",
  profile_key: "demo-001",
  period_start: "2026-07-01",
  gross_wages: 2400,
  claim_state: "open",
  event_time: "2026-08-20T12:00:00.000Z",
  observed_time: "2026-08-29T16:01:00.000Z",
};
const lateEarnings = executeSourceMapping({
  mapping: mapping("batch_earnings_claim_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-earnings-batch",
    sourceLocator: "synthetic://earnings/batch/EARNINGS-0001",
    sourceRecordKey: "EARNINGS-0001",
    sourceSchemaVersion: "earnings-row-v2",
    payload: earningsPayload,
    eventTime: earningsPayload.event_time,
    observedTime: earningsPayload.observed_time,
  }),
  latestAcceptedEventTime: "2026-08-25T12:00:00.000Z",
});
assert.equal(lateEarnings.receipt.status, "mapped");
assert.equal(lateEarnings.receipt.lateArrival, true);
assert.equal(lateEarnings.receipt.humanReviewRequired, true);
assert.ok(lateEarnings.receipt.issues.some((issue) => issue.code === "late_arrival"));

const documentPayload = {
  document_hash: "sha256:SYNTHETIC-DOCUMENT-0001",
  evidence_key: "evidence-0001",
  profile_key: "demo-001",
  document_type: " Wage Statement ",
  extracted_fact: "  Gross wages reported for July 2026  ",
  received_at: "2026-08-29T15:59:00.000Z",
  observed_time: "2026-08-29T16:02:00.000Z",
};
const documentEvidence = executeSourceMapping({
  mapping: mapping("document_evidence_extract_v1"),
  envelope: envelope({
    sourceSystem: "synthetic-document-extractor",
    sourceLocator: "synthetic://evidence/pdf/EVIDENCE-0001",
    sourceRecordKey: "EVIDENCE-0001",
    sourceSchemaVersion: "document-extract-v1",
    authenticationState: "unknown",
    authorityRef: "synthetic_document_pipeline",
    payload: documentPayload,
    eventTime: documentPayload.received_at,
    observedTime: documentPayload.observed_time,
    purposeTags: ["evidence_review"],
  }),
});
assert.equal(documentEvidence.receipt.status, "mapped");
assert.equal(documentEvidence.receipt.humanReviewRequired, true);

const uniqueIdentityProposal = resolveEntityCandidates({
  sourceEntityKey: "source:IDENTITY-0001",
  identifiers: { profile_id: "DEMO-001", birth_date: "1980-01-02" },
  candidates: [
    { entityKey: "party:001", identifiers: { profile_id: "DEMO-001", birth_date: "1980-01-02" } },
    { entityKey: "party:002", identifiers: { profile_id: "DEMO-999", birth_date: "1975-05-04" } },
  ],
  rules: [
    { identifier: "profile_id", weight: 0.7, requiredForAutomaticMatch: true, caseInsensitive: true },
    { identifier: "birth_date", weight: 0.3 },
  ],
});
assert.equal(uniqueIdentityProposal.status, "matched");
assert.equal(uniqueIdentityProposal.reversible, true);

const ambiguousIdentityProposal = resolveEntityCandidates({
  sourceEntityKey: "source:CONTACT-0001",
  identifiers: { birth_date: "1980-01-02", phone_last4: "0100" },
  candidates: [
    { entityKey: "party:001", identifiers: { birth_date: "1980-01-02", phone_last4: "0100" } },
    { entityKey: "party:003", identifiers: { birth_date: "1980-01-02", phone_last4: "0100" } },
  ],
  rules: [
    { identifier: "birth_date", weight: 0.5 },
    { identifier: "phone_last4", weight: 0.5 },
  ],
});
assert.equal(ambiguousIdentityProposal.status, "needs_review");
assert.equal(ambiguousIdentityProposal.humanReviewRequired, true);

const accessPolicy = {
  policyId: "synthetic-benefits-profile-access",
  policyVersion: "1.0.0",
  defaultEffect: "deny",
  rules: [
    {
      ruleId: "deny-self-sensitive-profile",
      effect: "deny",
      subjectRelationships: ["self"],
      dataCategories: ["earnings"],
      reason: "Sensitive earnings access requires a separately authorized claimant channel.",
    },
    {
      ruleId: "allow-caseworker-reconciliation",
      effect: "allow",
      roles: ["caseworker"],
      purposes: ["benefit_profile_reconciliation"],
      subjectRelationships: ["assigned_case"],
      dataCategories: ["identity", "earnings"],
      jurisdictions: ["US-DEMO"],
      attributeEquals: { trainingComplete: true },
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2027-01-01T00:00:00.000Z",
      reason: "Assigned trained caseworker may reconcile the minimum requested profile categories.",
    },
  ],
};
const accessRequest = {
  requestKey: "ACCESS-0001",
  principalId: "caseworker:synthetic-7",
  principalRoles: ["caseworker"],
  purpose: "benefit_profile_reconciliation",
  subjectRef: "party:001",
  subjectRelationship: "assigned_case",
  dataCategories: ["identity", "earnings"],
  jurisdiction: "US-DEMO",
  requestedAt: "2026-08-29T16:05:00.000Z",
  sourceRecordRefs: ["EARNINGS-0001", "IDENTITY-0001"],
  attributes: { trainingComplete: true },
};
const allowed = evaluatePurposeLimitedAccess(accessPolicy, accessRequest);
const allowedAgain = evaluatePurposeLimitedAccess(accessPolicy, {
  ...accessRequest,
  principalRoles: [...accessRequest.principalRoles].reverse(),
  dataCategories: [...accessRequest.dataCategories].reverse(),
  sourceRecordRefs: [...accessRequest.sourceRecordRefs].reverse(),
});
assert.equal(allowed.decision, "allow");
assert.equal(allowed.reasonCode, "explicit_allow");
assert.equal(allowed.receiptHash, allowedAgain.receiptHash);

const denied = evaluatePurposeLimitedAccess(accessPolicy, {
  ...accessRequest,
  requestKey: "ACCESS-0002",
  principalRoles: ["analytics_contractor"],
  purpose: "model_training",
});
assert.equal(denied.decision, "deny");
assert.equal(denied.reasonCode, "default_deny");

console.log(
  JSON.stringify(
    {
      ontology: `${manifest.ontologyId}@${manifest.ontologyVersion}`,
      resolutionHash: compilation.resolutionHash,
      sourceMappings: {
        mapped: identity.receipt.receiptHash,
        schemaDrift: driftedIdentity.receipt.receiptHash,
        authenticatedApi: authenticatedContact.receipt.receiptHash,
        duplicate: replay.receipt.receiptHash,
        lateArrival: lateEarnings.receipt.receiptHash,
        humanReview: documentEvidence.receipt.receiptHash,
      },
      canonicalReconciliation: {
        status: reconciliation.status,
        proposalHash: reconciliation.proposalHash,
        deterministicAcrossInputOrder:
          reconciliation.proposalHash === reconciliationAgain.proposalHash,
        selectedEnumeration: reconciledEnumeration?.selectedValue,
        preservedNameCandidates: reconciledNames?.candidates.length,
        humanReviewRequired: reconciliation.humanReviewRequired,
        nonMutating: reconciliation.nonMutating,
        alternativesPreserved: reconciliation.alternativesPreserved,
      },
      entityResolution: {
        unique: uniqueIdentityProposal.decisionHash,
        ambiguous: ambiguousIdentityProposal.decisionHash,
      },
      purposeAccess: {
        allowed: allowed.receiptHash,
        defaultDenied: denied.receiptHash,
      },
      boundaries: {
        syntheticDataOnly: true,
        silentEntityMerge: false,
        machineExtractedEvidenceNeedsHumanReview: true,
        externalIamStillRequired: true,
      },
    },
    null,
    2
  )
);
