import { snapshotJsonData } from "./reference-json-input.js";
import { parseExplicitTimestamp } from "./reference-time.js";
import type { GraphValue, GraphValueType } from "./reasoning-types.js";

export class GraphFunctionError extends Error {
  constructor(public readonly code: string, message: string, public readonly context?: { path: string; stepId?: string; operator?: string }) {
    super(message);
    this.name = "GraphFunctionError";
  }
}

export function requireCondition(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new GraphFunctionError(code, message);
}

/** Bound own-data traversal before copying; never evaluate input getters. */
export function reasoningData(value: unknown): any {
  let nodes = 0;
  let characters = 0;
  const ancestors = new WeakSet<object>();
  function countText(value: string) {
    characters += value.length;
    requireCondition(value.length <= 32_768 && characters <= 4_000_000,
      "input_limit", "Input text exceeds the runtime limit.");
  }
  function visit(item: unknown, depth: number) {
    requireCondition(++nodes <= 150_000 && depth <= 32, "input_limit", "Input is too large or deep.");
    if (typeof item === "string") countText(item);
    if (item === null || typeof item !== "object") return;
    requireCondition(!ancestors.has(item), "invalid_json", "Cyclic input is not supported.");
    ancestors.add(item);
    const keys = Reflect.ownKeys(item);
    requireCondition(keys.length <= 20_001, "input_limit", "Input collection exceeds the runtime limit.");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireCondition(typeof key === "string" && descriptor && "value" in descriptor,
        "invalid_json", "Only JSON data properties are supported.");
      countText(key);
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  try {
    visit(value, 0);
  } catch (error) {
    if (error instanceof GraphFunctionError) throw error;
    throw new GraphFunctionError("invalid_json", "Input must contain plain JSON data.");
  }
  const snapshot = snapshotJsonData(value);
  requireCondition(snapshot.valid, "invalid_json", "Input must contain finite JSON data.");
  return snapshot.value;
}

export function object(value: any, required: string[], optional: string[] = [], label = "Object") {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid_contract", label + " must be an object.");
  const allowed = new Set([...required, ...optional]);
  requireCondition(Object.keys(value).every((key) => allowed.has(key)) &&
    required.every((key) => Object.hasOwn(value, key)),
    "invalid_contract", label + " has missing or unsupported fields.");
}

export function identifier(value: any, label: string): asserts value is string {
  requireCondition(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value),
    "invalid_contract", label + " must be a stable identifier.");
}

export function textValue(value: any, label: string): asserts value is string {
  requireCondition(typeof value === "string" && value.trim().length > 0,
    "invalid_contract", label + " must be non-empty text.");
}

export function array(value: any, maximum: number, label: string): asserts value is any[] {
  requireCondition(Array.isArray(value) && value.length <= maximum, "input_limit",
    label + " must be an array of at most " + maximum + " items.");
}

export function integer(value: any, minimum: number, maximum: number, label: string) {
  requireCondition(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "invalid_contract", label + " is outside the supported integer range.");
}

export function timestamp(value: any, label: string): number {
  const parsed = typeof value === "string" ? parseExplicitTimestamp(value) : null;
  requireCondition(parsed !== null, "invalid_timestamp", label + " requires a valid timestamp with an explicit offset.");
  return parsed;
}

export const valueTypes: GraphValueType[] = ["string", "number", "integer", "boolean", "string_list"];

export function validValue(value: unknown, type: GraphValueType): value is GraphValue {
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function literalType(value: unknown): GraphValueType {
  for (const type of ["string", "boolean", "number", "string_list"] as GraphValueType[]) {
    if (validValue(value, type)) return type;
  }
  throw new GraphFunctionError("type_mismatch", "Unsupported literal value.");
}

export function compatibleType(actual: GraphValueType, expected: GraphValueType) {
  return actual === expected || (actual === "integer" && expected === "number");
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
