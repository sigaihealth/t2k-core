# Conformance Kit

The conformance runner executes the built reference implementation against
positive and negative fixtures. It verifies:

- exact JSON Schema acceptance and rejection;
- no current-dialect fallback coercion for invalid manifests;
- deterministic compilation when JSON object key order changes;
- schema-valid compiler rejection for duplicate or alias-mismatched source
  targets;
- positive governed source execution and fail-closed legacy/duplicate runtime
  behavior;
- language-neutral JSON vectors for deployment-only pack selection, replay
  identity, deterministic reward evidence, normalized authority sets,
  canonical mapping hashes, and source-binding behavior;
- explicit expected row/work exhaustion, ordinary-return and wrong-error
  rejection, legacy unexpected-error behavior, and malformed resource labels;
- byte identity between the repository schema and package source artifact.

```bash
npm run conformance
```

`valid/` contains schema- and compiler-valid manifests, including the legacy
compatibility boundary. `invalid/` contains schema-invalid manifests.
`compiler-invalid/` contains schema-valid manifests whose references or
execution contracts must fail compilation.
`vectors/` contains portable input/outcome contracts that another language
implementation can consume without importing the TypeScript test suite.

`vectors/graph-resource-limits-v1.json` describes the experimental evaluation v2
extension. Each vector compiles the shared lookup/count program with that
vector's fixed function limits; these are separate compiled fixtures, not
per-case budget overrides. Construct `members` entities named `member-1`, etc.,
and `claims` independent accepted availability claims on `member-1`, using the
shared synthetic ontology. The runner fixes the graph time to
`2026-09-12T12:00:00.000Z` and fills the expected evidence lists from `emptyEvidence`.
Normal inputs return their member count; row/work labels pass only on the exact
typed error. `evaluationStatus`, `actualError`, `hasResult` and `preflightError`
declare the expected outcomes independently of the TypeScript unit tests.

Contributions that change normative behavior must add or update fixtures. Keep
all fixture organizations, facts, and source locators fully synthetic.
