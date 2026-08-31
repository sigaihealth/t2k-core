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
  identity, deterministic reward evidence, and source-binding behavior;
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

Contributions that change normative behavior must add or update fixtures. Keep
all fixture organizations, facts, and source locators fully synthetic.
