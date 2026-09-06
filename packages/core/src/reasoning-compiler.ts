import {
  canonicalJson, compileOntologyPackSet, semanticHash,
  type CompileOntologyPackSetInput, type CompiledOntologyDefinition,
} from "./compiler.js";
import {
  array, compatibleType, deepFreeze, GraphFunctionError, identifier, integer, literalType,
  object, reasoningData, requireCondition, valueTypes,
} from "./reasoning-input.js";
import type {
  CompiledGraphFunction, GraphFunctionDefinition, GraphFunctionTemplate, GraphValueType,
} from "./reasoning-types.js";

export const GRAPH_RUNTIME_VERSION = "t2k.graph-runtime.v1" as const;

export interface StepType {
  kind: "bindings" | "rows" | "scalar";
  bindings: Record<string, string>;
  fields: Record<string, GraphValueType>;
}

export interface GraphPlan {
  definition: GraphFunctionDefinition;
  definitions: Map<string, CompiledOntologyDefinition>;
  stepTypes: Map<string, StepType>;
}

const plans = new WeakMap<CompiledGraphFunction, GraphPlan>();

export function graphPlan(compiled: CompiledGraphFunction): GraphPlan {
  const plan = plans.get(compiled);
  requireCondition(plan, "uncompiled_function", "Compile the function with this runtime before executing it.");
  return plan;
}

export function assignable(
  definitions: Map<string, CompiledOntologyDefinition>, actual: string, expected: string
): boolean {
  const visited = new Set<string>();
  while (!visited.has(actual)) {
    if (actual === expected) return true;
    visited.add(actual);
    const definition = definitions.get(actual);
    const parent = definition?.body.specializes;
    if (!definition || typeof parent !== "string") return false;
    const local = definition.ontologyId + ":" + parent;
    actual = definitions.has(local) ? local : parent;
  }
  return false;
}

export function propertyDefinition(plan: Pick<GraphPlan, "definitions">, reference: string) {
  const property = plan.definitions.get(reference);
  requireCondition(property?.definitionKind === "property",
    "unknown_property", "Unknown property: " + reference);
  requireCondition(valueTypes.includes(property.body.valueType as GraphValueType),
    "unsupported_type", "Unsupported runtime property type: " + property.body.valueType);
  return property;
}

export function operandType(
  operand: any, inputs: Record<string, GraphValueType>,
  state: StepType, definitions: Map<string, CompiledOntologyDefinition>
): GraphValueType {
  requireCondition(operand && typeof operand === "object" && !Array.isArray(operand),
    "invalid_contract", "An operand must be a declared argument, literal, entity, or property.");
  if (Object.hasOwn(operand, "argument")) {
    object(operand, ["argument"]);
    identifier(operand.argument, "Argument");
    requireCondition(Object.hasOwn(inputs, operand.argument), "unknown_argument", "Unknown argument: " + operand.argument);
    return inputs[operand.argument];
  }
  if (Object.hasOwn(operand, "literal")) {
    object(operand, ["literal"]);
    return literalType(operand.literal);
  }
  if (Object.hasOwn(operand, "entity")) {
    object(operand, ["entity"]);
    identifier(operand.entity, "Entity binding");
    requireCondition(Object.hasOwn(state.bindings, operand.entity),
      "unknown_binding", "Unknown entity binding: " + operand.entity);
    return "string";
  }
  object(operand, ["binding", "property"]);
  identifier(operand.binding, "Property binding");
  identifier(operand.property, "Property reference");
  const typeRef = state.bindings[operand.binding];
  const property = propertyDefinition({ definitions }, operand.property);
  requireCondition(typeRef && assignable(definitions, typeRef, String(property.body.objectType)),
    "type_mismatch", "Property does not belong to binding: " + operand.property);
  return property.body.valueType as GraphValueType;
}

function fieldTypes(value: any, label: string): Record<string, GraphValueType> {
  requireCondition(value && typeof value === "object" && !Array.isArray(value),
    "invalid_contract", label + " must be an object.");
  requireCondition(Object.keys(value).length <= 32, "input_limit", label + " has too many fields.");
  for (const [key, type] of Object.entries(value)) {
    identifier(key, label + " field");
    requireCondition(valueTypes.includes(type as GraphValueType), "unsupported_type", "Unsupported type in " + label);
  }
  return value;
}

/** Validate the immutable signature without inventing or executing a witness program. */
export function graphFunctionTemplatePlan(input: {
  template: unknown; ontology: CompileOntologyPackSetInput;
}) {
  const data = reasoningData(input);
  object(data, ["template", "ontology"]);
  object(data.ontology, ["manifests", "roots"], ["mode", "contextValues"], "Ontology input");
  array(data.ontology.manifests, 64, "Ontology manifests");
  array(data.ontology.roots, 64, "Ontology roots");
  const definition = data.template;
  object(definition, [
    "artifactVersion", "functionRef", "ontologyResolutionHash", "inputs", "output",
    "maxAgeSeconds", "limits",
  ], [], "Function template");
  requireCondition(definition.artifactVersion === "t2k.graph-function.v1",
    "invalid_contract", "Unsupported graph-function version.");
  identifier(definition.functionRef, "Function reference");
  const compilation = compileOntologyPackSet({ ...data.ontology, mode: data.ontology.mode ?? "deployment" });
  requireCondition(compilation.status === "valid", "invalid_ontology",
    "Ontology compilation failed: " + compilation.diagnostics.map((item) => item.code).join(", "));
  requireCondition(definition.ontologyResolutionHash === compilation.resolutionHash,
    "ontology_mismatch", "The function must pin the exact compiled ontology resolution.");
  const definitions = new Map(compilation.definitions.map((item) => [item.definitionKey, item]));
  requireCondition(definitions.get(definition.functionRef)?.definitionKind === "reasoning_function",
    "unknown_function", "Function reference is not declared in the ontology.");
  fieldTypes(definition.inputs, "Inputs");
  integer(definition.maxAgeSeconds, 1, 315_360_000, "maxAgeSeconds");
  object(definition.limits, ["maxRows", "maxWork"]);
  integer(definition.limits.maxRows, 1, 2_000, "maxRows");
  integer(definition.limits.maxWork, 1, 100_000, "maxWork");
  if (definition.output?.kind === "rows") {
    object(definition.output, ["kind", "fields"]);
    const fields = fieldTypes(definition.output.fields, "Output");
    requireCondition(Object.keys(fields).length > 0, "invalid_contract", "Row output requires at least one field.");
  } else {
    object(definition.output, ["kind", "valueType"]);
    requireCondition(definition.output.kind === "scalar" && definition.output.valueType === "number",
      "type_mismatch", "Output must be typed rows or a numeric scalar.");
  }
  return { template: definition as GraphFunctionTemplate, definitions, resolutionHash: compilation.resolutionHash };
}

/** Compile a restricted operator program against the actual ontology compiler. */
export function compileGraphFunction(input: {
  definition: unknown; ontology: CompileOntologyPackSetInput;
}): CompiledGraphFunction {
  const data = reasoningData(input);
  object(data, ["definition", "ontology"]);
  object(data.definition, ["artifactVersion", "functionRef", "ontologyResolutionHash", "inputs", "output",
    "steps", "return", "maxAgeSeconds", "limits"], [], "Function definition");
  const { steps: _steps, return: _return, ...template } = data.definition;
  const { definitions, resolutionHash } = graphFunctionTemplatePlan({ template, ontology: data.ontology });
  const definition = data.definition;
  const inputs = definition.inputs as GraphFunctionTemplate["inputs"];
  array(definition.steps, 32, "Steps");
  requireCondition(definition.steps.length > 0, "invalid_contract", "At least one step is required.");
  const stepTypes = new Map<string, StepType>();
  const empty: StepType = { kind: "bindings", bindings: {}, fields: {} };
  for (const step of definition.steps) {
    try {
    requireCondition(step && typeof step === "object", "invalid_contract", "Invalid step.");
    identifier(step.id, "Step id");
    requireCondition(!stepTypes.has(step.id), "duplicate_step", "Duplicate step id.");
    let state: StepType = empty;
    if (step.op === "lookup") {
      object(step, ["id", "op", "typeRef", "as"], ["entityId"]);
      identifier(step.typeRef, "Lookup type");
      identifier(step.as, "Lookup alias");
      requireCondition(definitions.get(step.typeRef)?.definitionKind === "object_type",
        "unknown_type", "Lookup references an unknown object type.");
      if (step.entityId !== undefined) {
        requireCondition(operandType(step.entityId, inputs, empty, definitions) === "string",
          "type_mismatch", "Lookup identifiers must be strings.");
      }
      state = { kind: "bindings", bindings: { [step.as]: step.typeRef }, fields: {} };
    } else {
      identifier(step.from, "Previous step");
      const previous = stepTypes.get(step.from);
      requireCondition(previous, "unknown_step", "A step must reference a preceding step.");
      if (step.op === "traverse") {
        object(step, ["id", "op", "from", "source", "relation", "direction", "as"]);
        identifier(step.source, "Traversal source");
        identifier(step.as, "Traversal alias");
        identifier(step.relation, "Relation reference");
        requireCondition(previous.kind === "bindings" && Object.hasOwn(previous.bindings, step.source) &&
          !Object.hasOwn(previous.bindings, step.as), "type_mismatch", "Traversal requires a source and a new binding.");
        requireCondition(["outgoing", "incoming"].includes(step.direction), "invalid_contract", "Invalid traversal direction.");
        const relation = definitions.get(step.relation);
        requireCondition(relation?.definitionKind === "structural_relationship",
          "unknown_relation", "Traversal references an undeclared relation.");
        const sourceType = String(relation.body[step.direction === "outgoing" ? "from" : "to"]);
        const targetType = String(relation.body[step.direction === "outgoing" ? "to" : "from"]);
        requireCondition(assignable(definitions, previous.bindings[step.source], sourceType),
          "type_mismatch", "Traversal source violates the relationship domain/range.");
        state = { kind: "bindings", bindings: { ...previous.bindings, [step.as]: targetType }, fields: {} };
      } else if (step.op === "filter") {
        object(step, ["id", "op", "from", "all"]);
        requireCondition(previous.kind === "bindings", "type_mismatch", "Filters operate on entity bindings.");
        array(step.all, 16, "Filter conditions");
        requireCondition(step.all.length > 0, "invalid_contract", "An empty filter is not supported.");
        for (const condition of step.all) {
          object(condition, ["left", "operator", "right"]);
          const left = operandType(condition.left, inputs, previous, definitions);
          const right = operandType(condition.right, inputs, previous, definitions);
          if (condition.operator === "contains") {
            requireCondition(left === "string_list" && right === "string", "type_mismatch", "contains requires a string list and a string.");
          } else if (["gt", "gte", "lt", "lte"].includes(condition.operator)) {
            requireCondition(["number", "integer"].includes(left) && ["number", "integer"].includes(right),
              "type_mismatch", "Numeric comparison requires numeric operands.");
          } else {
            requireCondition(["eq", "neq"].includes(condition.operator), "unsupported_operator", "Unsupported comparison operator.");
            requireCondition(compatibleType(left, right) || compatibleType(right, left),
              "type_mismatch", "Comparison operands have incompatible types.");
          }
        }
        state = previous;
      } else if (step.op === "project") {
        object(step, ["id", "op", "from", "fields"]);
        requireCondition(previous.kind === "bindings" && step.fields && typeof step.fields === "object" &&
          !Array.isArray(step.fields), "type_mismatch", "Projection requires bindings and named fields.");
        const fields: Record<string, GraphValueType> = Object.create(null);
        const entries = Object.entries(step.fields);
        requireCondition(entries.length > 0 && entries.length <= 32, "input_limit", "Projection requires 1–32 fields.");
        for (const [name, operand] of entries) {
          identifier(name, "Projection field");
          fields[name] = operandType(operand, inputs, previous, definitions);
        }
        state = { kind: "rows", fields, bindings: {} };
      } else if (step.op === "aggregate") {
        object(step, ["id", "op", "from", "operation"], ["field"]);
        requireCondition(previous.kind !== "scalar", "type_mismatch", "Aggregation requires a collection.");
        requireCondition(["count", "sum", "min", "max", "mean"].includes(step.operation),
          "unsupported_operator", "Unsupported aggregation.");
        if (step.operation === "count") {
          requireCondition(step.field === undefined, "invalid_contract", "count does not take a field.");
        } else {
          identifier(step.field, "Aggregate field");
          requireCondition(previous.kind === "rows" && ["number", "integer"].includes(previous.fields[step.field]),
            "type_mismatch", "Aggregation requires a projected numeric field.");
        }
        state = { kind: "scalar", bindings: {}, fields: {} };
      } else {
        requireCondition(false, "unsupported_operator", "Unsupported graph operator: " + step.op);
      }
    }
    stepTypes.set(step.id, state);
    } catch (error) {
      if (error instanceof GraphFunctionError) throw new GraphFunctionError(error.code, error.message, {
        path: "program.steps." + definition.steps.indexOf(step),
        ...(typeof step?.id === "string" ? { stepId: step.id } : {}),
        ...(typeof step?.op === "string" ? { operator: step.op } : {}),
      });
      throw error;
    }
  }
  identifier(definition.return, "Return step");
  const returned = stepTypes.get(definition.return);
  requireCondition(returned && definition.steps.at(-1).id === definition.return,
    "invalid_return", "Return must reference the final step.");
  const used = new Set<string>();
  let current = definition.steps.at(-1);
  while (current) {
    used.add(current.id);
    current = current.from ? definition.steps.find((step: any) => step.id === current.from) : undefined;
  }
  requireCondition(used.size === definition.steps.length, "unused_step", "Every step must contribute to the returned result.");
  if (returned.kind === "rows") {
    object(definition.output, ["kind", "fields"]);
    const fields = fieldTypes(definition.output.fields, "Output");
    requireCondition(definition.output.kind === "rows" &&
      canonicalJson(Object.keys(fields).sort()) === canonicalJson(Object.keys(returned.fields).sort()) &&
      Object.entries(fields).every(([key, type]) => compatibleType(returned.fields[key], type)),
      "type_mismatch", "Declared output does not match the projection.");
  } else {
    object(definition.output, ["kind", "valueType"]);
    requireCondition(returned.kind === "scalar" && definition.output.kind === "scalar" &&
      definition.output.valueType === "number", "type_mismatch", "Return must be a typed projection or numeric aggregate.");
  }
  const typed = deepFreeze(definition as GraphFunctionDefinition);
  const compiled: CompiledGraphFunction = Object.freeze({
    runtimeVersion: GRAPH_RUNTIME_VERSION, functionRef: typed.functionRef,
    functionHash: semanticHash({ runtimeVersion: GRAPH_RUNTIME_VERSION, definition: typed }),
    ontologyResolutionHash: resolutionHash, definition: typed,
  });
  plans.set(compiled, { definition: typed, definitions, stepTypes });
  return compiled;
}
