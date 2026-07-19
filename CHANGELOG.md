# Changelog

All notable changes to the public T2K standard and packages will be documented
here. The project follows Semantic Versioning for packages and the compatibility
rules in the versioned specification.

## [Unreleased]

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
