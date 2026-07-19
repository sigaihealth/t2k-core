# `@t2kai/core`

Portable contracts and deterministic components for ontology-centered,
governed decision agents.

The package includes:

- typed graph, claim, decision, policy, execution, observation, and learning contracts;
- exact ontology-pack validation against the published JSON Schema;
- deterministic pack compilation, dependency resolution, and semantic hashes;
- an executable reference rule policy and held-out replay evaluator;
- deterministic reward assessment and per-policy aggregation;
- a Postgres reference lifecycle for contexts, episodes, receipts, evaluation,
  promotion, rollback, and an append-only event chain;
- `T2kClient` for trusted server-side calls to a T2K control plane.

The package uses Ajv for exact schema execution and `pg` for the optional local
lifecycle. Node.js 20.10 or newer is required. The compiler and Postgres
subpaths are server-side modules.

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

### Trust boundary

This package is an application runtime, not an identity provider. Actor types
and IDs are asserted by the calling server. A production integration must
authenticate the caller, map organization roles to actor IDs, authorize each API
operation, and protect the database credential before invoking the lifecycle.
`requiredAuthority` is preserved as decision evidence; the reference package
does not resolve it against an external IAM system.

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
