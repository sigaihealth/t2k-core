# Synthetic public-benefits profile

This executable example demonstrates a small, non-production integration hub for independently governed public-benefits records. It contains no claimant data and makes no claim of compatibility with an agency system.

The example compiles one ontology pack, maps synthetic mainframe, batch, authenticated-API, and document-extraction records, emits field-level provenance and reconciliation receipts, detects replays and late arrivals, proposes reversible entity links, and evaluates purpose-limited access with explicit-deny precedence and default deny.

The control boundary is deliberate:

- source records remain immutable and retain their own authentication and authority state;
- mapping rules are declarative, versioned, hash-addressed, and never executed as code;
- schema drift, late arrival, missing fields, and content-hash failures become explicit issues;
- ambiguous identity links and document-derived assertions require human review;
- access receipts are evidence of the reference decision, not authentication tokens or substitutes for an owning IAM platform.

Run it from the repository root:

```sh
npm run example:public-benefits-profile
```
