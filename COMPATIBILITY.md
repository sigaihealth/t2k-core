# Compatibility Profiles

## Current T2K v1

The current conformance path is the v1 JSON Schema plus
`validateOntologyPackManifest`. Validation is exact and occurs before
normalization. Invalid enums, unknown fields, and malformed records are
rejected.

## Legacy Migration Input

`parseOntologyPackManifest` also recognizes a narrow pre-v1 TransferOS manifest
shape when `manifestType` is absent. This is a migration adapter, not a second
standard:

- legacy input does not conform to the T2K v1 schema;
- a consumer MUST NOT advertise legacy acceptance as v1 conformance;
- the adapter contains no private ontology pack, customer vocabulary, or fact data;
- new producers SHOULD emit only `t2k.ontology-pack` manifests;
- consumers SHOULD persist the normalized current manifest and provenance of
  the migration rather than round-tripping the legacy dialect.

The compatibility path is explicit so existing projects can migrate without
making the public schema lenient. Its future removal would require a major
package release and migration notice.
