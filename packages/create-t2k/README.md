# `create-t2k`

Create a runnable local T2K project with a synthetic ontology, accepted facts,
a Decision Context, two executable policies, and disjoint replay evidence.
The existing decision-loop project remains the default profile.

```bash
npx create-t2k@0.4.3 my-decision-loop
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

Compose binds PostgreSQL to `127.0.0.1:55432` only. The included `t2k` username
and `t2k` password are disposable local-only quickstart credentials; never
reuse them or expose this generated database to another host.

To expose ontology validation, compilation, policy execution, replay, and
reward evaluation to an MCP host, add:

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

This starts read-only and does not send project data to a hosted service. See
the [`@t2kai/mcp` guide](https://github.com/sigaihealth/t2k-core/blob/main/packages/mcp/README.md)
before enabling database access or agent writes.

Use `--no-install` to generate files without running `npm install`:

```bash
npx create-t2k@0.4.3 my-decision-loop --no-install
```

The normal command installs dependencies for you. Run `npm install` inside the
generated project only when you chose `--no-install`.

The command refuses to write into a non-empty directory. Node.js 20.10 or newer
is required.

## Integration-hub profile

Generate a focused, fully synthetic source-integration project explicitly:

```bash
npx create-t2k@0.4.3 my-integration-hub --profile integration-hub
cd my-integration-hub
npm start
```

This profile maps two independent registry records into one canonical party
identity, preserves conflicting name evidence, and applies a versioned authority
order to a conflicting registry state. It runs reconciliation again with the
opposite input order and reports that specifically scoped proposal-hash
comparison; it does not claim to check every permutation after more sources are
added.

Every regular `source-records/*.json` file is discovered in canonical filename
order, so the generated README experiments work without editing the runner:
reverse the authority priorities while bumping `policyVersion`, or add a third
synthetic source with the same canonical key and run `npm start` again.

The output is a deterministic evidence packet for human review. It preserves
every canonical record with its complete receipt, the exact loaded
`@t2kai/core` package version, the complete authority policy, and the full
forward and reverse reconciliation proposals and issues inside the hashed
packet. It does not mutate any source record or promote the authority-selected
candidate to accepted truth. Both included synthetic sources deliberately have
an `unknown` authentication state. The unkeyed hashes demonstrate deterministic
self-consistency only; they are not signatures, authentication, or proof that a
source assertion is true.

After an envelope has been mapped, keep it immutable: represent a later
observation with a new file, source-record key, payload record ID, and event and
observation times. Bump `policyVersion` after changing authority priorities;
bump `mappingVersion` and `ontologyVersion` after changing a mapping; and bump
`ontologyVersion` for any other ontology contract change.

Supported profiles are `decision-loop` (the default) and `integration-hub`.
An unknown or repeated `--profile` option fails before the target directory is
created.

Apache-2.0. Contributions require DCO sign-off in the public repository.
