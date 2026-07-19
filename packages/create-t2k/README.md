# `create-t2k`

Create a runnable local T2K project with a synthetic ontology, accepted facts,
a Decision Context, two executable policies, and disjoint replay evidence.

```bash
npx create-t2k my-decision-loop
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

Use `--no-install` to generate files without running `npm install`:

```bash
npx create-t2k my-decision-loop --no-install
```

The command refuses to write into a non-empty directory. Node.js 20.10 or newer
is required.

Apache-2.0. Contributions require DCO sign-off in the public repository.
