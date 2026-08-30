# T2K Integration Hub Demo

A polished, runnable tutorial app that executes the real `@t2kai/core`
workspace package against a fully synthetic public-benefits scenario.

Three agencies describe the same participant through three different schemas.
The app maps their immutable envelopes into one canonical contract, retains
receipt-bound provenance, preserves conflicting evidence, proves reconciliation
is deterministic, proposes a reversible entity link, evaluates two
purpose-limited access requests, and routes unresolved judgment to a human.

Nothing in the demo authenticates a real agency or person, adjudicates a
benefit, merges an entity, enforces IAM, or activates a canonical record.

## Run it

From the repository root, with Node.js 20.10 or newer:

```bash
npm install
npm run build --workspace @t2kai/core
npm start --prefix examples/integration-hub-demo
```

Open <http://127.0.0.1:4173>. Set `T2K_DEMO_PORT` if that port is in use.

The demo declares `@t2kai/core` as a direct file dependency on the workspace
package. It adds no UI framework or server dependency; the server uses only
Node's standard library.

## What to try

1. **Open each agency source.** Compare the State Benefits, County Human
   Services, and State Labor payloads. Each uses different source paths but
   maps to the same five canonical properties.
2. **Inspect the mapping receipts.** Expand the canonical record and receipt to
   follow any value back to its source payload hash, mapping hash, authority
   reference, and observation time.
3. **Review the conflicts.** The display name stays unresolved, both mailing
   addresses remain preserved, and explicit authority policy proposes
   `eligible` and `employed` without declaring either accepted truth.
4. **Check determinism.** The app reconciles source results in file, reverse,
   and rotated order. All three proposal hashes must match.
5. **Inspect entity resolution.** Two canonical entities score equally. Core
   returns a deterministic, reversible `needs_review` link proposal instead of
   silently merging them.
6. **Compare access receipts.** Assigned case coordination receives an
   `explicit_allow`; an unlisted model-training purpose receives
   `default_deny`. These are deterministic policy receipts, not access tokens.
7. **Record a human disposition.** Select the unresolved name and an entity-link
   outcome, enter a reviewer and rationale, and attest the demo review. The
   audit item appears in an in-memory session log. Refreshing the model confirms
   that the canonical proposal and entity-link proposal are unchanged.

## Architecture

```text
State Benefits ─┐
County Services ├─ executeSourceMapping ─ receipts + field provenance ─┐
State Labor ────┘                                                       │
                                                                        ├─ reconcileCanonicalRecords
versioned authority policy ─────────────────────────────────────────────┘          │
                                                                                   ├─ non-mutating proposal
entity candidates ─ resolveEntityCandidates ─ reversible proposal ────────────────┤
purpose + role + policy ─ evaluatePurposeLimitedAccess ─ allow/deny receipts       │
                                                                                   v
AI-assist: summarize, trace, explain                         Human: select + rationalize
          advisory only                                      session disposition only
```

The model is rebuilt on every server start from the JSON source records and
policies in this directory. The UI contains no precomputed core result.

## Core APIs exercised

- `validateOntologyPackManifest` validates the canonical semantic contract.
- `compileOntologyPackSet` produces a stable ontology resolution hash.
- `executeSourceMapping` normalizes each source and emits an integrity-bound
  mapping receipt plus field provenance.
- `reconcileCanonicalRecords` checks receipt integrity, preserves alternatives,
  and applies explicit authority priorities to a non-mutating proposal.
- `resolveEntityCandidates` scores candidate links and routes ambiguity to
  human review with `reversible: true`.
- `evaluatePurposeLimitedAccess` uses explicit-deny precedence and mandatory
  default deny to produce deterministic disclosure receipts.

## AI and human authority do not collapse

| AI-assist may | Human or trusted service must |
| --- | --- |
| Summarize conflicts and trace receipts | Authenticate the reviewer |
| Explain why an authority rule proposed a value | Accept, reject, or revise the proposal |
| Score reversible entity candidates | Approve a link or merge |
| Explain an access policy receipt | Enforce access through the owning IAM system |
| Prepare a review packet | Activate an accepted canonical revision |

The browser sends `actorType: "human"` only after an explicit attestation, and
the server rejects an `ai_agent` disposition. That demonstrates a workflow
boundary, not a security boundary: a browser assertion does not authenticate a
human. Production deployments need independent identity, authorization,
durable append-only storage, separation of duties, and a separate activation
service.

## Test it

Run the focused model and HTTP tests:

```bash
npm run build --workspace @t2kai/core
npm test --prefix examples/integration-hub-demo
```

The tests cover:

- manifest validation and three mapped source receipts;
- shared normalized identity and unmodified raw evidence;
- `require_review`, `preserve_all`, and `prefer_authority` behavior;
- proposal hash invariance across three input orders;
- ambiguous, reversible entity-link routing;
- explicit allow and fail-closed/default-deny access receipts;
- rejection of AI-authored, stale, incomplete, and invalid review inputs;
- session-only human disposition with no activation or link application; and
- the static server's security headers and file allowlist.

To prove the demo works as a package consumer rather than relying on TypeScript
source imports, run the isolated smoke:

```bash
npm run smoke --prefix examples/integration-hub-demo
```

The smoke packs `@t2kai/core`, installs that tarball into a fresh temporary
consumer, copies only the demo model and its data, and executes the complete
scenario there. It uses the `dist` output produced by the preceding core build,
and the temporary directory is removed afterward.

## Production boundaries

This tutorial intentionally leaves the following outside the local process:

- authenticated source transport and secret management;
- real PII and jurisdiction-specific data handling;
- human identity and role verification;
- durable disposition, revision, and activation history;
- entity merge execution and rollback storage;
- IAM enforcement and disclosure delivery; and
- benefit eligibility or case adjudication.

Those are separate governed gates. A mapped receipt, proposal, browser
attestation, and access-policy receipt must never be presented as proof that a
real-world action occurred.
