import type { JsonObject, JsonValue } from "./types.js";

export type JsonSnapshot =
  | { valid: true; value: JsonValue }
  | { valid: false; value: null };

function snapshotArray(
  value: unknown[],
  ancestors: WeakSet<object>
): JsonSnapshot {
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as
    Record<PropertyKey, PropertyDescriptor>;
  const lengthDescriptor = descriptors["length"];
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return { valid: false, value: null };
  }
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
    )
  ) {
    return { valid: false, value: null };
  }
  if (ancestors.has(value)) return { valid: false, value: null };
  ancestors.add(value);
  const output: JsonValue[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      ancestors.delete(value);
      return { valid: false, value: null };
    }
    const item = snapshotJsonDataInternal(descriptor.value, ancestors);
    if (!item.valid) {
      ancestors.delete(value);
      return item;
    }
    output.push(item.value);
  }
  ancestors.delete(value);
  return { valid: true, value: output };
}

function snapshotObject(
  value: object,
  ancestors: WeakSet<object>
): JsonSnapshot {
  if (ancestors.has(value)) return { valid: false, value: null };
  ancestors.add(value);
  const output = Object.create(null) as JsonObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      ancestors.delete(value);
      return { valid: false, value: null };
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      ancestors.delete(value);
      return { valid: false, value: null };
    }
    if (descriptor.value === undefined) continue;
    const item = snapshotJsonDataInternal(descriptor.value, ancestors);
    if (!item.valid) {
      ancestors.delete(value);
      return item;
    }
    output[key] = item.value;
  }
  ancestors.delete(value);
  return { valid: true, value: output };
}

function snapshotJsonDataInternal(
  value: unknown,
  ancestors: WeakSet<object>
): JsonSnapshot {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return { valid: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { valid: true, value }
      : { valid: false, value: null };
  }
  if (Array.isArray(value)) return snapshotArray(value, ancestors);
  if (typeof value === "object") return snapshotObject(value, ancestors);
  return { valid: false, value: null };
}

/**
 * Copies JSON-compatible input without invoking getters or consulting custom
 * prototypes. This keeps runtime decisions bound to the same own-property data
 * that is serialized into evidence hashes.
 */
export function snapshotJsonData(value: unknown): JsonSnapshot {
  try {
    return snapshotJsonDataInternal(value, new WeakSet<object>());
  } catch {
    return { valid: false, value: null };
  }
}

export function snapshotJsonObject(value: unknown): {
  valid: boolean;
  value: JsonObject;
} {
  const snapshot = snapshotJsonData(value);
  return snapshot.valid &&
    typeof snapshot.value === "object" &&
    !Array.isArray(snapshot.value) &&
    snapshot.value !== null
    ? { valid: true, value: snapshot.value as JsonObject }
    : { valid: false, value: Object.create(null) as JsonObject };
}
