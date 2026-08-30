# T2K Ontology Pack Specification 1.0

Status: Developer Preview

Schema: [`../../schemas/t2k-ontology-pack.v1.schema.json`](../../schemas/t2k-ontology-pack.v1.schema.json)

Canonical schema ID: `https://t2k.ai/schemas/t2k-ontology-pack.v1.schema.json`

## 1. Purpose

This specification defines a portable ontology-pack manifest for governed AI
decision systems. A pack gives facts and decisions shared meaning without
binding an implementation to one database, model provider, agent framework, or
user interface.

The model separates five concerns:

```text
Knowledge = Ontology + Facts + Provenance + Time
Decision = Reasoning(Knowledge, Objective, Policies)
Execution = AuthorizedAction(Decision, Capability, Rollback)
Learning = GovernedPromotion(ClosedEpisodes, HeldOutEvaluation)
```

An ontology pack defines stable semantic structure. It does not contain a
tenant's current fact graph, credentials, raw documents, or authorization to
execute an action.

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY, and OPTIONAL are to be interpreted as requirements language.

## 2. Conformance

There are three conformance roles:

1. A **manifest** conforms when it validates against the exact v1 JSON Schema.
2. A **compiler** conforms when it accepts every valid conformance fixture,
   rejects every invalid fixture, and produces deterministic semantic hashes
   for equivalent input.
3. A **consumer** conforms when it preserves declared identifiers, versions,
   dependencies, constraints, and decision-learning fields without silently
   coercing unknown or invalid values.

Schema validation occurs before normalization. A conforming implementation
MUST NOT drop unknown fields, repair invalid enums, or replace malformed values
with defaults while claiming v1 conformance.

The `conformance/` directory is executable. Its fixtures supplement, but do not
replace, the JSON Schema.

## 3. Manifest Envelope

A v1 manifest is a JSON object with `additionalProperties: false`. The required
top-level fields are:

| Field | Meaning |
| --- | --- |
| `manifestType` | MUST equal `t2k.ontology-pack`. |
| `manifestVersion` | Version of this manifest format; v1 uses `1.0`. |
| `ontologyVersion` | Semantic version of the ontology pack content. |
| `ontologyId` | Stable globally namespaced pack identifier. |
| `label` | Human-readable pack name. |
| `packKind` | `core`, `context`, `vertical`, `workflow`, or `project`. |
| `status` | `draft`, `review`, `accepted`, or `deprecated`. |
| `scope` | Domain coverage and explicit boundaries. |
| `objectTypes` | At least one typed object definition. |

The optional `$schema` field SHOULD contain the canonical v1 schema URL.

`ontologyId` and local definition IDs form semantic references. Producers
SHOULD use lowercase, stable, organization-controlled namespaces. Human labels
MAY change without changing identity; IDs MUST NOT be recycled for unrelated
meaning.

## 4. Pack Kinds and Layering

Pack kinds indicate intended reuse, not access control:

- `core`: cross-domain primitives with broad stability;
- `context`: jurisdiction, size, lifecycle, or operating-context semantics;
- `vertical`: industry or business-model semantics;
- `workflow`: reusable process and decision semantics;
- `project`: provisional local extensions for one implementation.

Dependencies are declared in `extends`. Each dependency names an `ontologyId`,
a semantic version range, and whether it is required. A compiler MUST resolve a
pack only from the catalog supplied by the caller; it MUST NOT fetch an
undeclared or implicit dependency during deterministic compilation.

A stable version range MUST NOT select a prerelease version unless the range
explicitly admits that prerelease. Missing required dependencies and dependency
cycles are compilation errors.

## 5. Scope and Context

`scope` states what a pack covers and excludes. Context lists such as
jurisdiction, industry, business stage, and organization size make applicability
explicit. Empty lists mean the pack does not constrain that dimension; they do
not mean all values are known to be equivalent.

`contextDimensions` declare values required to compile or apply semantics. A
dimension may require sourced context. When `sourceRequired` is true, a compiler
MUST NOT treat an unsourced caller value as satisfying the requirement.

Unknown context is a first-class state. Consumers SHOULD distinguish known,
unknown, not-applicable, and withheld values rather than converting all absence
to `null`.

## 6. Object Types and Properties

`objectTypes` define typed entities or records. Each object type has:

- a local `id` and human `label`;
- a semantic `family`;
- an optional canonical `nodeKind`;
- identity properties;
- a purpose statement;
- typed properties;
- optional specialization, replacement, and compatibility declarations.

Property definitions declare value type, requiredness, description, authority
domain, and temporal behavior. A subtype MUST NOT weaken an inherited required
property or change its value type incompatibly. A replacement MUST include
migration or compatibility guidance.

Compilers MUST reject duplicate definition references, dangling relationships,
specialization cycles, and incompatible property overrides.

## 7. Relationships and Links

`structuralRelationships` connect object types through named properties and
cardinality. Endpoints MUST resolve within the compiled pack set.

`canonicalLinks` map pack semantics to external identifiers or standards. A
canonical link is an interoperability assertion, not permission to fetch or
trust remote content.

## 8. Sources, Authority, and Events

`sourceMappings` describe how external records can propose structured facts.
They do not make extracted values accepted truth. Implementations SHOULD retain
source locators, transformation identity, review state, and authority domain.

A source mapping MAY declare its own version, a source schema version,
deterministic field mappings, target identity properties, event and observation
time paths, an idempotency path, drift and late-arrival policies, a human
checkpoint, and whether the mapping is replayable. A replayable mapping MUST
declare a stable idempotency path. An implementation MUST verify a reused key
against prior accepted payload and canonical-output hashes before calling it an
exact duplicate; conflicting hash evidence MUST fail closed. The target object,
mapped properties, and target identity properties MUST resolve in the compiled
pack set. Every target
identity property MUST also be declared as identity by the target object or an
inherited object type; a mapping cannot promote an ordinary field into
canonical identity.

A descriptive v1 source mapping that omits `fieldMappings` remains a valid
documentation contract. It is not an executable mapping. A governed executor
MUST reject it until the owner supplies and reviews the complete executable
profile. This preserves old manifests without treating an undocumented
transform as code.

Each field mapping identifies a safe source path, target property,
requiredness, fixed normalizations, a primitive value map, an authority domain,
and a conflict policy. Normalization declarations are data, not executable
code. A consumer MUST NOT execute manifest text as a transform. Conflicting
values SHOULD retain their individual provenance unless an accepted authority
and review policy permits a governed resolution.

Each target identity property MUST have exactly one required field mapping
using the same property reference. Alias-equivalent duplicate targets MUST fail
compilation, and an executor MUST NOT choose a last-written identity value.
An executable mapping that produces no value for a target identity property
MUST fail closed.

An implementation claiming governed source-mapping execution SHOULD preserve
source and mapping hashes, source schema version, source authentication state,
authority reference, data classification, purpose tags, retention policy,
event and observation times, lateness, duplicate state, and field-level source
paths and value hashes. Schema drift, late arrivals, missing required fields,
content-hash mismatches, and review checkpoints SHOULD remain explicit receipt
state rather than being silently discarded. Mapping a record MUST NOT by itself
promote the source assertion to accepted authority.

Event, observation, watermark, request, and policy timestamps used in governed
decisions MUST include `Z` or an explicit numeric UTC offset. An implementation
MUST fail closed on timezone-less or invalid decision timestamps. Present but
blank timestamps and policy windows whose end does not follow their start are
invalid. Event, observation, and idempotency control paths MUST select an
explicit field below the payload root; they MUST NOT use `$` to hide nested
schema drift.

`authorityModel` declares who may establish or review meaning in a domain.
Authority declarations do not grant application credentials or action
capabilities by themselves.

`eventTypes` and `reasoningFunctions` describe reusable semantic operations and
their human checkpoints. Implementations MUST apply their own authentication,
authorization, idempotency, and audit controls when executing them.

## 9. Decision Templates

A decision template defines a reusable decision problem. It may declare:

- required context and facts;
- objective and success measure;
- alternatives and criteria;
- comparison method, policies, assumptions, forecasts, and uncertainties;
- authority, delegation, approval limit, and risk level;
- allowed action proposals and rollback expectation;
- outcome measures and review horizon;
- a decision-learning contract.

A template does not authorize its own recommendation. Recommendation,
authorization, execution, observation, and knowledge promotion SHOULD remain
separate records and write paths.

## 10. Decision-Learning Contract

The learning contract freezes how an episode may become evidence. It contains:

- `mode`: none, supervised feedback, contextual bandit, sequential RL, or
  optimization;
- state and action schemas;
- a weighted reward specification;
- observation schedule and terminal conditions;
- exploration and safety constraints;
- promotion criteria.

Reward dimensions declare a measure reference, direction, weight, observation
window, baseline method, attribution method, and optional guardrail. A runtime
MUST evaluate the reward specification frozen when the episode opened. A later
assessment MUST NOT substitute a different specification to hide an incomplete
dimension or guardrail violation.

Promotion SHOULD use evidence that was not used to author or train the
candidate. Training and holdout episode IDs MUST be disjoint. Replay MUST report
logged-action coverage and MUST NOT treat unsupported actions as observed
outcomes. Contextual-bandit and sequential episodes require the behavior
policy's logged action probability.

Low-sample evidence SHOULD remain visibly labeled even if a configured numeric
threshold passes. A guardrail violation MUST block automated promotion unless a
separate, explicit governance process records a waiver.

## 11. Normalization and Validation Rules

`normalizationRules` document canonical transformations. They SHOULD be
deterministic and SHOULD NOT erase provenance or uncertainty.

`validationRules` express domain constraints beyond structural schema validity.
They identify target, assertion, severity, and message. A declared rule is not
enforced merely because it appears in a manifest; a consumer claiming rule
conformance MUST execute it or explicitly report it as unsupported.

`openSemanticQuestions` preserve unresolved meaning rather than disguising it
as stable ontology. They SHOULD identify an owner and blocking impact.

## 12. Determinism and Hashes

Equivalent semantic input MUST produce identical semantic hashes. Cosmetic key
ordering and irrelevant JSON object ordering MUST NOT change a semantic hash.
Array order is significant where the schema defines ordered behavior, including
policy rules and pack precedence.

A resolution result SHOULD identify every selected pack version, source content
hash, compiled definition hash, and overall resolution hash. Implementations
MUST NOT claim reproducibility when dependencies or context were fetched
implicitly after the compilation request.

## 13. Versioning and Compatibility

`manifestVersion` versions the format. `ontologyVersion` versions one pack's
semantic content.

- Patch ontology versions may clarify labels or non-normative descriptions.
- Minor ontology versions may add backward-compatible optional definitions.
- Major ontology versions are required for removal, incompatible type changes,
  or changed meaning of an existing identifier.

Deprecation precedes removal. Replacements SHOULD name migration guidance.
Consumers SHOULD retain the exact pack set and content hashes used by each
decision context so later upgrades do not rewrite historical meaning.

## 14. Security and Privacy

Ontology packs are untrusted input. Implementations MUST validate size and
structure, reject unsafe state paths, avoid code execution from manifest text,
and constrain external resolution. Source locators may contain sensitive
identifiers and SHOULD be protected according to the owning system's policy.

The manifest format MUST NOT be used to distribute credentials. A semantic
authority declaration is not an authentication secret, an API scope, or an
execution capability.

Purpose-limited access evaluation SHOULD be fail-closed. An explicit deny
SHOULD take precedence over an allow, and absence of an applicable allow SHOULD
produce a default deny. Policies MAY constrain principal roles, stated purpose,
subject relationship, data categories, jurisdiction, attributes, and effective
time. Disclosure receipts SHOULD bind the exact request and policy versions to
deterministic hashes and retain the principal, purpose, subject, requested data
categories, source-record references, decision, and reason.

An omitted selector is unconstrained. A present empty or malformed selector is
not a wildcard: it invalidates the policy rule, and an invalid rule anywhere in
the evaluated policy MUST prevent an allow decision. Attribute equality MUST
require that the requested attribute is present before comparing its value.
Blank, malformed, or nonpositive effective windows MUST fail closed.

Automatic entity linking MUST require nonblank entity keys, valid positive-
weight evidence rules, every required identifier match, the configured score
threshold, and a positive ambiguity margin. All supplied rules, including
invalid ones, MUST be bound to the decision evidence. An invalid rule MUST
prohibit automatic linking rather than being silently discarded; the result
MUST require human review or propose a new entity.

Such a receipt is evidence of reference-policy evaluation, not an
authentication token or an enforcement mechanism. The owning application MUST
authenticate the principal, provide trusted role and relationship assertions,
enforce the result, minimize the disclosure, and apply its retention and audit
requirements.

## 15. Extensions

The `extensions` object carries explicitly non-standard data. Extension keys
SHOULD use organization-controlled namespaces. Consumers MUST preserve unknown
extensions when round-tripping but MUST NOT treat them as normative T2K
semantics unless a separate profile defines that behavior.

Future standard fields will be introduced through a versioned schema rather
than by allowing unknown top-level properties in v1.

## 16. Reference Implementation Status

The public reference repository ships schema validation, normalization,
compilation, semantic hashes, governed source mapping, reversible entity-link
proposals, purpose-limited access receipts, reference policy execution,
held-out replay, reward aggregation, a portable Postgres lifecycle, a local
stdio MCP adapter, and a project scaffolder. Hosted Studio behavior is not part
of v1 conformance.
