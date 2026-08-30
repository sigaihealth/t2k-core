# T2K Core

T2K is an open semantic contract for governed AI decisions. It separates what
exists, what is true now, what matters, what is allowed, what was recommended,
what a human authorized, what ran, and what happened next.

```text
Decision = Reasoning(Ontology, Facts, Objective, Policies)
Execution = AuthorizedAction(Decision, Capability, Rollback)
Learning = GovernedPromotion(ClosedEpisodes, HeldOutEvaluation)
```

This repository contains the Apache-2.0 standard and portable developer
runtime. The hosted Studio, managed registry, cross-organization knowledge
network, private packs, and customer data are separate products.

## What Is Implemented on `main`

- the versioned ontology-pack specification and exact JSON Schema;
- strict manifest validation through the published schema;
- deterministic pack compilation, dependency resolution, and semantic hashes;
- typed graph, claim, decision, execution, observation, and learning contracts;
- governed source mapping with schema-drift, late-arrival, idempotency, and
  field-level provenance receipts;
- deterministic canonical-record reconciliation with receipt self-consistency
  checks, explicit authority ranking, preserved alternatives, and non-mutating
  proposals;
- persisted reconciliation review with immutable proposals and human
  dispositions, snapshotted execution evidence, append-only canonical
  revisions, lineage, exact rollback, and governed reactivation;
- reversible, evidence-scored entity-resolution proposals that route ambiguous
  candidates to human review;
- deterministic purpose-limited access evaluation with explicit-deny
  precedence, mandatory default deny, and hashed disclosure receipts;
- a server-side REST client for the hosted control plane;
- an executable reference policy and held-out replay evaluator;
- deterministic reward computation and per-policy aggregation;
- a Postgres reference lifecycle with frozen contexts, authorization, execution
  receipts, observations, promotion, exact rollback, and a hash-chained ledger;
- conformance fixtures and an independently runnable synthetic example;
- a tested `create-t2k` scaffolder for local governed-decision and
  integration-hub projects;
- a safe local stdio MCP adapter with read-only defaults, a fixed agent identity
  for opt-in lifecycle writes, four non-mutating integration tools, and no
  agent-accessible human-governance transitions.

## Quick Start

Requirements: Node.js 20.10 or newer and npm.

```bash
npx create-t2k@0.4.1 my-decision-loop
cd my-decision-loop
npm start
```

`npm start` validates and compiles an editable ontology, compares a baseline and
challenger on disjoint held-out evidence, and produces a recommendation that
still requires human authorization.

The published generated project also includes an optional persisted local
lifecycle:

```bash
npm run db:up
npm run lifecycle
```

Use `npm run db:down` to stop the local containers while preserving the database
volume. Use the explicitly destructive `npm run db:reset` only when you intend
to delete the disposable lifecycle data.

Generate a governed integration-hub project instead:

```bash
npx create-t2k@0.4.1 my-integration-hub --profile integration-hub
cd my-integration-hub
npm start
```

This profile maps two independent synthetic sources onto one canonical party,
preserves conflicting evidence, applies an explicit authority policy, proves
order-independent reconciliation, and emits a pending human-review packet. See
the [integration-hub tutorial](docs/INTEGRATION_HUB_TUTORIAL.md) for the full
ontology, agent, persistence, lineage, rollback, and reactivation path.

## Explore the Repository Examples

From a contributor checkout prepared as described below, run the synthetic
Harborlight decision and replay example:

```bash
npm run example:harborlight
```

It validates and compiles a fictional field-service ontology, then evaluates a
challenger against a disjoint 20-episode holdout. Both policies have logged
action support; the evaluator computes the result rather than accepting caller
supplied metrics.

Run the synthetic public-benefits integration example:

```bash
npm run example:public-benefits-profile
```

This compiles a shared ontology across mainframe, secondary-registry, batch,
authenticated API, and document-derived inputs; emits source and mapping
receipts; reconciles competing canonical values under an explicit authority
policy; detects drift, replay, and late arrival; proposes reversible entity
links; and evaluates purpose-limited access. It contains no claimant data and
does not emulate an agency deployment.

Run Harborlight through the persisted closed loop:

```bash
docker compose -f examples/harborlight/compose.yml up -d --wait
npm run example:harborlight:lifecycle
docker compose -f examples/harborlight/compose.yml down -v
```

This records 24 authorized episodes with reconciled execution receipts and
observed outcomes, computes held-out replay, promotes the candidate through an
independent human role, and proves exact rollback.

### Run the integration-hub demo app

The repository also includes a browser tutorial built directly on the public
core APIs. From a contributor checkout:

```bash
npm ci
npm run build --workspace @t2kai/core
npm test --prefix examples/integration-hub-demo
npm run smoke --prefix examples/integration-hub-demo
npm start --prefix examples/integration-hub-demo
```

Open <http://127.0.0.1:4173>. The demo maps three synthetic agency schemas,
preserves receipt-bound conflicts, proves proposal stability across three input
orders, routes an ambiguous reversible entity link to review, compares allow
and default-deny access receipts, and records only an in-memory human
disposition. It does not activate a canonical revision, merge an entity, or
enforce access. Follow the
[integration-hub tutorial](docs/INTEGRATION_HUB_TUTORIAL.md) for the complete
walkthrough and safe experiment rules.

## Connect an MCP Host

Connect an MCP host without a database or credentials:

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

This safe default exposes ontology validation and compilation; reference
policy, replay, and reward computation; and read-only source mapping,
reconciliation, entity-link, and purpose-access evaluation. These four
integration tools are independent computations: mapped results can feed
reconciliation, while entity-link and purpose-access evaluation do not form
later stages of one automatic pipeline. Setting `T2K_DATABASE_URL` adds the
separate lifecycle tool set; it does not persist or activate any integration
tool output. See [docs/MCP.md](docs/MCP.md) before enabling lifecycle
persistence or agent writes.

## Install the Packages

The canonical npm package is `@t2kai/core`. The namespace mirrors `t2k.ai`;
the shorter `@t2k` namespace belongs to an unrelated npm user.

```bash
npm install @t2kai/core@0.4.1
npm install @t2kai/mcp@0.3.0
```

```ts
import {
  T2kClient,
  evaluatePurposeLimitedAccess,
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  executeSourceMapping,
  reconcileCanonicalRecords,
  resolveEntityCandidates,
  validateOntologyPackManifest,
} from "@t2kai/core";
import { compileOntologyPackSet } from "@t2kai/core/compiler";
import { PostgresReferenceLifecycle } from "@t2kai/core/postgres";
```

`@t2kai/core@0.4.1` includes the governed source-mapping,
canonical-reconciliation, entity-resolution, and purpose-access exports plus
the persisted reconciliation review and lineage path documented in the core
guide.

See [packages/core/README.md](packages/core/README.md) for API examples and
[packages/mcp/README.md](packages/mcp/README.md) for MCP modes and security, and
[spec/v1.0/README.md](spec/v1.0/README.md) for the normative contract. The
non-normative pre-v1 migration path is documented separately in
[COMPATIBILITY.md](COMPATIBILITY.md).

## Project Boundaries

| Open here | Separate hosted product |
| --- | --- |
| Specification and schema | Managed semantic registry |
| Compiler and typed contracts | Multi-tenant Studio operations |
| Reference policy, reward, replay, local Postgres lifecycle, and human-reviewed canonical revision history | Fleet shadow/canary orchestration |
| Governed source mapping, non-mutating canonical reconciliation, reversible entity resolution, and purpose-access receipts | Managed connector transport, enterprise IAM enforcement, and compliance operations |
| Scaffolder, local MCP adapter, conformance kit, and synthetic examples | Private packs and verified fact corpus |
| API client | Enterprise identity, managed service operations, and SLAs |

The source-integration, reconciliation, and purpose-access utilities are
deterministic reference functions. They do not fetch or mutate source systems,
authenticate principals, enforce an IAM decision, persist receipts, merge
entities, or promote source data or proposals to accepted authority; the
calling application owns those controls.

## Contributing

Contributions use the [Developer Certificate of Origin](DCO.md), not a CLA.
Every commit must include a `Signed-off-by` line. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), and
[SECURITY.md](SECURITY.md).

Prepare a contributor checkout and run the complete verification suite:

```bash
git clone https://github.com/sigaihealth/t2k-core.git
cd t2k-core
npm ci
npm run check
```

`npm run check` is the maintainer-grade suite: type checking, unit tests,
conformance, examples, package smoke tests, and the production dependency
audit. Use `npm run example:scaffold` to exercise a freshly generated project
against a clean local `@t2kai/core` tarball.

Apache-2.0 covers the code and specification. T2K names and marks remain subject
to [TRADEMARKS.md](TRADEMARKS.md).
