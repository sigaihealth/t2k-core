# Conformance Kit

The conformance runner executes the built reference implementation against
positive and negative fixtures. It verifies:

- exact JSON Schema acceptance and rejection;
- no current-dialect fallback coercion for invalid manifests;
- deterministic compilation when JSON object key order changes;
- byte identity between the repository schema and package source artifact.

```bash
npm run conformance
```

Contributions that change normative behavior must add or update fixtures. Keep
all fixture organizations, facts, and source locators fully synthetic.
