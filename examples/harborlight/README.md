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

This public preview demonstrates the portable semantic and evaluation layer.
Episode persistence, authorization, execution receipts, promotion, and rollback
remain part of the hosted lifecycle until the local Postgres reference runtime
lands on the public roadmap.
