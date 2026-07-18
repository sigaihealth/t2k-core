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

## What Is Implemented

- the versioned ontology-pack specification and exact JSON Schema;
- strict manifest validation through the published schema;
- deterministic pack compilation, dependency resolution, and semantic hashes;
- typed graph, claim, decision, execution, observation, and learning contracts;
- a server-side REST client for the hosted control plane;
- an executable reference policy and held-out replay evaluator;
- per-policy reward aggregation;
- conformance fixtures and an independently runnable synthetic example.

The public preview does not yet include the Postgres lifecycle runtime, packaged
MCP adapter, or `create-t2k` scaffolder. Those are tracked in [ROADMAP.md](ROADMAP.md)
rather than presented as shipped behavior.

## Quick Start

Requirements: Node.js 20.10 or newer and npm.

```bash
git clone https://github.com/sigaihealth/t2k-core.git
cd t2k-core
npm ci
npm run check
```

Run only the synthetic Harborlight example:

```bash
npm run example:harborlight
```

It validates and compiles a fictional field-service ontology, then evaluates a
challenger against a disjoint 20-episode holdout. Both policies have logged
action support; the evaluator computes the result rather than accepting caller
supplied metrics.

## Package Preview

Until the first npm release, build a normal installable tarball:

```bash
npm pack --workspace @t2k/core
npm install /path/to/t2k-core-0.1.0.tgz
```

```ts
import {
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  validateOntologyPackManifest,
} from "@t2k/core";
import { compileOntologyPackSet } from "@t2k/core/compiler";
```

See [packages/core/README.md](packages/core/README.md) for API examples and
[spec/v1.0/README.md](spec/v1.0/README.md) for the normative contract. The
non-normative pre-v1 migration path is documented separately in
[COMPATIBILITY.md](COMPATIBILITY.md).

## Project Boundaries

| Open here | Separate hosted product |
| --- | --- |
| Specification and schema | Managed semantic registry |
| Compiler and typed contracts | Multi-tenant Studio operations |
| Reference policy and replay | Fleet shadow/canary orchestration |
| Conformance kit and synthetic examples | Private packs and verified fact corpus |
| API client | Enterprise identity, connectors, and SLAs |

## Contributing

Contributions use the [Developer Certificate of Origin](DCO.md), not a CLA.
Every commit must include a `Signed-off-by` line. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), and
[SECURITY.md](SECURITY.md).

Apache-2.0 covers the code and specification. T2K names and marks remain subject
to [TRADEMARKS.md](TRADEMARKS.md).
