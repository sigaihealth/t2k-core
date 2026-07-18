# `@t2k/core`

Portable contracts and deterministic components for ontology-centered,
governed decision agents.

The package includes:

- typed graph, claim, decision, policy, execution, observation, and learning contracts;
- exact ontology-pack validation against the published JSON Schema;
- deterministic pack compilation, dependency resolution, and semantic hashes;
- an executable reference rule policy and held-out replay evaluator;
- per-policy reward aggregation;
- `T2kClient` for trusted server-side calls to a T2K control plane.

The package has one runtime dependency, Ajv, so its parser executes the
published schema rather than maintaining a second validity contract. Node.js
20.10 or newer is required. The compiler subpath uses Node cryptography.

## Compile Packs Locally

```ts
import { compileOntologyPackSet } from "@t2k/core/compiler";

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
import { validateOntologyPackManifest } from "@t2k/core";

const validation = validateOntologyPackManifest(manifest);
if (!validation.valid) {
  console.error(validation.errors);
}
```

The canonical package schema is exported as
`@t2k/core/schema/t2k-ontology-pack.v1.json`.

## Execute and Evaluate a Reference Policy

```ts
import {
  evaluateReferencePolicy,
  evaluateReferenceReplay,
} from "@t2k/core";

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

## Call a Hosted Control Plane

Use the client only from trusted server, worker, CLI, or agent-host code. Never
embed a control-plane API key in browser-delivered JavaScript.

```ts
import { T2kClient } from "@t2k/core";

const t2k = new T2kClient({
  baseUrl: "https://studio.t2k.ai",
  apiKey: process.env.T2K_API_KEY,
});

const graphs = await t2k.listKnowledgeGraphs();
```

The hosted service is not a runtime dependency for local validation,
compilation, policy execution, replay, or reward aggregation.

## License

Apache-2.0. Contributions require DCO sign-off in the public repository.
