# Public Roadmap

This roadmap distinguishes implemented behavior from intended architecture.
Dates are deliberately omitted until maintainers can defend them.

## Shipped in 0.1

- Exact JSON Schema validation for current T2K ontology packs
- Deterministic pack compilation and dependency resolution
- Typed contracts and hosted-control-plane client
- Reference rule policy execution
- Held-out inverse-propensity replay with coverage and guardrail gates
- Per-policy reward aggregation
- Conformance fixtures and synthetic Harborlight replay
- Provenance-backed `@t2kai/core@0.1.0` and `create-t2k@0.1.0` npm releases
- Tested `create-t2k` local project scaffold and public `npx` quickstart

## Shipped in 0.2

- Deterministic reward-vector assessment with guardrail-blocked scalarization
- Local Postgres reference schema and transactional lifecycle API
- Frozen Decision Context policy bindings and computed recommendations
- Human authorization and segregation of duties across review transitions
- Reconciled execution receipts with mandatory rollback contracts
- Provenance-bearing observations, computed rewards, and closed episodes
- Disjoint held-out replay, candidate promotion, exact rollback, and active policy lookup
- Non-weakenable evaluation gates and atomic or staged promotion deployment
- Hash-chained, append-only lifecycle event ledger with verification
- Persisted Harborlight and `create-t2k` golden paths tested on PostgreSQL 16

## Next

- Packaged MCP adapter over the same contracts
- More negative conformance fixtures and cross-language test vectors
- Signed pack artifacts and registry interoperability profile

## Hosted, Not Planned for This Repository

- Multi-tenant Studio UI and managed registry operations
- Cross-organization graph exchange and attestation network
- Private industry packs and customer knowledge
- Managed connectors, enterprise identity, compliance exports, and SLAs
- Fleet-level shadow, canary, monitoring, and cohort rollout

Roadmap items are proposals, not commitments. A feature is shipped only when it
is present on `main`, documented, and covered by executable tests.
