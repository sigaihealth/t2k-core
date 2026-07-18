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

## Next

- Local Postgres reference lifecycle for episodes, evaluations, promotion, and rollback
- Packaged MCP adapter over the same contracts
- `npx create-t2k` ten-minute local project scaffold
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
