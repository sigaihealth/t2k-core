import { compileOntologyPackSet, semanticHash, type CompiledOntologyDefinition } from "./compiler.js";
import { array, deepFreeze, identifier, object, reasoningData, requireCondition } from "./reasoning-input.js";
import type { GraphGenerationContract, GraphGenerationRequest } from "./reasoning-generation.js";
import type { GraphValueType } from "./reasoning-types.js";

export const GRAPH_SYNTHESIS_CAPABILITIES = Object.freeze([
  "lookup", "traverse", "filter", "project", "count", "sum", "min", "max", "mean", "distinct",
] as const);

/** Explicit reviewed declarations; prose is not treated as a capability proof. */
export interface GraphGenerationRequirements {
  capabilities: string[];
  definitionRefs: string[];
  identityConstants: string[];
  ordering: "canonical" | "ranked";
  multiplicity: "preserve" | "distinct";
}

export interface GraphSynthesisDiagnostic {
  code: string;
  category: "capability" | "contract" | "compile" | "answer" | "evidence" | "data" | "identity" | "provider" | "budget";
  action: "repair_program" | "review_contract" | "extend_language" | "request_data" | "stop";
  path: string;
  message: string;
  details?: unknown;
}

export function normalizeGraphGenerationRequirements(value: unknown): GraphGenerationRequirements {
  const input = reasoningData(value);
  object(input, ["capabilities", "definitionRefs", "identityConstants", "ordering", "multiplicity"], [], "Requirements");
  for (const name of ["capabilities", "definitionRefs", "identityConstants"]) {
    array(input[name], 100, name);
    input[name].forEach((value: unknown) => identifier(value, name));
    requireCondition(new Set(input[name]).size === input[name].length, "invalid_contract", name + " must be unique.");
    input[name].sort();
  }
  requireCondition(["canonical", "ranked"].includes(input.ordering), "invalid_contract", "Unknown ordering declaration.");
  requireCondition(["preserve", "distinct"].includes(input.multiplicity), "invalid_contract", "Unknown multiplicity declaration.");
  return input;
}

/** Deterministic analysis of explicit requirements, never keyword guesses over task prose. */
export function analyzeGraphGenerationCapabilities(input: Pick<GraphGenerationContract, "ontology" | "requirements">): GraphSynthesisDiagnostic[] {
  if (!input.requirements) return [];
  const requirements = normalizeGraphGenerationRequirements(input.requirements);
  const diagnostics: GraphSynthesisDiagnostic[] = [];
  const unsupported = (path: string, name: string) => diagnostics.push({ code: "unsupported_requirement", category: "capability",
    action: "extend_language", path, message: "The current graph language does not support " + name + "." });
  requirements.capabilities.forEach((capability, index) => {
    if (!(GRAPH_SYNTHESIS_CAPABILITIES as readonly string[]).includes(capability)) unsupported("requirements.capabilities." + index, capability);
  });
  if (requirements.ordering !== "canonical") unsupported("requirements.ordering", "ranked output; rows use canonical ordering");
  if (requirements.capabilities.includes("distinct") !== (requirements.multiplicity === "distinct")) {
    diagnostics.push({ code: "contract_needs_review", category: "contract", action: "review_contract",
      path: "requirements.multiplicity", message: "Entity distinctness requires both multiplicity 'distinct' and the 'distinct' capability; otherwise use multiplicity 'preserve'." });
  }
  const resolution = compileOntologyPackSet(input.ontology);
  const definitions = new Set(resolution.definitions.map((item) => item.definitionKey));
  requirements.definitionRefs.forEach((reference, index) => {
    if (!definitions.has(reference)) diagnostics.push({ code: "contract_needs_review", category: "contract", action: "review_contract",
      path: "requirements.definitionRefs." + index, message: "Required definition is absent from the pinned ontology: " + reference });
  });
  return diagnostics;
}

/**
 * Conservative pack-level dependency closure: retain every definition in the function,
 * development-data and explicitly required packs, plus their manifest dependencies.
 * Preserve global context and policy definitions. Never rewrite the pinned resolution.
 */
export function graphGenerationOntologyContext(input: Pick<GraphGenerationRequest, "ontology" | "template" | "trainingCases" | "requirements">) {
  const resolution = compileOntologyPackSet(input.ontology);
  requireCondition(resolution.status === "valid" && resolution.resolutionHash === input.template.ontologyResolutionHash,
    "ontology_mismatch", "Generation context requires the full pinned ontology resolution.");
  const byKey = new Map(resolution.definitions.map((item) => [item.definitionKey, item]));
  const selected = new Set<string>();
  const include = (ref: string) => { const item = byKey.get(ref); if (item) selected.add(item.ontologyId); };
  include(input.template.functionRef);
  input.trainingCases.forEach((item) => {
    item.graph.entities.forEach((entity) => include(entity.typeRef));
    item.graph.claims.forEach((claim) => include(claim.predicateRef));
  });
  input.requirements?.definitionRefs.forEach(include);
  // Keep every non-data definition's owning pack: rules can constrain otherwise unrelated data.
  resolution.definitions.filter((item) => !["object_type", "property", "structural_relationship", "reasoning_function"].includes(item.definitionKind))
    .forEach((item) => selected.add(item.ontologyId));
  const manifestById = new Map(input.ontology.manifests.map((manifest: any) => [manifest.ontologyId + "@" + manifest.ontologyVersion, manifest]));
  let changed = true;
  while (changed) {
    const before = selected.size;
    for (const pack of resolution.packs.filter((pack) => selected.has(pack.ontologyId))) {
      const manifest = manifestById.get(pack.ontologyId + "@" + pack.ontologyVersion);
      // The complete selected manifest remains available, including prose and constraints.
      for (const dependency of manifest?.extends ?? []) selected.add(dependency.ontologyId);
      for (const definition of resolution.definitions.filter((item) => item.ontologyId === pack.ontologyId)) {
        // Reference syntax differs across definition kinds; resolve exact fully qualified refs conservatively.
        const visit = (value: unknown): void => {
          if (typeof value === "string") include(value);
          else if (value && typeof value === "object") Object.values(value).forEach(visit);
        };
        visit(definition.body);
      }
    }
    changed = before !== selected.size;
  }
  const definitions = resolution.definitions.filter((item) => selected.has(item.ontologyId));
  const packs = resolution.packs.filter((pack) => selected.has(pack.ontologyId));
  const compiledCollections = new Set(["objectTypes", "structuralRelationships", "canonicalLinks", "contextDimensions", "sourceMappings",
    "authorityModel", "eventTypes", "reasoningFunctions", "decisionTemplates", "normalizationRules", "validationRules", "openSemanticQuestions"]);
  return deepFreeze({
    contextVersion: "t2k.graph-generation-context.v1", fullResolutionHash: resolution.resolutionHash,
    roots: resolution.roots, packs,
    packMetadata: packs.map((pack) => Object.fromEntries(Object.entries(manifestById.get(pack.ontologyId + "@" + pack.ontologyVersion) ?? {})
      .filter(([key]) => !compiledCollections.has(key)))),
    definitions,
    mapping: definitions.map(({ definitionKey, contentHash, ontologyId, ontologyVersion }) => ({ definitionKey, contentHash, ontologyId, ontologyVersion })),
    omittedDefinitions: resolution.definitions.length - definitions.length,
    contextRequirements: resolution.contextRequirements, contextValues: input.ontology.contextValues ?? {},
  });
}

type Schema = Record<string, unknown>;
const strictObject = (properties: Record<string, Schema>): Schema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const stringSchema = (): Schema => ({ type: "string" });
const enumSchema = (values: readonly string[]): Schema => ({ type: "string", enum: values });

/** Provider-supported strict schema for the IR itself. Compiler checks binding/type flow. */
export function graphGenerationProgramSchema(input: Pick<GraphGenerationRequest, "ontology" | "template" | "trainingCases" | "requirements">): Schema {
  const context = graphGenerationOntologyContext(input);
  const refs = (kind: CompiledOntologyDefinition["definitionKind"]) => context.definitions.filter((item) => item.definitionKind === kind).map((item) => item.definitionKey);
  const argumentsFor = (types?: GraphValueType[]) => Object.entries(input.template.inputs).filter(([, type]) => !types || types.includes(type)).map(([name]) => name);
  function operand(types?: GraphValueType[]): Schema {
    const choices: Schema[] = [];
    const args = argumentsFor(types);
    if (args.length) choices.push(strictObject({ argument: enumSchema(args) }));
    const literal: Schema[] = [];
    if (!types || types.includes("string")) literal.push(stringSchema());
    if (!types || types.some((type) => type === "number" || type === "integer")) literal.push({ type: "number" });
    if (!types || types.includes("boolean")) literal.push({ type: "boolean" });
    if (!types || types.includes("string_list")) literal.push({ type: "array", items: stringSchema() });
    if (literal.length) choices.push(strictObject({ literal: literal.length === 1 ? literal[0] : { anyOf: literal } }));
    if (!types || types.includes("string")) choices.push(strictObject({ entity: stringSchema() }));
    const properties = context.definitions.filter((item) => item.definitionKind === "property" &&
      (!types || types.includes(item.body.valueType as GraphValueType) || types.includes("number") && item.body.valueType === "integer"))
      .map((item) => item.definitionKey);
    if (properties.length) choices.push(strictObject({ binding: stringSchema(), property: enumSchema(properties) }));
    return choices.length === 1 ? choices[0] : { anyOf: choices };
  }
  const definitions: Record<string, Schema> = { operand: operand(), objectType: enumSchema(refs("object_type")) };
  const anyOperand = { $ref: "#/$defs/operand" };
  const lookup = { id: stringSchema(), op: enumSchema(["lookup"]), typeRef: { $ref: "#/$defs/objectType" }, as: stringSchema() };
  const idOperands: Schema[] = [strictObject({ literal: stringSchema() })];
  const idArgs = argumentsFor(["string"]);
  if (idArgs.length) idOperands.push(strictObject({ argument: enumSchema(idArgs) }));
  const variants: Schema[] = [strictObject(lookup), strictObject({ ...lookup, entityId: { anyOf: idOperands } })];
  const relations = refs("structural_relationship");
  if (relations.length) variants.push(strictObject({ id: stringSchema(), op: enumSchema(["traverse"]), from: stringSchema(),
    source: stringSchema(), relation: enumSchema(relations), direction: enumSchema(["outgoing", "incoming"]), as: stringSchema() }));
  variants.push(strictObject({ id: stringSchema(), op: enumSchema(["filter"]), from: stringSchema(), all: { type: "array", minItems: 1, maxItems: 16,
    items: strictObject({ left: anyOperand, operator: enumSchema(["eq", "neq", "gt", "gte", "lt", "lte", "contains"]), right: anyOperand }) } }));
  if (input.requirements?.multiplicity === "distinct" && input.requirements.capabilities.includes("distinct")) {
    variants.push(strictObject({ id: stringSchema(), op: enumSchema(["distinct"]), from: stringSchema(), binding: stringSchema() }));
  }
  const outputFields = input.template.output.kind === "rows" ? input.template.output.fields : { value: "number" as const };
  for (const type of new Set(Object.values(outputFields))) definitions["operand_" + type] = operand([type]);
  variants.push(strictObject({ id: stringSchema(), op: enumSchema(["project"]), from: stringSchema(),
    fields: strictObject(Object.fromEntries(Object.entries(outputFields).map(([field, type]) => [field, { $ref: "#/$defs/operand_" + type }])) ) }));
  if (input.template.output.kind === "scalar") {
    variants.push(strictObject({ id: stringSchema(), op: enumSchema(["aggregate"]), from: stringSchema(), operation: enumSchema(["count"]) }));
    variants.push(strictObject({ id: stringSchema(), op: enumSchema(["aggregate"]), from: stringSchema(), operation: enumSchema(["sum", "min", "max", "mean"]), field: enumSchema(["value"]) }));
  }
  return { ...strictObject({ steps: { type: "array", minItems: 1, maxItems: 32, items: { anyOf: variants } }, return: stringSchema() }), $defs: definitions };
}

/** Flags declared-identity violations even when the small development suite passes. */
export function graphGenerationIdentityDiagnostics(program: unknown, input: Pick<GraphGenerationContract, "trainingCases" | "requirements">): GraphSynthesisDiagnostic[] {
  const known = new Set(input.trainingCases.flatMap((item) => item.graph.entities.map((entity) => entity.entityId)));
  const allowed = new Set(input.requirements?.identityConstants ?? []);
  const diagnostics: GraphSynthesisDiagnostic[] = [];
  function visit(value: any, path: string) {
    if (!value || typeof value !== "object") return;
    const literals: Array<{ identity: unknown; path: string }> = Array.isArray(value.literal)
      ? value.literal.map((identity: unknown, index: number) => ({ identity, path: path + ".literal." + index }))
      : [{ identity: value.literal, path: path + ".literal" }];
    for (const literal of literals) if (typeof literal.identity === "string" && !allowed.has(literal.identity) && (known.has(literal.identity) || path.endsWith(".entityId"))) {
      diagnostics.push({ code: "undeclared_identity_constant", category: "identity", action: "repair_program", path: literal.path,
        message: "Use a declared argument or graph binding instead of a development entity identity.", details: { identity: literal.identity } });
    }
    Object.entries(value).forEach(([key, item]) => visit(item, path + "." + key));
  }
  visit(program, "program");
  return diagnostics;
}

/** Presence is a necessary condition only; reviewed cases still establish the selected entity and placement. */
export function graphGenerationMultiplicityDiagnostics(program: unknown, input: Pick<GraphGenerationContract, "requirements">): GraphSynthesisDiagnostic[] {
  const steps = (program as { steps?: Array<{ op?: string }> })?.steps;
  const usesDistinct = Array.isArray(steps) && steps.some((step) => step?.op === "distinct");
  // Legacy contracts preserve paths by default, even when a custom provider bypasses the opt-in schema.
  if (usesDistinct === (input.requirements?.multiplicity === "distinct")) return [];
  return [{ code: "multiplicity_mismatch", category: "contract", action: "repair_program", path: "program.steps",
    message: usesDistinct ? "The reviewed contract preserves path multiplicity; remove the distinct step." :
      "The reviewed contract requires entity distinctness; add a distinct step on the intended entity binding before projection or aggregation." }];
}

/** Bound entire diagnostic entries as JSON, retaining counts even when samples are omitted. */
export function boundedGraphSynthesisDiagnostics(entries: GraphSynthesisDiagnostic[]) {
  const samples: GraphSynthesisDiagnostic[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (samples.length === 12) break;
    let sample = entry;
    if (JSON.stringify(sample).length > 1800) sample = { ...entry, message: entry.message.slice(0, 512), details: { omitted: true, digest: semanticHash(entry.details ?? null) } };
    const size = new TextEncoder().encode(JSON.stringify(sample)).byteLength;
    if (bytes + size > 12_000) break;
    samples.push(sample); bytes += size;
  }
  return { total: entries.length, omitted: entries.length - samples.length, truncated: samples.length !== entries.length || samples.some((entry) => (entry.details as any)?.omitted === true), samples };
}
