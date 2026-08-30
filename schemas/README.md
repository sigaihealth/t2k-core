# Schemas

`t2k-ontology-pack.v1.schema.json` is the normative schema for ontology-pack
manifest version 1.0. The byte-identical artifact is copied into the published
`@t2kai/core` package during build.

The stable network identifier is:

```text
https://t2k.ai/schemas/t2k-ontology-pack.v1.schema.json
```

Do not change the meaning of that identifier in place. Compatibility changes
require the process in `GOVERNANCE.md` and, when incompatible, a new schema ID.

The governed source-mapping fields added under the v1 family are an optional,
minor-version extension. A mapping without `fieldMappings` keeps the original
descriptive contract. Once `fieldMappings` is present, the conditional schema
requires the complete executable profile; this prevents a partially specified
mapping from being mistaken for an execution contract. Migration and
compatibility details are in `docs/SOURCE_MAPPING_MIGRATION.md`.
