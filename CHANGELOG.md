# Changelog

All notable changes to the public T2K standard and packages will be documented
here. The project follows Semantic Versioning for packages and the compatibility
rules in the versioned specification.

## [0.7.0] - 2026-09-12

### Added

- Opt-in exact supporting and considered evidence claim sets in graph evaluation
  cases, with independent role selection, contradictory-label preflight and
  bounded missing/extra development diagnostics. Hosts can detect the supported
  roles through `GRAPH_EVALUATION_CLAIM_SET_MATCHING`.
- Conditional exact-evidence generation instructions, exposed through
  `graphGenerationInstructions(requirements, trainingCases)`, retain the reviewed
  matching modes and evidence labels through candidate repair.

### Compatibility

- This is an additive opt-in extension of `t2k.graph-evaluation.v2`. Existing
  omitted matching modes keep required-subset behavior, normalized suite and
  evaluation hashes, and generation request bytes. Older evaluators reject
  the new field. Adding exact matching requires newly reviewed, pinned labels
  and the host's normal executable-build validation and runtime revalidation.
  Row and exclusion assertions, result and artifact versions, and interpreter
  operators remain unchanged.
- MCP and scaffold source dependency pins track Core 0.7.0 for the exact-package
  smoke gates. Their published 0.4.0/0.5.0 releases are unchanged; this release
  publishes Core only.

## [0.6.0] - 2026-09-09

### Added

- Experimental entity `distinct` operator for multi-path graph queries. It keeps
  only the selected entity binding, merges every path's supporting evidence,
  preserves unresolved issues, and charges bounded deterministic work. Different
  entities with equal property values remain distinct.
- Explicit distinct capability and multiplicity review, typed generation schema,
  repair diagnostics, and a shared instruction helper for exact host preflight.

### Compatibility

- Existing programs retain their multiplicity, function hashes and result
  semantics. The executable build identity changes, so adopting this extension
  requires the host's normal validation and runtime revalidation. This operator
  is introduced in Core 0.6.0; Core 0.5.0 remains unchanged.
- MCP and scaffold source dependency pins track Core 0.6.0 to retain the
  repository's exact-package smoke gates. Their published 0.4.0/0.5.0 releases
  are unchanged; this release publishes Core only.

## [0.5.0] - 2026-09-06

### Changed

- Promote the 0.5.0-rc.1 Core and create-t2k candidate scope to stable package
  versions under npm's `latest` channel. Both scaffold profiles pin Core 0.5.0
  exactly, and current installation examples use the coordinated stable versions.
- Retain the executable build manifest, bounded graph interpreter, V2 labeled
  evaluator and provider-neutral authoring API introduced in the candidate.
  The graph-reasoning subpath remains explicitly experimental; stable package
  publication does not expand its operations or authorize downstream actions.

### Compatibility

- No runtime, schema, database or artifact-format changes from 0.5.0-rc.1.
  Hosts must still revalidate their execution bindings when adopting the new
  package version; candidate or private-preview acceptance does not silently
  authorize a stable installation.
- Keep the candidate's V1 evaluation-suite migration requirements: freeze
  reviewed V2 evidence-role assertions and rerun evaluation.

## [`@t2kai/mcp` 0.4.0] - 2026-09-06

### Security

- Refresh the workspace lockfile's MCP dependency chain from `qs@6.15.3` to
  `qs@6.16.0` within the existing dependency ranges, resolving the moderate
  GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g audit findings. Consumers with
  existing lockfiles should refresh their transitive dependency resolution.

### Changed

- Pin the coordinated stable `@t2kai/core@0.5.0` release exactly. Existing MCP
  tools, safe defaults and human-governance boundaries are unchanged from
  0.4.0-rc.1; graph-function activation is not exposed through MCP.

## [0.5.0-rc.1] - 2026-09-06

### Added

- Experimental `@t2kai/core/reasoning` subpath with ontology-bound typed graph
  programs, bounded read-only execution, claim-revision evidence, explicit
  unresolved results, and deterministic execution receipts.
- A pinned, runtime-computed labeled-task evaluator with disjoint case checks,
  baseline comparison, hard-constraint failures, and reproducible failure records.
- Provider-neutral automatic function authoring with bounded compile/test repair,
  immutable signatures, development-only prompts, and per-attempt hashes.
- Provider-adapter helpers for typed program schemas and ontology dependency
  context, with included definitions mapped to the full pinned resolution.
- Reviewed capability requirements that reject explicit unsupported operations
  before provider dispatch, plus diagnostics for undeclared development identities.
- Bounded structured repair diagnostics for answer, evidence, data, and compiler
  failures, retaining complete development failure receipts in attempt records.
- Shared signature/ontology preflight for development and final cases before model
  calls or evaluation, explicit V2 supporting/considered/exclusion/per-row evidence
  assertions, and bounded repair feedback with recorded request-budget failures.
- An optional awaited completed-attempt checkpoint for generation hosts, with
  immutable receipts and unclassified propagation of host checkpoint failures.
- A verified executable build manifest in packed Core artifacts, suitable for
  host acceptance bindings and independent installed-byte verification.
- Release workflows select explicit `next` for prereleases and `latest` for
  stable versions only after matching the exact package/tag identity, while
  preserving signed-tag, protected-main and npm provenance gates.
- A Harborlight composition example covering 15 synthetic cases, including
  missing, stale, unaccepted, and contradictory evidence and a deliberately faulty
  capacity filter. Passing this evaluator does not authorize deployment or action.

### Compatibility

- Core and create-t2k advance to 0.5.0-rc.1 under npm's `next` channel. Both
  scaffold profiles pin this exact Core version. The normative ontology-pack
  schema, existing policy replay and promotion rules, database layout, and MCP
  tools are unchanged. Experimental function artifacts remain separate from
  descriptive `reasoningFunctions` in ontology packs.
- Experimental V1 evaluation suites are rejected rather than silently upgrading
  ambiguous `requiredClaimIds`. Review the intended evidence roles, freeze a V2
  suite and hash, and rerun evaluation before relying on a new acceptance report.

## [`@t2kai/mcp` 0.4.0-rc.1] - 2026-09-06

### Changed

- Depends on the coordinated 0.5.0 Core release candidate. The packed smoke test
  verifies Core resolution from the installed MCP entry, including version and
  tarball origin, so a nested registry fallback cannot pass unnoticed.
- Existing MCP tools, safe defaults and human-governance boundaries are unchanged;
  the new Core graph-reasoning API is not exposed as an MCP activation tool.

## [0.4.4] - 2026-08-30

### Security

- Ontology compilation now has an accepted-only `deployment` mode, while
  replay rejects blank, duplicate, and conflicting episode identifiers.
- Reward evaluation rejects conflicting latest-timestamp evidence and
  mixed-type numeric aggregations. New callers can opt into method-specific
  evidence enforcement with `evidenceMode: "strict"`.
- Executable mappings can bind source system, locator, accepted authorities,
  and a caller-pinned mapping hash. MCP calls now have documented depth, node,
  collection, property-key, per-string, aggregate-text, and batch limits.
- Authority-reference sets reject duplicates after trimming in validation,
  compilation, MCP normalization, and direct runtime execution. Invalid
  JavaScript compiler modes now fail closed as deployment.
- MCP publication now uses the same annotated, protected-main,
  GitHub-signature-bound release gate as Core.

### Changed

- Thirteen language-neutral JSON vectors cover deployment resolution, replay
  identity, reward evidence, and source-binding behavior.
- Core exports `canonicalSourceMappingHash` so registries and callers can pin
  the exact normalized mapping revision used at execution.
- The three-source integration demo advances its ontology to 1.0.1 and its
  three mapping revisions to account for the new source selectors.
- `create-t2k@0.4.4` preserves both existing profiles while updating their
  exact generated-project Core pin to `@t2kai/core@0.4.4`.

### Compatibility

- `authoring` remains the compiler default and preserves the prior authoring
  resolution hash. `legacy` remains the reward-evidence default; strict
  method-specific evidence is opt-in for migration safety.
- Source selectors are optional, so existing mappings retain their previous
  routing behavior and hash shape until selectors are declared.
- MCP trims only `acceptedAuthorityRefs`. Roles, purposes, relationships,
  categories, jurisdictions, and other Core selector arrays retain exact
  caller strings so transport cannot broaden an access decision.
- There is no database migration. The 0.4.3 PostgreSQL compatibility and
  legacy-reward quarantine remain unchanged.

## [`@t2kai/mcp` 0.3.1] - 2026-08-30

### Security

- Exposes accepted-only compilation, strict reward evidence, source/hash
  binding, and bounded public inputs from the patched Core runtime.
- Requires `@t2kai/core@^0.4.4` so older Core versions cannot silently omit
  the new trust controls.

## [0.4.3] - 2026-08-30

### Security

- Purpose-access, source-mapping, canonical-reconciliation, and entity-resolution
  APIs now evaluate and hash one recursively snapshotted own-data input. Inherited
  getters cannot affect a decision, while own accessors, cycles, sparse arrays,
  and non-JSON values fail closed without being invoked.
- Reference reward timestamps now require an explicit UTC offset and a valid
  calendar date, eliminating host-timezone-dependent observation ordering.
- The local integration-hub demo rejects Host userinfo, non-origin URL
  components, JSON-prefix media types, and unsupported content-type parameters.

### Fixed

- PostgreSQL schema v2 now has the same nullable `observation_set_hash` layout
  for fresh and upgraded databases. Legacy unbound assessments are never used
  for closure, training, holdout replay, candidate promotion, staged deployment,
  or snapshot aggregates, and no unsafe historical hash is invented.
- Generated projects pin `@t2kai/core@0.4.3` exactly, and the `create-t2k`
  package now carries the complete Apache-2.0 license text.
- npm publication workflows pin third-party GitHub Actions to immutable commit
  SHAs.

### Compatibility

- The database schema integer remains 2 so a temporary 0.4.1 application
  rollback can still migrate and insert an unbound assessment. Treat 0.4.1 as
  an emergency write-limited rollback: it does not enforce the new quarantine,
  so do not close, train, evaluate, promote, deploy, or consume reward aggregates
  until 0.4.3 is restored. Then recompute an open episode's reward before
  closure; a closed unbound episode remains quarantined and must be replayed as
  a new episode if needed. Do not mix or roll back to 0.4.2 during this
  transition: although its migration leaves an existing nullable column in
  place, that runtime does not enforce the quarantine and may consume unbound
  evidence. Use only the write-limited 0.4.1 emergency path or restore 0.4.3.

## [0.4.2] - 2026-08-30

### Fixed

- Purpose-limited access rejects unknown rule keys, and reference policy paths
  read only own object and array properties, so misspelled controls or inherited
  prototype values cannot authorize a request or satisfy a rule.
- Executable source mappings now apply schema-aligned validation to identity,
  mapping metadata, and field definitions, including trimmed nonblank values,
  safe namespaced targets, and unique normalization steps. Duplicate
  entity-resolution rule identifiers are invalid instead of contributing the
  same evidence more than once.
- Reward assessments bind the exact observation set and episode closure rejects
  an assessment made stale by a later observation.
- Integration-hub review records bind both current decision hashes and validate
  every supplied candidate selection, including return-for-correction paths.

### Changed

- The three-source demo verifies all six input permutations, exposes complete
  reconciliation, entity-resolution, policy, access, and recorded-review
  evidence, improves keyboard and screen-reader behavior, and hardens its local
  HTTP boundary with loopback Host/Origin checks and route-specific methods.
- Postgres lifecycle snapshots now read table rows, reward aggregates, and the
  verified event chain through one read-only repeatable-read transaction, so a
  snapshot cannot combine different committed database states.
- Core and `create-t2k` publication now fail closed unless a GitHub-verified
  annotated tag is bound to the checked-out commit and that commit is on the
  fetched `main` history.

### Compatibility

- `@t2kai/core@0.4.2` and `create-t2k@0.4.2` remain patch-compatible for
  well-formed 0.4 callers and generated projects. `@t2kai/mcp@0.3.0` remains
  unchanged and continues to resolve the compatible core range.

## [0.4.1] - 2026-08-30

### Added

- A runnable three-source integration-hub demo app that exercises the published
  ontology validation, compilation, governed mapping, canonical reconciliation,
  entity-resolution, and purpose-access APIs. Its browser review is explicitly
  in-memory and non-activating, with focused HTTP/model tests and an isolated
  packed-core consumer smoke.

### Fixed

- Purpose-limited access now fails closed with `invalid_request` for blank,
  incomplete, or malformed required request fields and returns deterministic
  deny receipts instead of throwing on malformed request or policy shapes.
- Entity resolution now prohibits automatic matching when caller-supplied
  thresholds, candidates, identifiers, or rule collections are invalid. It
  reports invalid threshold/input counts and binds the supplied invalid evidence
  into deterministic decision hashes instead of silently substituting permissive
  defaults.
- Source mapping now rejects unrecognized authentication states while
  normalizing their receipt/provenance assertion to `unknown`, rejects invalid
  calendar dates such as February 30 for `iso_date`, and fails closed
  deterministically on malformed nested execution input.
- The Postgres lifecycle now requires explicit-offset, calendar-valid execution
  and observation timestamps. Exact execution-receipt retries return the
  existing receipt, conflicting receipt or idempotency-key reuse fails closed,
  and exact observation retries collapse to one record and one ledger event,
  including retries after episode closure.

### Changed

- The generated integration-hub packet now binds the exact loaded core version,
  complete authority policy, every complete canonical-record/receipt pair, both
  complete forward and reverse reconciliation proposals, and every issue before
  computing the packet hash. Its order check now states its exact comparison
  scope rather than implying exhaustive permutation coverage.
- Generated JSON parse errors now identify the source filename. Generated
  Postgres binds only to `127.0.0.1:55432`, and the included `t2k` credentials
  are labeled disposable and local-only.
- The tutorial now requires immutable follow-on source envelopes and explicit
  mapping, ontology, and authority-policy version bumps; distinguishes raw
  `sourceValueHash` from normalized `valueHash`; and separates independent MCP
  computations from trusted application persistence, authenticated human review,
  activation, and IAM enforcement.

### Compatibility

- `@t2kai/core@0.4.1` and `create-t2k@0.4.1` are patch releases for
  well-formed 0.4 callers and generated projects. `@t2kai/mcp@0.3.0` remains
  the MCP adapter version and resolves the patched compatible core runtime.

## [0.4.0] - 2026-08-30

### Added

- A separate `create-t2k --profile integration-hub` project that maps two
  independently governed synthetic sources onto one canonical identity,
  preserves conflicting evidence, applies an explicit authority policy, proves
  input-order determinism, and emits a pending human-review packet.
- Immutable Postgres reconciliation proposals and explicit human dispositions
  with required-role, proposer/reviewer separation, content-hash, identity,
  and current-base checks.
- Append-only accepted canonical revisions and activation history, complete
  repeatable-read lineage, exact ancestor rollback, and governed reactivation
  of an existing revision without rewriting canonical content.
- Immutable snapshots and digests for linked lifecycle execution receipts,
  composite lineage constraints, serialized idempotent transitions, and
  fail-closed migration and direct-SQL integrity checks.
- A runnable integration-hub tutorial covering ontology-layer architecture,
  human-plus-AI roles, safe agent computation, persistence, and production
  boundaries.

### Compatibility

- Existing `create-t2k <directory>` behavior remains the default
  `decision-loop` profile. The integration-hub profile is opt-in.
- Existing well-formed source-mapping and lifecycle callers remain compatible;
  the reconciliation persistence API and schema are additive.

## [`@t2kai/mcp` 0.3.0] - 2026-08-30

### Added

- Read-only tools for governed source mapping, canonical-reconciliation
  proposals, reversible entity-link proposals, and purpose-limited access
  evaluation in the database-free safe default.
- Strict nested tool schemas and protocol/package tests that reject unknown
  persistence, credential, merge, and approval controls; verify deterministic
  and tamper-evident outputs; and preserve the human-governance boundary.

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
