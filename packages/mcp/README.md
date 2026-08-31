# `@t2kai/mcp`

Local stdio MCP server for the open T2K ontology, decision, and learning
runtime. It lets an MCP host validate and compile ontology packs, map and
reconcile supplied evidence, propose reversible entity links, evaluate
purpose-limited access and policies, and optionally inspect or write a local
governed lifecycle.

Node.js 20.10 or newer is required.

## Start in the Safe Default Mode

Use this standard MCP host configuration:

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

The default mode has no network or database requirement and exposes only
deterministic, read-only computation:

- `validate_ontology_pack`
- `compile_ontology_pack_set`
- `evaluate_reference_policy`
- `evaluate_reference_replay`
- `evaluate_reference_reward`
- `map_governed_source_record`
- `propose_canonical_reconciliation`
- `propose_entity_link`
- `evaluate_purpose_limited_access`

The `t2k://capabilities` resource reports the active mode, exact tool set, and
public input limits.

## Evaluate Integration Evidence Without Writing It

The four integration tools are available in the database-free safe default
mode. They accept only caller-supplied JSON and are deterministic, read-only
computations:

- `map_governed_source_record` applies one explicit executable source mapping
  to one immutable source envelope. It returns a canonical-record proposal and
  a source receipt, including rejected, quarantined, duplicate, and
  human-review state. It does not fetch a source, use credentials, persist the
  receipt, or accept mapped values as truth.
- `propose_canonical_reconciliation` checks supplied mapping receipts,
  canonical-output hashes, identity evidence, and field provenance before
  applying an explicit versioned authority policy. It preserves alternatives
  and returns a non-mutating proposal; it does not update a canonical store or
  promote selected evidence.
- `propose_entity_link` scores supplied candidates under explicit identifier
  rules. Its result is reversible and may require review. It never creates or
  merges entities.
- `evaluate_purpose_limited_access` applies an explicit-deny-precedence,
  default-deny policy and returns a deterministic receipt. The receipt is not
  authentication, an IAM decision, a bearer token, or permission to disclose
  data.

A typical local analysis maps independently supplied records and then passes
their complete results to `propose_canonical_reconciliation`:

```text
source envelope + reviewed mapping -> map_governed_source_record -> receipt
receipts + authority policy -> propose_canonical_reconciliation -> proposal
```

That is the only data-flow edge among the four integration tools.
`propose_entity_link` evaluates its own candidate-and-rule input, and
`evaluate_purpose_limited_access` evaluates its own request-and-policy input.
They are independent computations, not later stages of one automatic pipeline.
None of the four tools stores another tool's result, accepts a human
disposition, merges an entity, activates a canonical revision, or enforces an
access decision.

Inputs use strict JSON schemas: unknown control fields such as `persist`,
`merge`, credentials, or caller-supplied approval state are rejected before
execution. Before schema parsing can strip or normalize anything, every nested
object is recursively inspected by own property descriptor; `__proto__`,
`prototype`, and `constructor` keys, accessors, symbols, and cyclic object
graphs fail closed. Ordinary JSON objects and null-prototype data objects remain
valid. Calls are also bounded to 32 nested levels, 50,000 traversed nodes,
10,000 entries per collection, and 1,000,000 characters per string; key batch
schemas advertise tighter limits where appropriate. Semantic inconsistencies
that pass structural parsing still fail closed
in the core result, such as an invalid source-receipt hash or an invalid
purpose-access request time.

For release-bound compilation, pass `mode: "deployment"`; this permits only
accepted packs. New reward callers should pass `evidenceMode: "strict"` after
supplying the method-specific evidence references. Source mapping accepts the
optional source selectors from the ontology pack plus `expectedMappingHash` to
pin the exact reviewed mapping revision.

## Add a Local Lifecycle

Set `T2K_DATABASE_URL` to expose lifecycle inspection without enabling writes:

```json
{
  "mcpServers": {
    "t2k": {
      "command": "npx",
      "args": ["-y", "@t2kai/mcp@0.3.0"],
      "env": {
        "T2K_DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5432/t2k",
        "T2K_MCP_AUTO_MIGRATE": "true"
      }
    }
  }
}
```

This adds `get_active_policy`, `get_lifecycle_snapshot`,
`verify_event_chain`, and the `t2k://lifecycle/snapshot` resource. Schema
migration is additive and idempotent; it is opt-in so the process does not
silently claim a database schema. `T2K_DATABASE_URL` does **not** change the
four integration tools: their mapping, reconciliation, entity-link, and access
outputs remain read-only and are not automatically persisted or activated.

## Explicitly Enable Agent Writes

Mutation tools require all three settings:

```json
{
  "T2K_DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5432/t2k",
  "T2K_MCP_ALLOW_MUTATIONS": "true",
  "T2K_MCP_ACTOR_ID": "agent:local-assistant"
}
```

Every write is then recorded as that fixed `agent` identity. A tool call cannot
supply or override `actorType` or `actorId`. Agent mode can create policies and
contexts, compute recommendations, open already-authorized episodes, record
receipts and observations, assess rewards, and propose learning candidates.

The server deliberately does **not** expose operations that assert a human
judgment:

- policy acceptance or deployment;
- recommendation authorization;
- episode closure;
- candidate evaluation, promotion, deployment, or rollback.

Those operations must run through a trusted human interface that authenticates
the reviewer and enforces separation of duties. This omission is a security
boundary, not an incomplete tool list.

Persisting a reconciliation proposal, recording an authenticated human
disposition, and accepting or activating an append-only canonical revision are
trusted-application operations through `PostgresReferenceLifecycle`. They are
outside the MCP integration tools even when lifecycle reads or agent-authored
writes are enabled.

## Programmatic Use

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createT2kMcpRuntime } from "@t2kai/mcp";

const runtime = await createT2kMcpRuntime({
  connectionString: process.env.T2K_DATABASE_URL,
  allowMutations: false,
});

await runtime.server.connect(new StdioServerTransport());
```

An application can instead provide an existing `PostgresReferenceLifecycle`.
The runtime closes only database pools that it creates itself.

## Threat Boundary

- Treat MCP tool arguments as untrusted input; the core runtime validates
  manifests, policy contracts, state, rewards, receipts, and lifecycle order.
- Treat source receipts, reconciliation and entity-link proposals, and access
  receipts as evidence artifacts only. Persisting evidence, authenticating a
  principal, accepting facts, merging entities, and enforcing disclosure all
  remain responsibilities of the calling system and its human governance.
- Use a dedicated database role and database. Database ownership can bypass the
  append-only trigger, so independently anchor event heads when non-repudiation
  is required.
- Keep database URLs out of committed host configuration. Prefer environment or
  secret injection supported by the MCP host.
- Mutation mode does not authenticate a human and must not be used as a path to
  synthesize human approvals.

See the full integration guide in
[`docs/MCP.md`](../../docs/MCP.md) and the lifecycle trust boundary in
[`packages/core/README.md`](../core/README.md).

## License

Apache-2.0. Contributions require DCO sign-off in the public repository.
