import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluatePurposeLimitedAccess,
  executeSourceMapping,
  reconcileCanonicalRecords,
  resolveEntityCandidates,
  validateOntologyPackManifest,
} from "@t2kai/core";
import {
  compileOntologyPackSet,
  compareCanonicalStrings,
  semanticHash,
} from "@t2kai/core/compiler";

const DEMO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

async function readJson(relativePath) {
  return JSON.parse(
    await fs.readFile(path.join(DEMO_ROOT, relativePath), "utf8")
  );
}

async function readSourceRecords() {
  const sourceDirectory = path.join(DEMO_ROOT, "source-records");
  const sourceFiles = (await fs.readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".json")
    .map((entry) => entry.name)
    .sort(compareCanonicalStrings);

  return Promise.all(
    sourceFiles.map((sourceFile) =>
      readJson(path.posix.join("source-records", sourceFile))
    )
  );
}

function sourceSummary(sourceRecord, mapping, result) {
  return {
    agency: sourceRecord.agency,
    sourceSystem: sourceRecord.sourceSystem,
    sourceLocator: sourceRecord.sourceLocator,
    sourceRecordKey: sourceRecord.sourceRecordKey,
    sourceSchemaVersion: sourceRecord.sourceSchemaVersion,
    authorityRef: sourceRecord.authorityRef,
    authenticationState: sourceRecord.authenticationState,
    observedTime: result.receipt.observedTime,
    payload: structuredClone(sourceRecord.payload),
    mapping: {
      id: mapping.id,
      version: mapping.mappingVersion,
      canonicalObject: mapping.object,
      fieldCount: mapping.fieldMappings.length,
      fields: mapping.fieldMappings.map((field) => ({
        sourcePath: field.sourcePath,
        targetProperty: field.targetProperty,
        normalizations: field.normalizations,
        conflictPolicy: field.conflictPolicy,
      })),
    },
    canonicalRecord: structuredClone(result.canonicalRecord),
    receipt: structuredClone(result.receipt),
  };
}

function buildAiAssist(proposal) {
  const conflicts = proposal.fields.filter((field) => field.candidates.length > 1);
  const unresolved = conflicts.filter((field) => field.status === "needs_review");

  const observations = conflicts.map((field) => {
    if (field.resolution === "preferred_authority") {
      return {
        propertyRef: field.propertyRef,
        kind: "policy_applied",
        message: `${field.candidates.length} values conflict. The versioned authority policy proposes ${JSON.stringify(field.selectedValue)}; confirm the policy is appropriate before activation.`,
      };
    }
    if (field.resolution === "preserve_all") {
      return {
        propertyRef: field.propertyRef,
        kind: "alternatives_preserved",
        message: `${field.candidates.length} values remain visible by design. No winner was inferred.`,
      };
    }
    return {
      propertyRef: field.propertyRef,
      kind: "human_judgment_needed",
      message: `${field.candidates.length} values conflict and no automatic selection is authorized. Compare the receipt-bound evidence.`,
    };
  });

  return {
    label: "AI-assist view",
    implementation: "deterministic_demo_assistant",
    authority: "advisory_only",
    generatedFromProposalHash: proposal.proposalHash,
    summary: `${conflicts.length} conflicted fields found; ${unresolved.length} requires a human selection.`,
    observations,
    may: [
      "summarize differences",
      "trace candidates to source receipts",
      "score reversible entity-link candidates",
      "explain the versioned authority policy",
      "explain purpose-access receipts",
      "prepare a review queue",
    ],
    mayNot: [
      "authenticate a reviewer",
      "submit a human disposition",
      "change source evidence",
      "approve an entity link or merge",
      "activate a canonical record",
      "enforce access in place of IAM",
      "adjudicate benefits",
    ],
  };
}

function buildEntityResolution() {
  const input = {
    sourceEntityKey: "source:state-labor:WM-33018",
    identifiers: {
      person_id: "PB-1042",
      display_name: "Maya Chen",
      mailing_address: "18 Harbor Way, Cedar Bay",
    },
    candidates: [
      {
        entityKey: "canonical:benefits-case-1042-a",
        identifiers: {
          person_id: "PB-1042",
          display_name: "Maya Chen",
          mailing_address: "18 Harbor Way, Cedar Bay",
        },
      },
      {
        entityKey: "canonical:benefits-case-1042-b",
        identifiers: {
          person_id: "PB-1042",
          display_name: "Maya Chen",
          mailing_address: "18 Harbor Way, Cedar Bay",
        },
      },
    ],
    rules: [
      {
        identifier: "person_id",
        weight: 0.6,
        requiredForAutomaticMatch: true,
        caseInsensitive: true,
      },
      {
        identifier: "display_name",
        weight: 0.25,
        caseInsensitive: true,
      },
      {
        identifier: "mailing_address",
        weight: 0.15,
        caseInsensitive: true,
      },
    ],
    automaticMatchThreshold: 0.9,
    reviewThreshold: 0.5,
    ambiguityMargin: 0.1,
  };
  const decision = resolveEntityCandidates(input);
  const reordered = resolveEntityCandidates({
    ...structuredClone(input),
    candidates: [...input.candidates].reverse(),
    rules: [...input.rules].reverse(),
  });

  return {
    input,
    decision,
    deterministicAcrossInputOrder:
      decision.decisionHash === reordered.decisionHash,
    boundary:
      "This is a reversible link proposal. It does not merge either candidate or alter source evidence.",
  };
}

function buildAccessChecks(policy, results) {
  const sourceRecordRefs = results
    .map(({ receipt }) => receipt.receiptHash)
    .sort(compareCanonicalStrings);
  const shared = {
    principalId: "user:demo-coordinator-7",
    principalRoles: ["case_coordinator"],
    subjectRef: "benefits_person:PB-1042",
    subjectRelationship: "assigned_case",
    dataCategories: ["identity", "contact", "program_status"],
    jurisdiction: "DEMO",
    requestedAt: "2026-08-29T18:00:00.000Z",
    sourceRecordRefs,
    attributes: { deviceTrust: "managed" },
  };
  const requests = [
    {
      label: "Assigned case coordination",
      request: {
        ...shared,
        requestKey: "demo-access-allow-001",
        purpose: "case_coordination",
      },
    },
    {
      label: "Unlisted model-training purpose",
      request: {
        ...shared,
        requestKey: "demo-access-deny-001",
        purpose: "model_training",
      },
    },
  ];

  return {
    policy: structuredClone(policy),
    checks: requests.map(({ label, request }) => ({
      label,
      request,
      receipt: evaluatePurposeLimitedAccess(policy, request),
    })),
    boundary:
      "Receipts explain a policy result; they are not authentication tokens and do not replace the owning IAM enforcement point.",
  };
}

function permutations(values) {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_item, itemIndex) => itemIndex !== index)).map(
      (remaining) => [value, ...remaining]
    )
  );
}

function orderChecks(results, authorityPolicy) {
  const orders = permutations(results).map((orderedResults, index) => ({
    label: index === 0 ? "source file order" : `permutation ${index + 1}`,
    results: orderedResults,
  }));
  const proposals = orders.map(({ label, results: orderedResults }) => ({
    label,
    proposal: reconcileCanonicalRecords({
      results: orderedResults,
      authorityPolicy,
    }),
  }));
  const proposalHashes = proposals.map(({ label, proposal }) => ({
    label,
    proposalHash: proposal.proposalHash,
  }));

  return {
    primary: proposals[0].proposal,
    summary: {
      verified: new Set(proposalHashes.map(({ proposalHash }) => proposalHash))
        .size === 1,
      testedOrders: proposalHashes.length,
      proposalHashes,
    },
  };
}

/**
 * Builds the complete synthetic demonstration by executing the real workspace
 * implementation of @t2kai/core. No fixture contains precomputed core output.
 */
export async function buildDemoModel() {
  const [manifest, authorityPolicy, accessPolicy, sourceRecords] = await Promise.all([
    readJson("ontology-pack.json"),
    readJson("authority-policy.json"),
    readJson("purpose-access-policy.json"),
    readSourceRecords(),
  ]);

  const manifestValidation = validateOntologyPackManifest(manifest);
  if (!manifestValidation.valid) {
    throw new Error(
      `Demo ontology is invalid: ${JSON.stringify(manifestValidation.errors)}`
    );
  }

  const compilation = compileOntologyPackSet({
    manifests: [manifest],
    roots: [
      {
        ontologyId: manifest.ontologyId,
        version: manifest.ontologyVersion,
      },
    ],
  });
  if (compilation.status !== "valid") {
    throw new Error(
      `Demo ontology did not compile: ${JSON.stringify(compilation.diagnostics)}`
    );
  }

  const mapped = sourceRecords.map((sourceRecord) => {
    const mapping = manifest.sourceMappings.find(
      (candidate) => candidate.id === sourceRecord.mappingId
    );
    if (!mapping) {
      throw new Error(`No source mapping found for ${sourceRecord.mappingId}`);
    }

    const { agency: _agency, mappingId: _mappingId, payload, ...metadata } =
      sourceRecord;
    const result = executeSourceMapping({
      mapping,
      envelope: {
        ...metadata,
        payload: structuredClone(payload),
        contentHash: semanticHash(payload),
      },
    });
    if (result.receipt.status !== "mapped") {
      throw new Error(
        `${mapping.id} produced ${result.receipt.status}: ${JSON.stringify(result.receipt.issues)}`
      );
    }
    return { mapping, result, sourceRecord };
  });

  const reconciliation = orderChecks(
    mapped.map(({ result }) => result),
    authorityPolicy
  );
  if (!reconciliation.summary.verified) {
    throw new Error("Reconciliation changed when agency input order changed.");
  }

  const proposal = reconciliation.primary;
  const entityResolution = buildEntityResolution();
  const purposeAccess = buildAccessChecks(
    accessPolicy,
    mapped.map(({ result }) => result)
  );
  const unresolvedFields = proposal.fields
    .filter((field) => field.status === "needs_review")
    .map((field) => ({
      propertyRef: field.propertyRef,
      candidates: field.candidates.map((candidate) => ({
        value: structuredClone(candidate.value),
        valueHash: candidate.valueHash,
        evidenceCount: candidate.evidence.length,
      })),
    }));
  const conflictedFieldCount = proposal.fields.filter(
    (field) => field.candidates.length > 1
  ).length;

  return {
    meta: {
      title: "One case. Three agencies. Every claim traceable.",
      subtitle:
        "A live, synthetic integration hub powered by the @t2kai/core workspace package.",
      syntheticDataOnly: true,
      coreApis: [
        "validateOntologyPackManifest",
        "compileOntologyPackSet",
        "executeSourceMapping",
        "reconcileCanonicalRecords",
        "resolveEntityCandidates",
        "evaluatePurposeLimitedAccess",
      ],
    },
    ontology: {
      id: manifest.ontologyId,
      version: manifest.ontologyVersion,
      valid: manifestValidation.valid,
      resolutionHash: compilation.resolutionHash,
      canonicalObject: manifest.objectTypes[0],
    },
    authorityPolicy: structuredClone(authorityPolicy),
    agencies: mapped.map(({ sourceRecord, mapping, result }) =>
      sourceSummary(sourceRecord, mapping, result)
    ),
    metrics: {
      sourceCount: mapped.length,
      receiptCount: mapped.length,
      canonicalFieldCount: proposal.fields.length,
      conflictedFieldCount,
      unresolvedFieldCount: unresolvedFields.length,
    },
    proposal: structuredClone(proposal),
    determinism: reconciliation.summary,
    entityResolution,
    purposeAccess,
    aiAssist: buildAiAssist(proposal),
    humanReview: {
      status: "pending_human_review",
      required: proposal.humanReviewRequired,
      unresolvedFields,
      requiredRole: "program_case_supervisor",
      entityLinkReviewRequired:
        entityResolution.decision.humanReviewRequired,
      activationImplemented: false,
    },
    boundary: {
      coreOutput: "non_mutating_proposal",
      assistantAuthority: "advisory_only",
      humanDisposition: "required",
      entityLinkStatus: "proposal_only",
      accessReceiptStatus: "policy_evaluation_only",
      sourceAuthenticationProvidedByDemo: false,
      canonicalActivationImplemented: false,
      benefitAdjudicationPerformed: false,
      note: "The demo records an attested browser disposition in memory. Production must authenticate the reviewer and enforce activation in a separate trusted service.",
    },
  };
}

export { DEMO_ROOT };
