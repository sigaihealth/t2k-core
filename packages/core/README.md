# `@t2kai/core`

Portable contracts and deterministic components for ontology-centered,
governed decision agents.

The package includes:

- typed graph, claim, decision, policy, execution, observation, and learning contracts;
- exact ontology-pack validation against the published JSON Schema;
- deterministic pack compilation, dependency resolution, and semantic hashes;
- governed source mapping with drift, lateness, idempotency, and field-level
  provenance receipts;
- deterministic, non-mutating canonical-record reconciliation with explicit
  authority priorities and preserved candidate evidence;
- reversible, evidence-scored entity-resolution proposals;
- deterministic purpose-limited access evaluation and disclosure receipts;
- an executable reference rule policy and held-out replay evaluator;
- deterministic reward assessment and per-policy aggregation;
- a Postgres reference lifecycle for contexts, episodes, receipts, evaluation,
  promotion, rollback, immutable reconciliation proposals, canonical revision
  lineage, governed reactivation, and an append-only event chain;
- `T2kClient` for trusted server-side calls to a T2K control plane.

The package uses Ajv for exact schema execution and `pg` for the optional local
lifecycle. Node.js 20.10 or newer is required. The compiler and Postgres
subpaths are server-side modules.

Source mapping, canonical reconciliation, entity resolution, purpose-access,
and persisted reconciliation-review APIs described below are published in
`@t2kai/core@0.4.3`.

## Compile Packs Locally

```ts
import { compileOntologyPackSet } from "@t2kai/core/compiler";

const result = compileOntologyPackSet({
  manifests: [corePack, fieldServicePack],
  roots: [{ ontologyId: "demo.harborlight-field-service", version: "^1.0.0" }],
  contextValues: {},
});

if (result.status === "invalid") {
  throw new Error(JSON.stringify(result.diagnostics, null, 2));
}

console.log(result.resolutionHash);
```

The compiler never fetches dependencies implicitly. Equivalent semantic input
produces identical resolution and definition hashes.

## Validate the Standard

```ts
import { validateOntologyPackManifest } from "@t2kai/core";

const validation = validateOntologyPackManifest(manifest);
if (!validation.valid) {
  console.error(validation.errors);
}
```

The canonical package schema is exported as
`@t2kai/core/schema/t2k-ontology-pack.v1.json`.

## Map Governed Source Records

`executeSourceMapping` applies a parsed, compiler-valid executable mapping to
one immutable source envelope. It checks the declared source schema version
and, when supplied, content hash; detects late or duplicate records; applies
only the fixed normalization operators in the standard; and returns a canonical
record plus a deterministic receipt.

```ts
import {
  executeSourceMapping,
  parseOntologyPackManifest,
} from "@t2kai/core";
import { compileOntologyPackSet } from "@t2kai/core/compiler";

const parsedPack = parseOntologyPackManifest(rawPack);
const compilation = parsedPack
  ? compileOntologyPackSet({
      manifests: [rawPack],
      roots: [{
        ontologyId: parsedPack.ontologyId,
        version: parsedPack.ontologyVersion,
      }],
    })
  : null;
if (!parsedPack || compilation?.status !== "valid") {
  throw new Error("The ontology pack is not executable");
}
const mapping = parsedPack.sourceMappings[0];
if (!mapping?.fieldMappings?.length) {
  throw new Error("The source mapping is descriptive, not executable");
}
const result = executeSourceMapping({
  mapping,
  envelope: {
    sourceSystem: "agency.case-api",
    sourceLocator: "case-api/cases/483",
    sourceRecordKey: "483",
    sourceSchemaVersion: "2026-08",
    payload: sourceRecord,
    eventTime: "2026-08-29T16:00:00.000Z",
    observedTime: "2026-08-29T16:00:05.000Z",
    authenticationState: "authenticated",
    authorityRef: "agency.case-system",
    dataClassification: "restricted",
    purposeTags: ["benefit-determination"],
    retentionPolicy: { schedule: "agency-records-policy" },
  },
  latestAcceptedEventTime: currentWatermark,
  acceptedIdempotencyRecords: acceptedReceipts.map((receipt) => ({
    idempotencyKey: receipt.idempotencyKey,
    sourcePayloadHash: receipt.sourcePayloadHash,
    canonicalOutputHash: receipt.canonicalOutputHash,
  })),
});

if (
  result.receipt.status !== "mapped" ||
  result.receipt.humanReviewRequired
) {
  queueForReview(result.receipt);
}
```

The receipt records the mapping and payload hashes, event and observation
times, source authentication assertion, authority reference, classification,
purpose and retention metadata, lateness, duplicate state, issues, and a hash
of the receipt. Each mapped field retains its source path, source-value hash,
mapping identity, authority domain, and the same source-control metadata.

Treat an envelope as immutable once it has been mapped. A later observation is
a new envelope: keep the prior file or event, use a new locator, source-record
key, payload record ID or other idempotency value, and event and observation
times. Use a distinct `sourceSystem` when the experiment represents a distinct
synthetic source; do not relabel a real source merely to bypass replay checks.
Changing an executable field mapping requires a new `mappingVersion` and a new
containing `ontologyVersion`. Changing `humanCheckpoint` or any other ontology
contract also requires a new `ontologyVersion`. Changing authority priorities
requires a new `policyVersion`.

The two field hashes answer different questions. Provenance
`sourceValueHash` binds the raw JSON value extracted from the source before
normalization or value mapping. A reconciliation candidate's `valueHash` binds
the mapped canonical value after those transformations. They can legitimately
differ; keep both to prove what arrived and what was compared.

Legacy descriptive mappings that omit `fieldMappings` remain valid manifest
documentation but are not executable. The function returns a rejected,
human-review-required receipt for them. It likewise fails closed on incomplete
execution fields, duplicate targets, undeclared or missing identity values,
invalid or timezone-less timestamps, supplied content-hash mismatches, and
source drift required by the selected policy. Compile the containing pack
before execution: a mapping may use only identity properties declared by its
target object or an inherited object type.

An idempotency key alone is not proof of replay. `duplicate` status requires a
prior accepted record with the same key, source payload hash, and canonical
output hash. A changed payload or output under a reused key is rejected; a
key-only lookup is quarantined because equivalence cannot be verified.

### Reconcile canonical records without losing evidence

`reconcileCanonicalRecords` turns independently mapped records for the same
canonical object and exact identity into a deterministic, non-mutating
proposal. It checks each receipt's internal hash consistency, canonical-output
binding, field-to-receipt provenance binding, and identity-to-field agreement
before considering a value. Rejected, quarantined, duplicate, structurally
invalid, or internally contradictory inputs cannot win.

```ts
import { reconcileCanonicalRecords } from "@t2kai/core";

const proposal = reconcileCanonicalRecords({
  results: [masterRecord, secondaryRecord],
  authorityPolicy: {
    policyId: "agency.party-authority",
    policyVersion: "1.0.0",
    prioritiesByDomain: {
      identity: ["agency-master", "claimant-assertion"],
    },
  },
});

if (proposal.status === "rejected") {
  throw new Error("Canonical evidence failed integrity or identity checks");
}
if (proposal.humanReviewRequired) {
  queueForReview(proposal);
}
```

Equal semantic values are coalesced while retaining every source receipt and
field provenance. Conflicting `preserve_all` values remain as candidates with
no invented winner. `require_review` conflicts remain unresolved.
`prefer_authority` selects a value only when one candidate is backed by the
unique highest-ranked `authorityRef` in the declared authority domain; missing
or tied rankings route to review. Mixed conflict policies, object or identity
mismatches, and integrity failures reject the proposal.

The authority policy and result are hash-addressed for deterministic
self-consistency, not cryptographic authenticity. `authorityRef` is still a
caller assertion, and an untrusted caller can recompute an unkeyed hash. A
production application must authenticate sources, use registry-, signature-,
or equivalent trust evidence where required, govern the policy, persist the
evidence, and record any human disposition. The proposal does not mutate source
records, merge entities, or promote a value to accepted truth; all alternatives
remain present for downstream disposition.

These public object APIs snapshot JSON-compatible own data once before they
validate, decide, or hash. Inherited properties are ignored, and own accessors,
cycles, sparse arrays, or non-JSON values fail closed. Pass parsed JSON or
ordinary data records rather than behavior-bearing objects.

`resolveEntityCandidates` separately produces a reversible entity-link
proposal. Weighted identifier rules, required identifiers, automatic and
review thresholds, and an ambiguity margin determine whether the result is
`matched`, `new_entity`, or `needs_review`.

```ts
import { resolveEntityCandidates } from "@t2kai/core";

const resolution = resolveEntityCandidates({
  sourceEntityKey: "agency.case-api:party:483",
  identifiers: { agencyPartyId: "P-483", email: "person@example.test" },
  candidates,
  rules: [
    {
      identifier: "agencyPartyId",
      weight: 0.8,
      requiredForAutomaticMatch: true,
    },
    { identifier: "email", weight: 0.2, caseInsensitive: true },
  ],
  automaticMatchThreshold: 0.9,
  reviewThreshold: 0.5,
  ambiguityMargin: 0.1,
});

if (resolution.humanReviewRequired) {
  queueForReview(resolution);
}
```

The resolver never mutates or merges entities. The caller decides how to store,
review, approve, apply, or reverse a proposed link. The mapper likewise does
not connect to source systems, persist records or receipts, or promote asserted
source authority. Each proposal binds the canonicalized candidate evidence,
complete rule set (including invalid rules), effective thresholds, and invalid
rule count to `inputHash`, `rulesHash`, and `decisionHash` so reordered but
semantically identical evidence produces the same proposal. Any invalid rule or
blank entity key prohibits automatic matching.

## Evaluate Purpose-Limited Access

`evaluatePurposeLimitedAccess` evaluates a detailed request against a
default-deny policy and returns a deterministic disclosure receipt. An active
explicit deny takes precedence over any allow. An allow rule must cover every
requested data category; a deny rule matches when any requested category is in
scope. Request and policy timestamps must include `Z` or a numeric UTC offset;
invalid, blank, timezone-less, or nonpositive policy windows fail closed. Any
invalid effective bound in the policy denies the request before an allow rule
can be considered. Attribute conditions require the request attribute to be
present; absence never equals a literal value. Omitted selectors are
unconstrained, while present empty or malformed selectors invalidate the policy
rule and fail closed.

```ts
import { evaluatePurposeLimitedAccess } from "@t2kai/core";

const accessReceipt = evaluatePurposeLimitedAccess(
  {
    policyId: "agency.case-read",
    policyVersion: "1.0.0",
    defaultEffect: "deny",
    rules: [{
      ruleId: "assigned-reviewer",
      effect: "allow",
      roles: ["case-reviewer"],
      purposes: ["benefit-determination"],
      subjectRelationships: ["assigned"],
      dataCategories: ["identity", "case-status"],
      jurisdictions: ["US-WA"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2027-01-01T00:00:00.000Z",
      reason: "Assigned reviewers may inspect the minimum case record.",
    }],
  },
  {
    requestKey: "request-2026-08-29-483",
    principalId: "workforce:user-27",
    principalRoles: ["case-reviewer"],
    purpose: "benefit-determination",
    subjectRef: "party:P-483",
    subjectRelationship: "assigned",
    dataCategories: ["identity", "case-status"],
    jurisdiction: "US-WA",
    requestedAt: "2026-08-29T16:05:00.000Z",
    sourceRecordRefs: ["agency.case-api:483"],
  }
);

if (accessReceipt.decision !== "allow") {
  throw new Error(accessReceipt.reason);
}
```

The evaluator is not an authentication token, authorization server, or data
enforcement point. A production caller must authenticate the principal, supply
trusted roles and attributes, enforce the result at the owning system, minimize
the disclosed data, and persist or externally anchor receipts as required.

## Execute and Evaluate a Reference Policy

```ts
import {
  evaluateReferencePolicy,
  evaluateReferenceReplay,
} from "@t2kai/core";

const policy = {
  referencePolicy: {
    rules: [{
      all: [{ path: "metrics.queuePressure", operator: "gte", value: 0.6 }],
      action: "rebalance_route",
    }],
    defaultAction: "hold",
    evaluation: {
      minimumEpisodes: 20,
      minimumImprovement: 0.05,
      confidenceZ: 1.96,
      minimumCoverage: 0.2,
    },
  },
};

const action = evaluateReferencePolicy(policy, currentState);
const replay = evaluateReferenceReplay({
  candidateSpecification: policy,
  baselineSpecification,
  episodes: heldOutEpisodes,
});
```

Replay reports action coverage, paired confidence bounds, low-sample warnings,
and guardrail violations. It does not invent outcomes for actions missing from
the log.

## Persist the Governed Lifecycle

The `@t2kai/core/postgres` subpath owns the `t2k_reference` schema in a database
you provide. `migrate()` is additive and does not delete prior runs.

```ts
import { PostgresReferenceLifecycle } from "@t2kai/core/postgres";

const lifecycle = new PostgresReferenceLifecycle({
  connectionString: process.env.T2K_DATABASE_URL,
});

try {
  await lifecycle.migrate();
  const policy = await lifecycle.createPolicy(
    {
      policyKey: "dispatch",
      label: "Dispatch policy",
      decisionType: "operations.dispatch_overflow",
    },
    { actorType: "agent", actorId: "agent:policy-builder" }
  );
  console.log(policy.id);
} finally {
  await lifecycle.close();
}
```

The reference path freezes the deployed policy hash into each Decision Context,
computes recommendations and rewards rather than accepting caller verdicts,
requires reconciled receipts before closing external-effect episodes, and keeps
training evidence disjoint from held-out evaluation. Policy acceptance,
authorization, evaluation, promotion, and rollback enforce explicit human actors
and separation of duties.

Guardrail failures remain terminal evidence: the business `scalarReward` stays
`null` so objectives cannot trade off a violated guardrail, while the separate
`evaluationReward` receives a fixed `-1` penalty and replay fails any candidate
that reproduces the violating action.

### Persist reconciliation review and lineage

Deterministic `reconcileCanonicalRecords` output remains non-mutating.
Continuing from the `proposal` above, a trusted application may separately
persist a reviewable canonical proposal with the Postgres lifecycle:

```ts
import {
  PostgresReferenceLifecycle,
  computeReferenceReconciliationProposalHash,
} from "@t2kai/core/postgres";

const lifecycle = new PostgresReferenceLifecycle({
  connectionString: process.env.T2K_DATABASE_URL,
});

try {
  await lifecycle.migrate();
  const proposalBody = {
    proposalKey: "party:P-483:revision-1",
    objectType: "party",
    objectKey: "P-483",
    baseRevisionId: null,
    proposedContent: { partyId: "P-483", status: "active" },
    evidence: {
      reconciliationProposalHash: proposal.proposalHash,
      sourceReceiptHashes: proposal.inputReceiptHashes,
    },
    executionReceiptIds: [],
    requiredReviewerRole: "records_steward",
    rationale: "Propose the reviewed source evidence as canonical revision 1.",
  };
  const proposalHash = computeReferenceReconciliationProposalHash(proposalBody);
  const persisted = await lifecycle.createReconciliationProposal(
    {
      ...proposalBody,
      proposalHash,
      idempotencyKey: "party:P-483:proposal-1",
    },
    { actorType: "agent", actorId: "agent:integration-router" },
  );

  const disposition = await lifecycle.reviewReconciliationProposal(
    persisted.id,
    {
      objectType: "party",
      objectKey: "P-483",
      expectedProposalHash: persisted.proposalHash,
      expectedDispositionVersion: 0,
      decision: "approved",
      reviewerRole: "records_steward",
      rationale: "The evidence and authority policy support this revision.",
      idempotencyKey: "party:P-483:review-1",
    },
    { actorType: "human", actorId: "human:records-steward-27" },
  );

  const accepted = await lifecycle.acceptReconciliationProposal(
    persisted.id,
    {
      objectType: "party",
      objectKey: "P-483",
      expectedProposalHash: persisted.proposalHash,
      dispositionId: disposition.id,
      expectedActiveRevisionId: null,
      acceptedByRole: "records_activation_owner",
      rationale: "Activate the independently approved canonical revision.",
      idempotencyKey: "party:P-483:activation-1",
    },
    { actorType: "human", actorId: "human:activation-owner-11" },
  );

  const lineage = await lifecycle.getReconciliationLineage("party", "P-483");
  console.log(lineage?.activeRevision?.id === accepted.revision.id);
} finally {
  await lifecycle.close();
}
```

`executionReceiptIds` refers only to persisted lifecycle execution receipts.
At proposal creation, each linked receipt is copied into immutable
`executionReceipts` evidence with its own digest; the ordered evidence bundle is
bound by `executionEvidenceHash`. Source-mapping receipts and the deterministic
reconciliation proposal can be retained as complete bodies or hashes inside
immutable caller `evidence`.

Proposal creation verifies a caller-supplied self-hash and the current base
revision. Review requires a human with the proposal's declared role. Acceptance
requires a separate human, the approved disposition, the same proposal hash,
and an unchanged active revision. Accepted revisions and activation rows are
append-only. `rollbackReconciliationRevision` activates an exact prior ancestor
without deleting later history. `reactivateReconciliationRevision` provides a
separately governed roll-forward to an exact existing revision; it appends a
new activation rather than copying or rewriting content.
`getReconciliationLineage` returns the object, active revision, proposals,
dispositions, revisions, and all acceptance, rollback, and reactivation events.
Changed idempotent retries, stale calls, cross-object references, duplicate
canonical content, and self-review fail closed.

Call these persistence methods only from trusted application code after the
calling service has authenticated and authorized the actor. The MCP integration
tools do not persist their outputs, and setting `T2K_DATABASE_URL` on the MCP
server does not turn a mapping, reconciliation, entity-link, or access result
into an accepted or active record. Human review and activation remain separate
application gates outside MCP.

### Trust boundary

This package is an application runtime, not an identity provider. Actor types
and IDs are asserted by the calling server. A production integration must
authenticate the caller, map organization roles to actor IDs, authorize each API
operation, and protect the database credential before invoking the lifecycle.
`requiredAuthority` is preserved as decision evidence; the reference package
does not resolve it against an external IAM system.

The same boundary applies to source envelopes and purpose-access requests:
authentication state, authority references, principal roles, purposes,
relationships, and attributes are caller assertions. The deterministic
utilities preserve or evaluate those assertions but do not verify them against
an external identity provider, source system, policy decision point, or records
authority.

The database trigger prevents ordinary updates and deletes to lifecycle events,
and the hash chain detects mutation. A database owner can still alter or drop
the schema, so systems requiring independent non-repudiation must export or
anchor event heads outside the database.

See the complete runnable flow in
[`examples/harborlight/lifecycle.mjs`](../../examples/harborlight/lifecycle.mjs).

## Call a Hosted Control Plane

Use the client only from trusted server, worker, CLI, or agent-host code. Never
embed a control-plane API key in browser-delivered JavaScript.

```ts
import { T2kClient } from "@t2kai/core";

const t2k = new T2kClient({
  baseUrl: "https://studio.t2k.ai",
  apiKey: process.env.T2K_API_KEY,
});

const graphs = await t2k.listKnowledgeGraphs();
```

The hosted service is not a runtime dependency for local validation,
compilation, policy execution, replay, reward computation, or lifecycle
persistence.

## License

Apache-2.0. Contributions require DCO sign-off in the public repository.
