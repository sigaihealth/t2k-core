# Changelog

All notable changes to the public T2K standard and packages will be documented
here. The project follows Semantic Versioning for packages and the compatibility
rules in the versioned specification.

## [Unreleased]

## [0.3.0] - 2026-08-29

### Added

- An opt-in governed source-mapping profile with mapping and source-schema
  versions, safe field mappings, identity contracts, idempotency, drift and
  late-arrival policies, human checkpoints, and field-level provenance and
  reconciliation receipts.
- Reversible evidence-scored entity-link proposals and deterministic,
  purpose-limited access receipts with explicit-deny precedence and default
  deny.
- Deterministic canonical-record reconciliation proposals that cross-check
  receipt self-consistency, canonical output, field provenance, and identity;
  preserve all candidate evidence; apply explicit versioned authority
  priorities; and fail closed on mixed policies or contradictory evidence.
- Positive legacy/structured and negative schema/compiler conformance fixtures,
  plus a fully synthetic public-benefits integration example.

### Changed

- The compiler now checks executable source targets, exact required identity
  mappings declared by the target object, alias-equivalent duplicate targets,
  replay contracts, nonblank governed metadata, and dangling event object
  references.
- Governed runtime decisions now require explicit-offset timestamps, canonical
  code-point ordering, nonblank identity evidence, positive ambiguity margins,
  supplied content-hash verification, attribute presence, valid policy windows,
  hash-evidenced replay, and fail-closed handling of incomplete mappings,
  unstable idempotency values, and nested source drift.
- Production dependency locks were refreshed to versions with no reported npm
  audit findings at the time of this change.
- Generated projects now preserve their Postgres volume on `db:down`; the
  explicitly named `db:reset` command removes disposable lifecycle data.

### Compatibility

- Existing well-formed descriptive `sourceMappings` remain schema-valid and
  retain their prior normalized manifest and hash shape. They compile with a review
  diagnostic but are deliberately rejected by the new governed executor until
  migrated. See `docs/SOURCE_MAPPING_MIGRATION.md`.

## [`@t2kai/mcp` 0.2.0] - 2026-08-29

### Changed

- Updated the MCP adapter to depend on `@t2kai/core@^0.3.0`, keeping ontology
  validation, compilation, reference evaluation, and lifecycle operations on
  the same released runtime as direct package consumers.

## [`@t2kai/mcp` 0.1.0] - 2026-07-18

### Added

- `@t2kai/mcp@0.1.0`, a local stdio adapter for ontology-pack validation and
  compilation, reference policy/replay/reward computation, and the optional
  Postgres lifecycle.
- Safe default and read-only lifecycle modes, with an explicit agent-mutation
  mode tied to one configured actor ID.
- Protocol tests and package smoke coverage that prove human-governance
  transitions are never exposed to an MCP agent.

## [0.2.0] - 2026-07-18

### Added

- Deterministic reward assessment with incomplete and guardrail-violation states.
- Guardrail-blocked business scalarization with an explicit worst-case replay penalty.
- Postgres reference lifecycle for policy versions, frozen Decision Contexts,
  recommendations, human authorization, episodes, receipts, observations, and rewards.
- Computed held-out replay, independent promotion, active-version deployment, and exact rollback.
- Append-only hash-chained lifecycle events and chain verification.
- Deployed-contract matching, non-weakenable candidate gates, monotonic policy
  versions, deterministic content hashes, and staged promotion deployment.
- PostgreSQL 16 integration coverage and persisted Harborlight and `create-t2k` examples.

### Changed

- The generated project now includes an optional local Postgres service and
  `npm run lifecycle` golden path while preserving the file-only `npm start` path.

## [0.1.0] - 2026-07-18

### Added

- Initial clean-room public developer preview.
- Ontology-pack specification and JSON Schema v1.0.
- `@t2kai/core` compiler, contracts, client, reference policy, and replay evaluator.
- Conformance kit and synthetic Harborlight example.
- `create-t2k` scaffolder with a complete local Decision Context and computed-replay quickstart.
- Provenance-backed npm releases for `@t2kai/core` and `create-t2k`.
