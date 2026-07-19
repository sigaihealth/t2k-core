# Harborlight Field Service

Harborlight is a fully synthetic field-service business used to demonstrate the
portable T2K contract. It contains no customer data and no vocabulary extracted
from a private business.

The example asks one repeated question: when dispatch pressure is high, should
the operator hold, authorize overtime, or rebalance a route?

```bash
npm ci
npm run example:harborlight
```

The script:

1. validates the ontology pack against the exact published schema;
2. compiles the pack and prints its deterministic resolution hash;
3. keeps four synthetic training IDs disjoint from 20 held-out episodes;
4. gives both baseline and challenger logged-action support;
5. computes replay metrics and paired confidence bounds in `@t2kai/core`;
6. fails if the challenger lacks coverage, a positive lower bound, or a passing verdict.

## Run the persisted lifecycle

Docker Compose provides a disposable PostgreSQL 16 database:

```bash
docker compose -f examples/harborlight/compose.yml up -d --wait
npm run example:harborlight:lifecycle
docker compose -f examples/harborlight/compose.yml down -v
```

The persisted example migrates the reference schema and closes 24 synthetic
episodes. Every action has independent human authorization, a reconciled
execution receipt with a rollback contract, a provenance-bearing observation,
and a computed reward. It then evaluates a candidate on 20 disjoint held-out
episodes, promotes it, and restores the exact prior version through rollback.

Set `T2K_DATABASE_URL` to use an existing database instead of Compose. The
runtime writes only to the `t2k_reference` schema and does not delete prior runs.
