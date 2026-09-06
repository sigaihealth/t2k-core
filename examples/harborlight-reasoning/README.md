# Harborlight graph-function experiment

From the repository root:

```bash
npm run example:harborlight:reasoning
```

The script compiles the synthetic ontology, executes typed dispatch feasibility
checks, and evaluates a repaired function against a deliberately faulty
hand-authored baseline. It exits nonzero if the expected behavior fails and prints
JSON with claim evidence, exclusions, execution hashes, and evaluation failures.

The repaired function checks availability, qualifications, capacity, and the
service window. Fifteen labeled cases include missing, stale, proposed, negated,
contradictory, and unsupported evidence, partial coverage, empty routes, and inert
source instructions. The program returns options or explicit unresolved evidence;
it never authorizes a dispatch action.

- `ontology-pack.json`: editable synthetic job, route, crew, and function definitions.
- `fixtures.mjs`: JSON-compatible programs, snapshots, labels, and hard constraints.
- `run.mjs`: compiled execution and computed baseline comparison.

The deliberate defect and hand-authored repair demonstrate the mechanism.
There is no model-generated candidate or independent benchmark claim. The
existing Harborlight policy/lifecycle example remains separate.

See [Graph functions](../../docs/GRAPH_FUNCTIONS.md) for the API and trust boundary.
