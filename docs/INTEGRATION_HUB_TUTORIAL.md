# Build and Test a Governed Integration Hub with T2K 0.4.1

This tutorial offers two runnable paths. The generated profile is the smallest
way to inspect a complete evidence packet. The repository demo adds a browser
review experience, a third source, entity-link ambiguity, and purpose-limited
access. Both use synthetic data and the real `@t2kai/core` runtime.

The governing boundary is the same in both paths: mapping and reconciliation
produce evidence and non-mutating proposals. They do not authenticate a source,
overwrite a source system, merge an entity, authorize disclosure, or make a
candidate canonical revision active.

## Architecture

```text
independent source systems
        |  immutable envelopes + reviewed, versioned mappings
        v
source receipts and field-level provenance
        |
        v
ontology layer: shared parties, relationships, states, and identifiers
        |
        v
non-mutating reconciliation proposal
        +---------------- AI assist: map, compare, trace, route, explain
        +---------------- Human: attest, review, accept, reject
        v
trusted application persistence: proposal -> disposition -> activation
        |
        +---------------- append-only lineage and exact rollback/reactivation
        v
independent purpose-access evaluation -> owning IAM enforcement point
```

The ontology is the stable abstraction above sources that change at different
speeds. A connector can be replaced or a source schema can drift without
redefining the shared meaning of a party, identifier, relationship, or status.
Source-specific evidence remains in immutable receipts and provenance instead
of being flattened into a monolithic record.

## 1. Generate the Small Integration-Hub Profile

Node.js 20.10 or newer is required.

```bash
npx create-t2k@0.4.1 my-integration-hub --profile integration-hub
cd my-integration-hub
npm start
```

`create-t2k` installs dependencies by default. Run `npm install` only if you
generated the project with `--no-install`.

The generated run:

1. validates and compiles `ontology-pack.json`;
2. maps every regular `source-records/*.json` file in canonical filename order;
3. preserves conflicting evidence under the declared conflict policy;
4. applies the complete versioned `authority-policy.json` to a non-mutating
   reconciliation proposal;
5. compares the proposal produced by forward source order with its reverse; and
6. emits a repeatable, hash-bound packet that remains pending human review.

Inspect these packet fields first:

- `coreRuntime.packageVersion` identifies the exact loaded core runtime;
- `sourceEvidence[]` contains each complete `{ canonicalRecord, receipt }`
  pair, not merely receipt summaries;
- `authorityPolicy` contains the complete policy that was evaluated;
- `reconciliation.proposal` and `reverseInputOrderProposal` preserve the full
  proposals, candidates, issues, and provenance;
- `reconciliation.forwardReverseInputOrderCheck` states the exact comparison
  scope and whether the proposal hashes match;
- `humanReview.issues` retains every reconciliation issue; and
- `evidencePacketHash` binds the complete packet body.

With the two included sources, forward and reverse are all possible orders.
After adding a third source, that check covers only two selected orders; it does
not claim exhaustive permutation testing.

The generated process has no durable accepted-receipt store. It can demonstrate
byte-stable replay output in repeated runs, but it cannot detect idempotency
conflicts across separate invocations. A production caller supplies accepted
idempotency evidence or persists it in a governed store.

## 2. Experiment Without Rewriting Evidence

Once an envelope has been mapped, treat it as immutable. To model a later
observation, copy the source into a new `.json` filename and assign a new:

- `sourceLocator` and `sourceRecordKey`;
- payload `record_id`, which is the generated mapping's idempotency value;
- envelope and payload event times; and
- envelope and payload observation times.

Keep the shared `party_key` when the new record refers to the same canonical
party. Use a new `sourceSystem` when the experiment represents a distinct
synthetic source; do not rename a real source merely to avoid replay controls.
Retain the earlier file so the later run still has the original evidence.

Version the controls with their meaning:

- bump `policyVersion` whenever authority priorities change;
- bump the affected `mappingVersion` whenever paths, transformations,
  authority domains, conflict policies, or `humanCheckpoint` behavior change;
  and
- bump `ontologyVersion` whenever a mapping or another ontology contract
  changes, because mappings are part of the pack.

Changing content without changing the controlling version defeats lineage and
cache interpretation even when the resulting hash changes.

### Read the two value hashes correctly

Field provenance `sourceValueHash` binds the raw JSON value extracted from the
source before normalization and value mapping. A reconciliation candidate's
`valueHash` binds the mapped canonical value after those transformations. For
example, the raw string `" ACTIVE "` and canonical value `"active"` have
different hashes by design. Preserve both: one proves what arrived; the other
identifies the value that reconciliation compared.

### Treat fixture dates as replay controls

The generated records and repository demo use fixed timestamps, policy windows,
and retention metadata so a tutorial run is reproducible. They do not assert
that an access request is currently allowed. `retentionPolicy` is preserved as
metadata; the reference mapper does not schedule deletion or enforce retention.
Production systems must use current governed timestamps and an external records
management control.

## 3. Run the Browser Demo Against the Real Core Package

From a contributor checkout of this repository:

```bash
npm ci
npm run build --workspace @t2kai/core
npm test --prefix examples/integration-hub-demo
npm run smoke --prefix examples/integration-hub-demo
npm start --prefix examples/integration-hub-demo
```

Open <http://127.0.0.1:4173>. Set `T2K_DEMO_PORT` if that port is occupied.

The demo executes these public core APIs at server startup rather than loading
precomputed output:

- `validateOntologyPackManifest` and `compileOntologyPackSet`;
- `executeSourceMapping` for three different synthetic agency schemas;
- `reconcileCanonicalRecords` for preserved and authority-ranked conflicts;
- `resolveEntityCandidates` for an ambiguous, reversible link proposal; and
- `evaluatePurposeLimitedAccess` for an explicit allow and a default deny.

In the browser, compare all three raw sources, expand their mapping receipts,
trace conflicted candidates, inspect the input-order check, review the ambiguous
entity link, and compare the two access receipts. You can submit an attested
human disposition to an in-memory session log. Refreshing or restarting does
not activate the canonical proposal, merge either entity, or turn the access
receipt into a token.

The focused tests exercise the model and HTTP boundary. The isolated smoke
packs `@t2kai/core`, installs that tarball into a clean temporary consumer, and
runs the complete model from published-package output instead of TypeScript
source imports.

## 4. Give an AI Agent Read-Only Computation

Pin the database-free MCP server in a local host:

```json
{
  "mcpServers": {
    "t2k": {
      "command": "npx",
      "args": ["-y", "@t2kai/mcp@0.3.0"]
    }
  }
}
```

The four integration tools are deterministic, read-only computations:

- `map_governed_source_record` maps one caller-supplied immutable envelope;
- `propose_canonical_reconciliation` consumes complete mapping results plus an
  explicit authority policy;
- `propose_entity_link` independently scores its supplied identifiers and
  candidates; and
- `evaluate_purpose_limited_access` independently evaluates its supplied
  request and policy.

Only the map-to-reconciliation edge is a data pipeline. Entity-link and access
evaluation are independent branches, not automatic later stages. No tool stores
another tool's result. Their schemas reject controls such as `persist`, `merge`,
credentials, and caller-supplied approval state.

Setting `T2K_DATABASE_URL` adds a separate lifecycle read tool set; it does not
persist or activate the four integration outputs. Even mutation mode does not
expose human-governance transitions. An AI agent may prepare and explain a
review packet, but it cannot turn its own proposal into an authenticated human
disposition.

## 5. Persist Through Trusted Application Code

Use `PostgresReferenceLifecycle` from a trusted server or worker to persist a
reviewable proposal after deterministic computation. The application must:

1. construct the lifecycle with a protected database credential, call
   `migrate()`, and close it in `finally`;
2. authenticate and authorize the actor before every lifecycle call;
3. persist the complete proposal content, evidence, current base revision,
   required reviewer role, rationale, and expected proposal hash;
4. record an explicit disposition from a human with the required role;
5. accept only an approved, current-base proposal through a separate authorized
   human activation step; and
6. append revisions and activation events rather than updating history in
   place.

Rollback activates an exact prior ancestor; reactivation points to an exact
existing revision under a fresh governed event. Neither operation reconstructs
or rewrites canonical content. See the explicit construction, migration,
`try`/`finally`, review, and activation sample in
[`packages/core/README.md`](../packages/core/README.md).

Database ownership can bypass database triggers. Use a restricted role and
independently anchor important event heads when non-repudiation is required.

## 6. Keep Human and AI Authority Distinct

| AI assist may prepare | Human or trusted control must decide |
| --- | --- |
| Map supplied records and explain drift | Authenticate or attest each source |
| Compare evidence and trace candidates | Approve or reject a canonical proposal |
| Score reversible entity candidates | Approve a real link or merge |
| Route ambiguous cases | Resolve organizational and policy exceptions |
| Explain an access-policy receipt | Authenticate the principal and enforce access |
| Assemble a complete review packet | Persist, accept, and activate a revision |

The two roles complement one another without becoming interchangeable. The AI
path can prepare consistent evidence and keep work moving; the human path owns
judgment, attestation, and external effect.

## Production Checklist

Before connecting real systems, require:

- a versioned canonical schema and ontology ownership process;
- authenticated source transport and explicit authority policy;
- schema-drift, late-arrival, replay, and durable idempotency handling;
- field-level provenance plus enforced classification and retention controls;
- queues and service levels for ambiguous human-review cases;
- separation among proposal, disposition, persistence, activation, and
  enforcement;
- least-privilege database and IAM roles;
- monitoring for source-schema, mapping, ontology, and policy version changes;
  and
- tested lineage export, rollback, and recovery.

The open runtime supplies portable semantic and reference-governance contracts.
Managed connectors, enterprise authentication, human identity, production IAM
enforcement, records management, and compliance operations remain deployment
responsibilities or hosted-product capabilities.
