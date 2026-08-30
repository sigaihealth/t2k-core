# Build a Governed Integration Hub with T2K

This tutorial builds a small, fully synthetic integration hub. It shows how to
map independently governed sources onto shared ontology concepts, preserve
conflicting evidence, propose a canonical view, route judgment to a human, and
limit downstream use by purpose.

The important boundary is simple: mapping and reconciliation produce evidence
and proposals. They do not authenticate a source, overwrite a source system,
merge an entity, authorize disclosure, or declare a value to be true.

## Architecture

```text
independent source systems
        |  immutable envelopes + reviewed mappings
        v
source receipts and field-level provenance
        |
        v
ontology layer: shared parties, relationships, states, and identifiers
        |
        v
non-mutating reconciliation + reversible entity-link proposals
        |
        +---------------- AI agent: map, compare, score, route, explain
        |                 Human: authenticate, review, accept, reject
        v
append-only canonical revisions + activation history
        |
        +---------------- exact rollback/reactivation changes only the active pointer
        v
purpose-limited access evaluation for downstream workflows
```

The ontology layer is the stable contract above sources that change at
different speeds. A connector can be replaced or a source schema can drift
without redefining the shared meaning of a party, identifier, relationship, or
status. Source-specific details remain in receipts and provenance instead of
being silently flattened into a monolithic record.

## 1. Generate the Integration-Hub Profile

Node.js 20.10 or newer is required.

```bash
npx create-t2k@latest my-integration-hub --profile integration-hub
cd my-integration-hub
npm start
```

The generated project contains two synthetic registries that refer to the same
canonical party identity. Its run:

1. validates and compiles the ontology pack;
2. maps both immutable source envelopes;
3. preserves both conflicting display-name candidates;
4. applies an explicit versioned authority order to a registry-state conflict;
5. reruns reconciliation with reversed source order; and
6. emits a deterministic evidence packet for human review.

Inspect these output fields first:

- `sourceEvidence[].summary.receiptHash` identifies each checked mapping result;
- `reconciliation.preserveAll.candidates` retains conflicting values and their
  provenance;
- `reconciliation.preferAuthority.selectedWithinProposal` is a proposal, not
  accepted truth;
- `reconciliation.deterministicAcrossInputOrder` proves source ordering does
  not change the proposal hash;
- `humanReview.status` remains `pending_human_review`; and
- `boundaries` records what the run deliberately did not do.

Try changing one source value, reversing `authority-policy.json`, or adding a
third source with the same identity. The output should change only where the
new evidence or policy requires it.

## 2. Give an AI Agent the Read-Only Computation Layer

Add the database-free MCP server to a local host:

```json
{
  "mcpServers": {
    "t2k": {
      "command": "npx",
      "args": ["-y", "@t2kai/mcp@latest"]
    }
  }
}
```

Then read `t2k://capabilities` and use the four integration tools in sequence:

```text
map_governed_source_record
        -> propose_canonical_reconciliation
        -> propose_entity_link
        -> evaluate_purpose_limited_access
```

`map_governed_source_record` applies one caller-supplied mapping to one
caller-supplied envelope. `propose_canonical_reconciliation` checks receipt and
provenance integrity before applying the authority policy.
`propose_entity_link` creates a reversible scored proposal.
`evaluate_purpose_limited_access` uses explicit-deny precedence and mandatory
default deny.

All four tools are deterministic and read-only. Their strict schemas reject
unknown control fields such as `persist`, `merge`, credentials, and
caller-supplied approval state. A host still needs authenticated source access,
secret handling, a trusted human review path, persistence, and actual IAM
enforcement outside the MCP process.

## 3. Make Human and AI Roles Complementary

A practical operating split is:

| AI agent can prepare | Human or trusted control must decide |
| --- | --- |
| Map a supplied record and explain drift | Authenticate or attest the source |
| Compare evidence and rank candidates | Accept or reject a canonical revision |
| Propose reversible entity links | Approve an actual link or merge |
| Route ambiguous cases | Resolve policy and organizational exceptions |
| Evaluate a purpose-access policy | Authenticate the principal and enforce access |

The AI path remains useful when people are unavailable because it can prepare a
complete review packet. The human path remains authoritative because an agent
cannot turn its own proposal into approval. Systems may back each other up in
workflow routing and explanation without collapsing that separation.

## 4. Persist Reviewable Canonical History

The optional Postgres reference lifecycle provides an append-only path for
reconciliation proposals, human dispositions, accepted canonical revisions,
activation history, lineage inspection, exact rollback to an ancestor, and
governed reactivation of an existing revision. Persistence is a separate gate
after deterministic reconciliation.

For each object:

1. persist the complete proposal content, evidence, base revision, required
   reviewer role, actor, rationale, and expected proposal hash;
2. record an explicit human `approved` or `rejected` disposition;
3. accept only an approved, current-base proposal with the required independent
   role;
4. append a new immutable revision rather than updating history in place;
5. record the active-revision transition; and
6. roll back by activating an exact prior ancestor, never by reconstructing it;
   and
7. roll forward by reactivating an exact existing revision under a fresh,
   independently authorized activation.

The reference lifecycle snapshots and digests every linked persisted execution
receipt, then binds the ordered bundle hash into the proposal. It rejects hash
mismatches, agent-authored human dispositions, reviewer-role mismatches,
self-review, stale base revisions, cross-object revision references, and
unreviewed acceptance. Database owners can bypass database triggers, so
production deployments should use a restricted role and independently anchor
important event heads.

## 5. Production Checklist

Before connecting real systems, require all of the following:

- a versioned canonical schema and ontology ownership process;
- authenticated source transport and explicit authority policy;
- schema-drift, late-arrival, replay, and idempotency handling;
- field-level provenance and retention/classification metadata;
- queues and service levels for ambiguous human-review cases;
- separation between proposal, disposition, activation, and enforcement;
- least-privilege database and IAM roles;
- monitoring for source-version and mapping-version changes; and
- tested lineage export and rollback recovery.

The open runtime supplies the portable semantic and reference-governance
contracts. Managed connectors, enterprise authentication, human identity,
production IAM enforcement, and compliance operations remain deployment
responsibilities or hosted-product capabilities.
