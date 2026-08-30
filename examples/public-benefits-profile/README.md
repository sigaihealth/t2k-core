# Synthetic public-benefits profile

This executable example demonstrates a small, non-production integration hub for independently governed public-benefits records. It contains no claimant data and makes no claim of compatibility with an agency system.

The example compiles one ontology pack, maps synthetic mainframe, secondary-registry, batch, authenticated-API, and document-extraction records, emits field-level provenance and mapping receipts, reconciles competing canonical values under an explicit authority policy, detects replays and late arrivals, proposes reversible entity links, and evaluates purpose-limited access with explicit-deny precedence and default deny.

The control boundary is deliberate:

- source records remain immutable and retain their own authentication and authority state;
- mapping rules are declarative, versioned, hash-addressed, and never executed as code;
- reconciliation cross-checks receipt self-consistency, canonical-output and provenance bindings, preserves every candidate and its provenance, and never treats arrival order as authority;
- schema drift, late arrival, missing fields, and content-hash failures become explicit issues;
- ambiguous identity links and document-derived assertions require human review;
- access receipts are evidence of the reference decision, not authentication tokens or substitutes for an owning IAM platform.

The reconciliation proposal demonstrates two distinct conflict policies: it
preserves both normalized-name candidates without inventing a winner, while an
explicit, versioned authority order selects the enumeration value. The output
remains non-mutating, preserves both alternatives, and does not promote the
proposal to accepted truth. Its unkeyed hashes establish deterministic
self-consistency, not source authenticity; production callers must authenticate
or independently attest the receipts and authority policy.

Run it from the repository root:

```sh
npm run example:public-benefits-profile
```
