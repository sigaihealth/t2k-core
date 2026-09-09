# Experimental graph functions

The experimental `@t2kai/core/reasoning` module makes ontology-declared reasoning functions
executable. It provides deterministic graph computation and a labeled-task
evaluator. It does not promote policies, accept claims, authorize dispatch, or
change an ontology.

Run the complete synthetic example:

```bash
npm ci
npm run example:harborlight:reasoning
```

The example compares two hand-authored programs. The faulty baseline omits a
capacity filter; the repaired program passes all 15 labeled cases. It also shows
that an ontology can compile while a requested reasoning function fails because
its availability property is absent. These fixtures demonstrate behavior and
failure detection, not model-generated improvement, statistical power, or real
dispatch outcomes.

## API

The subpath was introduced in Core 0.5.0 and extended with entity distinctness
in Core 0.6.0. Install it with `npm install @t2kai/core@0.6.0`; it was not present
in 0.4.4. Its experimental status and capability limits remain explicit within
the stable package. Existing ontology-pack and lifecycle interfaces are unchanged.

```ts
import { compileOntologyPackSet } from "@t2kai/core/compiler";
import {
  compileGraphFunction,
  computeReasoningGraphHash,
  executeGraphFunction,
  computeGraphEvaluationSuiteHash,
  evaluateGraphFunction,
} from "@t2kai/core/reasoning";

const ontology = {
  manifests: [pack],
  roots: [{ ontologyId: pack.ontologyId, version: pack.ontologyVersion }],
  mode: "deployment" as const,
};
const resolution = compileOntologyPackSet(ontology);
const compiled = compileGraphFunction({
  definition: {
    ...functionDefinition,
    ontologyResolutionHash: resolution.resolutionHash,
  },
  ontology,
});

const result = executeGraphFunction({
  compiled,
  graph: authorizedSnapshot,
  arguments: { jobId: "job-1" },
  context: {
    graphKey: authorizedSnapshot.graphKey,
    asOf: authorizedSnapshot.asOf,
    expectedSnapshotHash: computeReasoningGraphHash(authorizedSnapshot),
  },
});

// A trusted harness pins this before candidate construction.
const suiteHash = computeGraphEvaluationSuiteHash(evaluationSuite);
const evaluation = evaluateGraphFunction({
  candidate: compiled,
  baseline: baselineCompiled,
  suite: evaluationSuite,
  expectedSuiteHash: suiteHash,
});
```

`compileGraphFunction` defaults to accepted-only deployment compilation. Explicit
`mode: "authoring"` supports isolated experiments with draft packs. Compiled handles
are immutable and process-local; persist the JSON artifact and ontology inputs,
then recompile after loading them. A copied or fabricated handle cannot execute.

## Program contract

`t2k.graph-function.v1` is an experimental artifact separate from the normative
ontology-pack schema. Its `functionRef` identifies an existing compiled
`reasoning_function` definition, and its `ontologyResolutionHash` pins the exact
pack set. It declares typed inputs and output, a sequence of operators, a return
step, a freshness bound, and row/work limits.

| Operator | Behavior |
| --- | --- |
| `lookup` | Select typed entities, optionally by a declared identifier argument. |
| `traverse` | Follow one declared relation in either direction, preserving entity bindings. Compose multiple steps for multiple hops. |
| `filter` | Apply typed `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, or string-list `contains` conditions. All conditions must hold. |
| `distinct` | Collapse paths by one existing entity binding's exact graph id; retain only that binding and union all path support and unresolved issues. |
| `project` | Return named literal, argument, entity-id, or property values. |
| `aggregate` | Compute count, sum, min, max, or mean over the resulting collection. |

Every step must contribute to the final result. Undeclared operations, forward
references, unused steps, invalid signatures, incompatible relationship endpoints,
and unsupported property types are rejected before execution. Inputs require exact
declared fields. Supported values are strings, finite numbers, safe integers,
booleans, and string lists. Unknown type names are errors, not inferred aliases.

This first interpreter implements a chain of relational operations, not arbitrary
programs or a general query language. Projection preserves multiplicity; aggregation
counts its incoming rows. Output rows use canonical deterministic order.
There is no implicit unit conversion or decimal arithmetic: numeric values use
JavaScript finite numbers. The example's schedule values share one synthetic
service day and minute unit.

### Entity distinctness (Core 0.6.0)

Core 0.6.0 adds `{id, op: "distinct", from, binding}`.
Core 0.5.0 does not support this operator. Hosts must check the installed
`GRAPH_SYNTHESIS_CAPABILITIES` and establish trust in the exact executable build
before accepting functions that use it.

`distinct` accepts an entity-binding collection, groups by the selected binding's
exact graph entity id, and outputs that binding alone in canonical id order.
The compiler drops every other alias because a path's job, route, or site cannot
be chosen arbitrarily as representative of the entity. Apply any constraints
that reference those aliases first. Projection and scalar inputs are rejected.
Entity resolution remains the host's responsibility; case differences and aliases
are not silently normalized.

For example, if `eligible` contains the same crew through several site paths:

```json
[
  { "id": "crews", "op": "distinct", "from": "eligible", "binding": "crew" },
  { "id": "hours", "op": "project", "from": "crews", "fields": {
    "value": { "binding": "crew", "property": "example:crew.available_hours" }
  } },
  { "id": "total", "op": "aggregate", "from": "hours", "operation": "sum", "field": "value" }
]
```

The property reference must exist in the pinned ontology. Two different crews
with equal hours both contribute; the same crew contributes once. Count can
consume the distinct bindings directly, and empty count/sum remains zero.

Every incoming path's supporting claim ids are unioned, and every unresolved
issue is retained and deduplicated by its complete canonical issue record.
A supported path cannot erase a disputed, stale, or unsupported alternate path.
The distinct trace records the supporting claim union; unresolved considered
claims remain in the execution evidence from earlier steps. Exclusions remain
separate. This is conservative entity aggregation, not existential path selection,
numeric-value deduplication, grouped aggregation, ranking, or function composition.

The existing intermediate row budget applies before any paths are collapsed.
Distinct work charges its step, each input row, every merged supporting claim and
issue (including duplicates), and a deterministic `n * ceil(log2(max(1, n)))`
allowance for each canonical sort, independent of the engine's sort algorithm. Exceeding a bound
fails execution rather than returning a truncated answer. Existing programs
without distinct retain their function and execution-result hashes; the changed
executable build requires normal host revalidation.

## Snapshot and evidence semantics

The host supplies a single authorized graph view with typed entities, claim
revisions, source locators, explicit claim status/polarity, timestamps, and an
ontology hash. Graph type and relationship-cardinality violations fail execution.
The view is a reasoning input, not a replacement for full entity-write validation.
Missing properties can therefore remain unresolved rather than preventing the
entire view from being represented.

Accepted, current positive claims with source evidence establish property values.
Unaccepted, missing, stale, or unsupported values produce `needs_review`. Conflicting
accepted values and active disputes also remain unresolved. Negative property
claims do not invent a positive value. A current supported negative relation can
exclude an edge; contradictory positive and negative edges remain unresolved.
Explicit validity intervals and observation times are evaluated at the pinned
`asOf` time, with no ambient clock.

A definitively false condition excludes a row even when another condition is
unknown. A potentially feasible row with unresolved inputs prevents a complete
result. A partial graph view always yields `needs_review`. Complete empty
collections can yield zero for count/sum; empty min/max/mean are unresolved.

`coverage: "complete"` is the adapter's assertion about its authorized view at the
snapshot time. The runtime cannot discover omitted source records. The host must
not mark a truncated or incompletely fetched view as complete.

Each result includes:

- exact function, runtime, ontology, snapshot, argument, and result hashes;
- considered claim revisions and their source evidence, including exclusions;
- supporting claim ids and per-row derivation hashes for completed values;
- unresolved issues, excluded bindings, operator traces, and intermediate hashes;
- deterministic work accounting and `authorization: "not_authorized"`.

Inspected claims stay in the audit trail even when their status or freshness
prevents them from supporting a completed value. Supporting ids and row derivations
include only the accepted evidence used to establish that value.

The host authenticates actors, authorizes the snapshot, checks source provenance,
and enforces later governance transitions. Hashes establish internal consistency,
not authenticity or factual truth. Pure operators have no network, database,
filesystem, model, or connector capability.

## Evaluation boundary

The trusted harness owns `t2k.graph-evaluation.v2`, its labels, hard constraints,
minimum case count, minimum accuracy, and minimum improvement. It independently
pins the suite hash. No caller-supplied pass verdict or measured score is accepted.
Comparisons require the same function signature and ontology version. Evaluating
schema migrations or causal outcome improvements requires a different evaluator.

Before calling a model, the host calls
`preflightGraphEvaluationSuite({ ontology, template, suite })` on its entire frozen
suite. Generation preflights its development cases automatically; evaluation
preflights every training and final case before executing any program. These
checks use the exact signature and ontology, without a fabricated witness program:
argument names/types, graph domains/ranges, output shape/types, row bounds,
forbidden-row consistency, and evidence references must be valid. Structurally
valid labels still need independent domain review; preflight does not prove the
task is expressible or its desired answer is factually correct.

V2 replaces ambiguous `requiredClaimIds` with explicit evidence roles:

```json
{
  "status": "complete",
  "value": [{ "crewId": "crew-a" }],
  "evidence": {
    "supportingClaimIds": ["crew-a.available"],
    "consideredClaimIds": ["crew-b.available"],
    "exclusions": [{ "entityIds": ["crew-b"], "claimIds": ["crew-b.available"] }],
    "rows": [{ "row": { "crewId": "crew-a" }, "claimIds": ["crew-a.available"] }]
  }
}
```

All four arrays are required and, by default, assert subsets, so an empty array
means no assertion for that role. Supporting claims must support the completed answer;
merely inspecting a claim or using it to exclude another row does not qualify.
Considered claims may include stale, disputed, or proposed evidence, including
when `status` is `needs_review` and `value` is `null`. Unresolved results cannot
assert answer support or returned-row evidence. Each row assertion must match one
complete expected output row and one derivation; evidence cannot be pooled across
rows. Each exclusion assertion must match one exclusion, using entity identifiers
instead of program-selected aliases or step names.

### Exact evidence claim sets (additive extension)

An evaluation case can explicitly require equality of the supporting claim-id
set, the considered claim-id set, or both:

```json
{
  "supportingClaimIds": ["crew-a.available"],
  "consideredClaimIds": ["crew-a.available", "crew-b.available"],
  "claimSetMatching": { "supporting": "exact", "considered": "exact" },
  "exclusions": [{ "entityIds": ["crew-b"], "claimIds": ["crew-b.available"] }],
  "rows": [{ "row": { "crewId": "crew-a" }, "claimIds": ["crew-a.available"] }]
}
```

`claimSetMatching` is optional. If supplied, it must contain at least one of
`supporting` and `considered`, and every supplied value must be `"exact"`.
Each omitted role retains required-subset behavior. Exact matching compares
unordered sets of exact claim ids; duplicate expected ids are invalid. Both
missing and extra actual claim ids fail that role's assertion. An exact empty
array requires an empty actual set, including when the result is unresolved.

The considered set is every claim in `result.evidence`, including claims that
also support the answer, establish exclusions, or carry unresolved evidence.
It is not only the claims outside the supporting set. The supporting set is
`result.supportingClaimIds`. Row and exclusion assertions retain their existing
required-subset semantics; this extension does not assert exact derivation or
exclusion counts, trace contents, or issue codes.

Preflight rejects contradictory labels before any provider call or execution.
An exact supporting set must contain all required row-support claims. An exact
considered set must contain all required supporting, row and exclusion claims.
Existing checks still require supporting claims to be current and accepted,
and unresolved results cannot claim answer support. Structurally consistent
labels still require independent review.

The matching declaration is part of normalized suite and generation-contract
hashes. Adding or removing exact matching requires a newly reviewed, pinned
contract; never reinterpret an existing evaluation receipt. Suites without the
field keep their normalized hashes, result semantics and generation requests.
This is an additive opt-in extension of `t2k.graph-evaluation.v2`; older runtimes
reject the unknown field. Hosts can detect support through exported
`GRAPH_EVALUATION_CLAIM_SET_MATCHING`, whose roles are `supporting` and
`considered`, before accepting an exact contract. A deployment still binds and
validates the new executable build; the capability advertisement is not an
activation authorization.

Development evaluation preserves exact labels through repairs and reports
separate missing/extra claim counts with bounded samples. Call
`graphGenerationInstructions(requirements, trainingCases)` to preflight the
same instruction bytes as generation. The exact-evidence instructions are
appended only when a development case opts in. Final labels remain outside
model requests, and choosing exact matching after seeing final outcomes does
not create a fresh independent final suite.

The evaluator rejects V1 suites and legacy fields, including inside a V2 suite.
Migration requires a reviewer to assign each old evidence assertion an explicit
role, then freeze a new suite hash and rerun evaluation. There is no automatic
reinterpretation of old acceptance evidence. Reports use
`t2k.graph-evaluation-result.v2`.

The evaluator executes each case, checks exact values/status and evidence roles,
detects forbidden returned rows, compares baseline and candidate accuracy, and
emits failure records tied to input and result hashes. It rejects duplicate ids
and exact normalized input copies across training and evaluation cases. This does
not detect every paraphrase, correlated example, or undeclared training exposure.

Keep final tests outside candidate search. Hash pinning only protects that boundary
when a trusted harness retains the expected hash; a party controlling both suite
and pin can choose a different experiment. A passing finite suite is computed
evidence, not a proof of correctness or permission to change production behavior.

## Automatic candidate authoring

`generateGraphFunction(contract, provider)` accepts a task, an accepted ontology,
an immutable function template (the definition without `steps` and `return`),
labeled `trainingCases`, and `maximumAttempts` from 1 to 5. The provider receives
only these development inputs, the previous program, and computed compiler or
development-test feedback. It returns a JSON object or JSON text containing only
`steps` and `return`. It cannot change the function signature, ontology, or limits.

```ts
const generation = await generateGraphFunction(contract, async (request) => {
  return modelAdapter(request); // JSON program, never executable JavaScript
}, {
  onAttempt: async (attempt) => {
    await checkpointCompletedAttempt(attempt); // trusted host persistence
  },
});
// ready_for_evaluation still requires a separate, independently owned final suite.
```

The loop repairs syntax, type, and development-case failures within the attempt
budget. It stops on provider failure or on a function that passes all development
cases. Attempt receipts retain request, response, function, and generation hashes.
Provider errors are summarized without recording upstream error bodies or secrets.
Repair feedback is capped at 12,000 characters, 12 entries, and 2,000 characters
per entry, with explicit truncation notices; complete development failure evidence
remains in the attempt report. Previous-program context is bounded to 64,000 UTF-8
bytes. Each constructed request must fit 480,000 UTF-8 bytes. A request that cannot
fit records a terminal `request_budget_failed` attempt/result with a null
`requestHash`, rather than throwing between repair attempts or invoking a provider.
The frozen task, signature, ontology, and development cases are never silently
truncated to fit. These constants are exported as `GRAPH_GENERATION_LIMITS`.

The host owns provider credentials, timeouts, access, stricter request budgets, final-case
isolation, and any durable review or activation. This portable module has no
model dependency or activation capability.

The optional third argument is `GraphGenerationOptions`. Its asynchronous
`onAttempt` callback receives a deeply frozen completed `GraphGenerationAttempt`
after every outcome: `compile_failed`, `training_failed`, `ready`, `provider_failed`,
or `request_budget_failed`. The loop waits for the callback before another provider
call or returning its terminal result. Callback failures propagate unchanged,
outside model and program error handling, so a failed durable checkpoint or host
cancellation stops the search. Invalid frozen contracts fail preflight before any
attempt exists and therefore do not produce a callback. Omitting the callback
preserves the existing two-argument behavior and result hashes.

The callback is a completed-attempt checkpoint, not a provider transaction or a
built-in resume mechanism. A durable host must separately journal request intent
and provider responses before returning them to Core. On recovery it can replay
recorded responses, verify each recomputed request hash, and idempotently compare
or persist each computed attempt. Replaying identical contract and response bytes
under the same executable build reproduces attempt and generation hashes. A crash
between provider completion and durable response storage can still leave an
unknown provider outcome; this API does not promise exactly-once remote calls.

The optional reviewed `requirements` object declares `capabilities`, `definitionRefs`,
`identityConstants`, `ordering` (`canonical` or `ranked`), and `multiplicity`
(`preserve` or `distinct`). All five fields are required when present. Supported
capabilities are exported as `GRAPH_SYNTHESIS_CAPABILITIES`. Explicit requests for
unsupported capabilities or ranking fail with `unsupported_requirement`
before any provider call. Absent required ontology definitions produce
`contract_needs_review`. `analyzeGraphGenerationCapabilities` returns those
diagnostics without trying to infer requirements from task prose. An omitted
requirements object preserves the existing contract hash.

In Core 0.6.0, entity distinctness requires both
`multiplicity: "distinct"` and `capabilities` containing `"distinct"`. Inconsistent
declarations produce `contract_needs_review` before any provider call. The strict
program schema offers distinct only for that explicit declaration. Generated
programs must contain a distinct step when requested, and must not contain one
when reviewed multiplicity is `preserve`; mismatches produce `multiplicity_mismatch`
repair diagnostics even when development answers happen to pass. Presence alone
does not prove the binding or step placement is correct; reviewed cases must
establish that. Contracts that omit requirements preserve path multiplicity by
default; a custom provider cannot bypass the explicit distinct opt-in by returning
the operator directly. Existing programs that omit distinct retain their behavior.

`graphGenerationInstructions(requirements?)` returns the exact instructions used
by Core generation so hosts can preflight identical request bytes. Only distinct
contracts receive `GRAPH_GENERATION_DISTINCT_INSTRUCTIONS` appended to the unchanged
`GRAPH_GENERATION_INSTRUCTIONS`. Existing contracts keep the same generation
instructions and schema, preserving their request and replay hashes.

Provider adapters can use `graphGenerationProgramSchema(request)` to constrain
the actual `{steps, return}` program. It derives allowed references, argument names,
and projection field types from the pinned ontology and signature. Scalar numeric
aggregates use an intermediate projected field named `value`; this is a provider
authoring convention, not a new interpreter operation. The schema uses strict
objects and nested `anyOf`, as supported by
[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).
The compiler still validates step ordering, binding compatibility and the complete
authoritative ontology. Schema conformity does not establish task correctness.

`graphGenerationOntologyContext(request)` supplies a conservative pack dependency
closure rooted in the selected function, development graph references and explicit
requirements. Policy/context packs remain included. It preserves metadata,
constraints and context values and maps each included definition/content hash to
the full pinned resolution. The full ontology remains in the portable Core request
for compatibility; a provider adapter can transmit this context instead and must
check its actual serialized envelope and schema limits before dispatch.

Repair requests include bounded structured diagnostics with total/omitted counts.
They distinguish status/scalar/row differences (including duplicate multiplicity),
forbidden rows, supporting/considered/exclusion/per-row evidence, data issues and
compile failures with step locations. Complete development failure receipts remain
in attempt records. `evaluateGraphFunction({includeDiagnostics:true, ...})` opts
into the same development details; default independent evaluation hashes remain
unchanged. Scalar and string-list literals containing undeclared development entity
identities are flagged even when development answers pass. Approved domain constants
must be declared in `requirements.identityConstants`; identity-change evaluation
remains necessary because this diagnostic is not a general proof against overfit.

## Bounds and next steps

Programs have at most 32 steps, 16 conditions per filter, 32 input/output fields,
2,000 intermediate rows, and 100,000 work units. Snapshots allow at most 2,000
entities, 12,000 claims, and 32 locators per claim. Shared input limits also cap
depth at 32, nodes at 150,000, a string at 32,768 characters, and total text at
4,000,000 characters; a request can hit these limits before a collection cap.
Suites allow at most 100 training and 100 evaluation cases, within those shared
input bounds. Limits fail explicitly and never silently truncate a result.

Candidate authoring is implemented. Evaluation of schema and mapping changes
remains future work. Durable review and activation belong to a hosting application;
this runtime continues to return `authorization: "not_authorized"`.


## Package identity and preview migration

Published tarballs carry `package.json.t2kReasoningBuild`, with format
`t2k.reasoning-build.v1`, `buildHash`, and per-file `files` digests. Hosts must
verify the declared manifest against installed bytes before using it to bind an
activation. npm provenance separately identifies the public source commit and
publishing workflow; the build manifest alone is not authentication.

When replacing a private preview package, retain the original program, ontology,
snapshot and receipt artifacts. Recompile against the published build, migrate
any V1 suite using reviewed evidence roles, rerun frozen V2 final evaluation, and
record a new host acceptance bound to the installed package identity. Do not
rewrite historic receipts or treat the previous build's acceptance as approval
of different executable bytes. Follow the host's explicit revalidation and
activation workflow before allowing new executions.
