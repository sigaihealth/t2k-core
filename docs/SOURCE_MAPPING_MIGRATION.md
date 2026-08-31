# Governed Source-Mapping Migration

## Compatibility classification

This change is proposed as a minor, opt-in extension to the v1 ontology-pack
vocabulary. Existing descriptive `sourceMappings` remain schema-valid. The
parser omits absent execution fields, so their normalized manifest content and
semantic hash shape do not acquire new defaults.

The new executor intentionally does not infer executable behavior from legacy
`fields`, `properties`, or `transform` strings. Passing a descriptive mapping
to `executeSourceMapping` returns a rejected, human-review-required receipt; it
does not throw, execute manifest text, or emit an identity.

The compiler also closes latent integrity gaps for executable mappings and
dangling event object references. A manifest that depended on an unresolved
event target, duplicate source target, alias-mismatched identity reference, or
missing replay key must be corrected before it can compile under the updated
reference implementation.

## Migrate a descriptive mapping

Keep the existing mapping ID and add:

1. `mappingVersion` and `sourceSchemaVersion`;
2. one or more fully specified `fieldMappings` using safe `$.path` selectors;
3. `targetIdentity`, with every identity property mapped exactly once from a
   required source field using the same property reference and declared as
   identity by the target object or an inherited object type;
4. `driftPolicy`, `lateArrivalPolicy`, and `humanCheckpoint`;
5. an explicit `replayable` flag and, when true, `idempotencyPath`;
6. optional event and observation time paths whose values always include `Z`
   or a numeric UTC offset. Control paths must select a field below `$`; the
   payload root is not a valid idempotency or time selector.
7. for new integrations, `sourceSystem`, `sourceLocatorMatch`, and
   `acceptedAuthorityRefs`, then pass the registry-selected mapping hash as
   `expectedMappingHash` at execution. These selectors are optional for legacy
   compatibility but prevent a schema-compatible envelope from another source
   or authority from being routed through the mapping.

Idempotency values must be nonblank, finite, and contain evidence at every
composite level. Empty arrays and objects are invalid. Persist the accepted
idempotency key together with its source-payload and canonical-output hashes;
a key alone cannot prove that a later record is an exact replay.

Every field mapping must declare requiredness, fixed normalizations, a
primitive `valueMap`, authority domain, and conflict policy. Do not translate a
legacy free-form `transform` into executable code. Express only allowlisted
normalizations and keep novel transformations outside the pack behind a
reviewed, versioned connector boundary.

## Release and rollback

Compile the migrated pack, run it against synthetic and held-out source
fixtures, verify duplicate/replay, nested drift, late-arrival, missing identity,
and ambiguous entity cases, and capture the resulting hashes. Keep the prior
descriptive pack version available for documentation rollback, but never route
it to the executor. Deployment, source credentials, IAM enforcement, receipt
persistence, and authority acceptance remain responsibilities of the calling
system.
