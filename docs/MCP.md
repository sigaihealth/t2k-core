# MCP Adapter Guide

`@t2kai/mcp` makes the open T2K contracts available to any local MCP host over
stdio. It is intentionally an adapter, not a second reasoning implementation:
every tool delegates to `@t2kai/core`, so direct SDK calls and MCP calls follow
the same schema, policy, reward, and lifecycle rules.

## Choose the Weakest Sufficient Mode

| Mode | Configuration | Intended use |
| --- | --- | --- |
| Semantic-only | No environment variables | Validate packs and compute policy, replay, and reward results |
| Lifecycle read-only | `T2K_DATABASE_URL` | Inspect deployed policy, lifecycle state, aggregate evidence, and the event chain |
| Agent mutation | Database URL, mutation opt-in, fixed actor ID | Propose and record machine-authored lifecycle facts without impersonating a human |

Start in semantic-only mode. Add a database only when persistence is needed,
and enable mutation only for a host whose tool permissions and prompts you
control.

## Install and Check

```bash
npx -y @t2kai/mcp@latest --help
```

Add the server to the host's MCP server map:

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

After reconnecting the host, read `t2k://capabilities`. It is the authoritative
runtime declaration of enabled tools, actor identity, and omitted human
operations.

## First Semantic Workflow

1. Call `validate_ontology_pack` with a manifest and fix every schema error.
2. Call `compile_ontology_pack_set` with all local manifests and explicit root
   requirements. The compiler never fetches undeclared dependencies.
3. Call `evaluate_reference_policy` with a policy specification and current
   state to compute the proposed action.
4. Call `evaluate_reference_reward` only after observations are available.
5. Call `evaluate_reference_replay` with disjoint held-out episodes before a
   human considers promotion.

Tool results contain both human-readable JSON text and `structuredContent`, so
hosts can display the result or pass it to another tool without scraping prose.

## Local Closed-Loop Workflow

The MCP adapter cannot complete the entire governed loop by itself. That is
intentional:

```text
agent proposes policy version
human accepts and deploys it outside MCP
agent creates context and computes recommendation
human authorizes the decision outside MCP
agent records episode, execution, observations, and reward
human closes the evidence-complete episode outside MCP
agent proposes a candidate
independent humans evaluate and promote it outside MCP
```

This split ensures that an instruction-injected model cannot approve its own
policy, authorize its own action, close its own evidence record, or promote its
own candidate merely by changing tool arguments.

## Database Setup

The adapter uses the `t2k_reference` Postgres schema from `@t2kai/core`.
Automatic migration is disabled by default:

```bash
export T2K_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/t2k'
export T2K_MCP_AUTO_MIGRATE=true
npx -y @t2kai/mcp@latest
```

For production-like use, run migration in a controlled deployment step and
omit `T2K_MCP_AUTO_MIGRATE` from the long-running server.

## Agent Mutation Setup

```bash
export T2K_MCP_ALLOW_MUTATIONS=true
export T2K_MCP_ACTOR_ID='agent:decision-assistant'
```

The actor ID is fixed at process startup, appears in the capabilities resource,
and is written to the append-only lifecycle ledger. Run separate processes when
separate agent identities are required; do not multiplex identities through one
MCP server.

## Production Conversion

The open adapter is a local reference path. When moving to the hosted T2K
control plane, keep the ontology packs, Decision Context shape, policy and
reward contracts, and agent/human separation. Replace local database ownership
with authenticated hosted API calls, organization roles, managed registry
versions, and managed audit exports. The hosted control plane is deliberately
not selected by an environment switch in this package; that keeps local MCP
credentials from silently becoming tenant-wide credentials.

## Verification

Repository contributors can run:

```bash
npm run test --workspace @t2kai/mcp
npm run pack:mcp
T2K_TEST_DATABASE_URL=postgresql://... npm run check:postgres
```

The tests connect through the MCP protocol, assert the advertised boundary in
all three modes, execute a clean packed stdio server, and verify the Postgres
event chain when a test database is configured.
