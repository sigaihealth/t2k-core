# `create-t2k`

Create a runnable local T2K project with a synthetic ontology, accepted facts,
a Decision Context, two executable policies, and disjoint replay evidence.
The existing decision-loop project remains the default profile.

```bash
npx create-t2k@latest my-decision-loop
cd my-decision-loop
npm start
```

The generated run validates and compiles the ontology pack, executes the
baseline and challenger policies against the current facts, computes a held-out
replay comparison, and emits a recommendation that still requires explicit
human authorization.

The generated project also includes a PostgreSQL 16 Compose service and a
persisted golden path:

```bash
npm run db:up
npm run lifecycle
```

That command records authorization, execution receipts, observations, computed
rewards, held-out evaluation, independent promotion, and exact rollback in the
open reference runtime.

Stop the local containers without deleting lifecycle data with `npm run
db:down`. Use the explicitly destructive `npm run db:reset` only when you
intend to delete the disposable local database volume.

To expose ontology validation, compilation, policy execution, replay, and
reward evaluation to an MCP host, add:

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

This starts read-only and does not send project data to a hosted service. See
the [`@t2kai/mcp` guide](https://github.com/sigaihealth/t2k-core/blob/main/packages/mcp/README.md)
before enabling database access or agent writes.

Use `--no-install` to generate files without running `npm install`:

```bash
npx create-t2k@latest my-decision-loop --no-install
```

The command refuses to write into a non-empty directory. Node.js 20.10 or newer
is required.

## Integration-hub profile

Generate a focused, fully synthetic source-integration project explicitly:

```bash
npx create-t2k@latest my-integration-hub --profile integration-hub
cd my-integration-hub
npm start
```

This profile maps two independent registry records into one canonical party
identity, preserves conflicting name evidence, and applies a versioned authority
order to a conflicting registry state. It runs reconciliation again with the
opposite input order and proves the proposal hash is identical.

Every regular `source-records/*.json` file is discovered in canonical filename
order, so the generated README experiments work without editing the runner:
reverse the versioned authority priorities or add a third synthetic source with
the same canonical key and run `npm start` again.

The output is a deterministic evidence packet for human review. It preserves
the complete source receipts and alternatives inside the hashed packet, does
not mutate any source record, and does not promote the authority-selected
candidate to accepted truth. Both included synthetic sources deliberately have
an `unknown` authentication state. The unkeyed hashes demonstrate deterministic
self-consistency only; they are not signatures, authentication, or proof that a
source assertion is true.

Supported profiles are `decision-loop` (the default) and `integration-hub`.
An unknown or repeated `--profile` option fails before the target directory is
created.

Apache-2.0. Contributions require DCO sign-off in the public repository.
