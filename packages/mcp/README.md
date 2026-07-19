# `@t2kai/mcp`

Local stdio MCP server for the open T2K ontology, decision, and learning
runtime. It lets an MCP host validate and compile ontology packs, execute and
evaluate policies, and optionally inspect or write a local governed lifecycle.

Node.js 20.10 or newer is required.

## Start in the Safe Default Mode

Use this standard MCP host configuration:

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

The default mode has no network or database requirement and exposes only
deterministic, read-only computation:

- `validate_ontology_pack`
- `compile_ontology_pack_set`
- `evaluate_reference_policy`
- `evaluate_reference_replay`
- `evaluate_reference_reward`

The `t2k://capabilities` resource reports the active mode and exact tool set.

## Add a Local Lifecycle

Set `T2K_DATABASE_URL` to expose lifecycle inspection without enabling writes:

```json
{
  "mcpServers": {
    "t2k": {
      "command": "npx",
      "args": ["-y", "@t2kai/mcp@latest"],
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
silently claim a database schema.

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
