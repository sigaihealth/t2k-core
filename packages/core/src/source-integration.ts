import {
  canonicalJson,
  compareCanonicalStrings,
  semanticHash,
} from "./compiler.js";
import type {
  OntologyPackSourceFieldMapping,
  OntologyPackSourceMapping,
  OntologyPackSourceNormalization,
} from "./manifest.js";
import {
  parseDateOnlyUtc,
  parseExplicitTimestamp,
} from "./reference-time.js";
import type { JsonObject, JsonValue } from "./types.js";

export const SOURCE_AUTHENTICATION_STATES = [
  "authenticated",
  "unauthenticated",
  "system_asserted",
  "unknown",
] as const;
export type SourceAuthenticationState =
  (typeof SOURCE_AUTHENTICATION_STATES)[number];

export interface FederatedSourceEnvelope {
  sourceSystem: string;
  sourceLocator: string;
  sourceRecordKey: string;
  sourceSchemaVersion: string;
  payload: JsonObject;
  eventTime: string;
  observedTime: string;
  authenticationState: SourceAuthenticationState;
  authorityRef: string;
  dataClassification: string;
  purposeTags: string[];
  retentionPolicy: JsonObject;
  contentHash?: string;
}

export interface SourceMappingIssue {
  code: string;
  severity: "error" | "review" | "warning";
  message: string;
  sourcePath: string | null;
  targetProperty: string | null;
}

export interface CanonicalFieldProvenance {
  sourceSystem: string;
  sourceLocator: string;
  sourceRecordKey: string;
  sourceSchemaVersion: string;
  sourcePath: string;
  sourceValueHash: string;
  sourcePayloadHash: string;
  mappingId: string;
  mappingHash: string;
  eventTime: string;
  observedTime: string;
  authenticationState: SourceAuthenticationState;
  authorityRef: string;
  authorityDomain: string;
  dataClassification: string;
  purposeTags: string[];
  retentionPolicy: JsonObject;
}

export interface CanonicalFieldValue {
  propertyRef: string;
  value: JsonValue;
  conflictPolicy: OntologyPackSourceFieldMapping["conflictPolicy"];
  provenance: CanonicalFieldProvenance;
}

export interface FederatedCanonicalRecord {
  objectRef: string;
  identity: Record<string, JsonValue>;
  fields: CanonicalFieldValue[];
}

export interface SourceMappingReceipt {
  receiptVersion: "t2k.source-mapping-receipt.v1";
  status: "mapped" | "quarantined" | "rejected" | "duplicate";
  sourceSystem: string;
  sourceLocator: string;
  sourceRecordKey: string;
  sourceSchemaVersion: string;
  authenticationState: SourceAuthenticationState;
  authorityRef: string;
  dataClassification: string;
  purposeTags: string[];
  retentionPolicy: JsonObject;
  mappingId: string;
  mappingVersion: string;
  mappingHash: string;
  sourcePayloadHash: string;
  canonicalOutputHash: string;
  idempotencyKey: string;
  eventTime: string;
  observedTime: string;
  lateArrival: boolean;
  duplicate: boolean;
  humanReviewRequired: boolean;
  driftPolicy: NonNullable<OntologyPackSourceMapping["driftPolicy"]>;
  lateArrivalPolicy: NonNullable<
    OntologyPackSourceMapping["lateArrivalPolicy"]
  >;
  issues: SourceMappingIssue[];
  receiptHash: string;
}

export interface ExecuteSourceMappingInput {
  mapping: OntologyPackSourceMapping;
  envelope: FederatedSourceEnvelope;
  latestAcceptedEventTime?: string | null;
  /** @deprecated A key alone cannot prove an exact replay; use acceptedIdempotencyRecords. */
  seenIdempotencyKeys?: readonly string[];
  acceptedIdempotencyRecords?: readonly AcceptedIdempotencyRecord[];
}

export interface AcceptedIdempotencyRecord {
  idempotencyKey: string;
  sourcePayloadHash: string;
  canonicalOutputHash: string;
}

export interface ExecuteSourceMappingResult {
  canonicalRecord: FederatedCanonicalRecord;
  receipt: SourceMappingReceipt;
}

const SAFE_PATH = /^\$(?:\.[A-Za-z0-9_-]+)*$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function asTimestamp(value: string) {
  return parseExplicitTimestamp(value);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function readPath(payload: JsonObject, path: string): JsonValue | undefined {
  if (!SAFE_PATH.test(path)) return undefined;
  if (path === "$") return payload;

  let current: JsonValue = payload;
  for (const segment of path.slice(2).split(".")) {
    if (
      UNSAFE_SEGMENTS.has(segment) ||
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = current[segment] as JsonValue;
  }
  return current;
}

function normalizeIsoDate(value: JsonValue): JsonValue {
  if (typeof value !== "string") return value;
  const timestamp = parseDateOnlyUtc(value) ?? asTimestamp(value);
  return timestamp !== null && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : value;
}

function normalizeValue(
  value: JsonValue,
  normalizations: OntologyPackSourceNormalization[]
): JsonValue {
  return normalizations.reduce<JsonValue>((current, normalization) => {
    switch (normalization) {
      case "trim":
        return typeof current === "string" ? current.trim() : current;
      case "collapse_whitespace":
        return typeof current === "string"
          ? current.replace(/\s+/g, " ").trim()
          : current;
      case "lowercase":
        return typeof current === "string" ? current.toLowerCase() : current;
      case "uppercase":
        return typeof current === "string" ? current.toUpperCase() : current;
      case "digits_only":
        return typeof current === "string"
          ? current.replace(/[^0-9]/g, "")
          : current;
      case "iso_date":
        return normalizeIsoDate(current);
    }
  }, value);
}

function applyValueMap(value: JsonValue, valueMap: JsonObject): JsonValue {
  if (
    value === null ||
    typeof value === "object" ||
    !Object.hasOwn(valueMap, String(value))
  ) {
    return value;
  }
  return valueMap[String(value)] as JsonValue;
}

function issue(
  code: string,
  severity: SourceMappingIssue["severity"],
  message: string,
  sourcePath: string | null = null,
  targetProperty: string | null = null
): SourceMappingIssue {
  return { code, severity, message, sourcePath, targetProperty };
}

const SOURCE_NORMALIZATIONS = new Set<OntologyPackSourceNormalization>([
  "trim",
  "collapse_whitespace",
  "lowercase",
  "uppercase",
  "digits_only",
  "iso_date",
]);
const CONFLICT_POLICIES = new Set<
  OntologyPackSourceFieldMapping["conflictPolicy"]
>(["preserve_all", "prefer_authority", "require_review"]);
const DRIFT_POLICIES = new Set<
  NonNullable<OntologyPackSourceMapping["driftPolicy"]>
>(["reject", "quarantine", "allow_with_review"]);
const LATE_ARRIVAL_POLICIES = new Set<
  NonNullable<OntologyPackSourceMapping["lateArrivalPolicy"]>
>(["reject", "quarantine", "accept_with_review"]);
const HUMAN_CHECKPOINTS = new Set<
  NonNullable<OntologyPackSourceMapping["humanCheckpoint"]>
>(["always", "on_issue", "none"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sourcePathIsSafe(path: string) {
  return (
    SAFE_PATH.test(path) &&
    !path
      .slice(2)
      .split(".")
      .filter(Boolean)
      .some((segment) => UNSAFE_SEGMENTS.has(segment))
  );
}

function isPrimitiveJsonValue(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function isStableIdempotencyValue(
  value: JsonValue | undefined
): value is JsonValue {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isStableIdempotencyValue);
  }
  const parts = Object.values(value);
  return parts.length > 0 && parts.every(isStableIdempotencyValue);
}

function isExecutableFieldMapping(
  value: unknown
): value is OntologyPackSourceFieldMapping {
  if (!isRecord(value)) return false;
  const normalizations = value.normalizations;
  const valueMap = value.valueMap;
  return (
    typeof value.sourcePath === "string" &&
    sourcePathIsSafe(value.sourcePath) &&
    typeof value.targetProperty === "string" &&
    value.targetProperty.length > 0 &&
    typeof value.required === "boolean" &&
    Array.isArray(normalizations) &&
    normalizations.every(
      (normalization) =>
        typeof normalization === "string" &&
        SOURCE_NORMALIZATIONS.has(
          normalization as OntologyPackSourceNormalization
        )
    ) &&
    isRecord(valueMap) &&
    Object.values(valueMap).every(isPrimitiveJsonValue) &&
    typeof value.authorityDomain === "string" &&
    value.authorityDomain.length > 0 &&
    typeof value.conflictPolicy === "string" &&
    CONFLICT_POLICIES.has(
      value.conflictPolicy as OntologyPackSourceFieldMapping["conflictPolicy"]
    )
  );
}

function sourceFieldMappings(mapping: OntologyPackSourceMapping) {
  const values: unknown[] = Array.isArray(mapping.fieldMappings)
    ? mapping.fieldMappings
    : [];
  return values.filter(isExecutableFieldMapping).sort(
    (left, right) =>
      compareCanonicalStrings(left.targetProperty, right.targetProperty) ||
      compareCanonicalStrings(left.sourcePath, right.sourcePath) ||
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
}

function sourceLeafPaths(value: JsonValue, path = "$"): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [path];
  }
  const keys = Object.keys(value).sort(compareCanonicalStrings);
  if (keys.length === 0) return [path];
  return keys.flatMap((key) => {
    if (!SAFE_PATH_SEGMENT.test(key) || UNSAFE_SEGMENTS.has(key)) {
      return [`${path}[${JSON.stringify(key)}]`];
    }
    return sourceLeafPaths(value[key] as JsonValue, `${path}.${key}`);
  });
}

function sourcePathCovered(
  path: string,
  fieldPaths: readonly string[],
  controlPaths: readonly string[]
) {
  return (
    controlPaths.includes(path) ||
    fieldPaths.some(
      (fieldPath) =>
        fieldPath === "$" ||
        path === fieldPath ||
        path.startsWith(`${fieldPath}.`)
    )
  );
}

/**
 * Deterministically maps one immutable source envelope into a canonical record.
 * The function never executes manifest text, mutates the source payload, or
 * promotes source authority. Drift, lateness, and ambiguous review state are
 * represented in the receipt rather than silently discarded.
 */
export function executeSourceMapping(
  input: ExecuteSourceMappingInput
): ExecuteSourceMappingResult {
  const { mapping, envelope } = input;
  const issues: SourceMappingIssue[] = [];
  const fieldMappings = sourceFieldMappings(mapping);
  const rawFieldMappingCount = Array.isArray(mapping.fieldMappings)
    ? mapping.fieldMappings.length
    : 0;
  const rawTargetIdentity = Array.isArray(mapping.targetIdentity)
    ? mapping.targetIdentity
    : [];
  const targetIdentity = rawTargetIdentity.length
    ? rawTargetIdentity.filter(
        (propertyRef): propertyRef is string =>
          typeof propertyRef === "string" && propertyRef.length > 0
      )
    : [];
  const driftPolicy = DRIFT_POLICIES.has(
    mapping.driftPolicy as NonNullable<OntologyPackSourceMapping["driftPolicy"]>
  )
    ? (mapping.driftPolicy as NonNullable<
        OntologyPackSourceMapping["driftPolicy"]
      >)
    : "reject";
  const lateArrivalPolicy = LATE_ARRIVAL_POLICIES.has(
    mapping.lateArrivalPolicy as NonNullable<
      OntologyPackSourceMapping["lateArrivalPolicy"]
    >
  )
    ? (mapping.lateArrivalPolicy as NonNullable<
        OntologyPackSourceMapping["lateArrivalPolicy"]
      >)
    : "reject";
  const humanCheckpoint = HUMAN_CHECKPOINTS.has(
    mapping.humanCheckpoint as NonNullable<
      OntologyPackSourceMapping["humanCheckpoint"]
    >
  )
    ? (mapping.humanCheckpoint as NonNullable<
        OntologyPackSourceMapping["humanCheckpoint"]
      >)
    : "always";
  const mappingId = typeof mapping.id === "string" ? mapping.id : "";
  const mappingVersion =
    typeof mapping.mappingVersion === "string" ? mapping.mappingVersion : "";
  const sourceSchemaVersion =
    typeof mapping.sourceSchemaVersion === "string"
      ? mapping.sourceSchemaVersion
      : "";
  const objectRef = typeof mapping.object === "string" ? mapping.object : "";

  if (fieldMappings.length === 0) {
    issues.push(
      issue(
        "source_mapping_not_executable",
        "error",
        "The mapping is descriptive or incomplete; governed execution requires at least one fully specified field mapping."
      )
    );
  }
  if (rawFieldMappingCount !== fieldMappings.length) {
    issues.push(
      issue(
        "invalid_source_field_mapping",
        "error",
        "Every executable field mapping requires a safe path, target, required flag, fixed normalizations, primitive value map, authority domain, and conflict policy."
      )
    );
  }
  if (!mappingVersion) {
    issues.push(
      issue(
        "missing_mapping_version",
        "error",
        "Governed source execution requires an explicit mapping version."
      )
    );
  }
  if (!sourceSchemaVersion) {
    issues.push(
      issue(
        "missing_source_schema_version",
        "error",
        "Governed source execution requires an explicit source schema version."
      )
    );
  }
  if (targetIdentity.length === 0) {
    issues.push(
      issue(
        "missing_target_identity_contract",
        "error",
        "Governed source execution requires at least one target identity property."
      )
    );
  }
  if (rawTargetIdentity.length !== targetIdentity.length) {
    issues.push(
      issue(
        "invalid_target_identity_contract",
        "error",
        "Every target identity reference must be a nonempty string."
      )
    );
  }
  const duplicateIdentityProperties = new Set(
    targetIdentity.filter(
      (propertyRef, index) => targetIdentity.indexOf(propertyRef) !== index
    )
  );
  for (const propertyRef of duplicateIdentityProperties) {
    issues.push(
      issue(
        "duplicate_target_identity_property",
        "error",
        `Identity property ${propertyRef} is declared more than once.`,
        null,
        propertyRef
      )
    );
  }
  if (typeof mapping.replayable !== "boolean") {
    issues.push(
      issue(
        "missing_replay_contract",
        "error",
        "Governed source execution requires an explicit replayable flag."
      )
    );
  }
  for (const [controlName, controlPath] of [
    ["idempotencyPath", mapping.idempotencyPath],
    ["eventTimePath", mapping.eventTimePath],
    ["observedTimePath", mapping.observedTimePath],
  ] as const) {
    if (
      controlPath !== undefined &&
      (!sourcePathIsSafe(controlPath) || controlPath === "$")
    ) {
      issues.push(
        issue(
          "invalid_control_source_path",
          "error",
          `${controlName} must select one explicit safe source path below the payload root.`,
          controlPath
        )
      );
    }
  }
  if (!mapping.driftPolicy || !DRIFT_POLICIES.has(mapping.driftPolicy)) {
    issues.push(
      issue(
        "missing_drift_policy",
        "error",
        "Governed source execution requires a recognized drift policy; reject is applied."
      )
    );
  }
  if (
    !mapping.lateArrivalPolicy ||
    !LATE_ARRIVAL_POLICIES.has(mapping.lateArrivalPolicy)
  ) {
    issues.push(
      issue(
        "missing_late_arrival_policy",
        "error",
        "Governed source execution requires a recognized late-arrival policy; reject is applied."
      )
    );
  }
  if (
    !mapping.humanCheckpoint ||
    !HUMAN_CHECKPOINTS.has(mapping.humanCheckpoint)
  ) {
    issues.push(
      issue(
        "missing_human_checkpoint",
        "error",
        "Governed source execution requires a recognized human checkpoint; always is applied."
      )
    );
  }

  const targetCounts = new Map<string, number>();
  for (const field of fieldMappings) {
    targetCounts.set(
      field.targetProperty,
      (targetCounts.get(field.targetProperty) ?? 0) + 1
    );
  }
  const duplicateTargets = new Set(
    [...targetCounts]
      .filter(([, count]) => count > 1)
      .map(([targetProperty]) => targetProperty)
  );
  for (const targetProperty of duplicateTargets) {
    issues.push(
      issue(
        "duplicate_target_property_mapping",
        "error",
        `More than one source field maps to ${targetProperty}; no value is selected.`,
        null,
        targetProperty
      )
    );
  }
  for (const propertyRef of targetIdentity) {
    const exactMappings = fieldMappings.filter(
      (field) => field.targetProperty === propertyRef
    );
    if (exactMappings.length !== 1) {
      issues.push(
        issue(
          "target_identity_not_exactly_mapped",
          "error",
          `Identity property ${propertyRef} requires exactly one field mapping using the same property reference.`,
          null,
          propertyRef
        )
      );
    } else if (!exactMappings[0]?.required) {
      issues.push(
        issue(
          "target_identity_mapping_not_required",
          "error",
          `Identity property ${propertyRef} must map from a required source field.`,
          exactMappings[0]?.sourcePath ?? null,
          propertyRef
        )
      );
    }
  }

  const mappingHash = semanticHash({
    ...mapping,
    fieldMappings,
    targetIdentity: [...targetIdentity].sort(compareCanonicalStrings),
  });
  const sourcePayloadHash = semanticHash(envelope.payload);

  if (
    envelope.contentHash !== undefined &&
    envelope.contentHash !== sourcePayloadHash
  ) {
    issues.push(
      issue(
        "source_content_hash_mismatch",
        "error",
        "The supplied content hash does not match the immutable source payload."
      )
    );
  }

  if (
    sourceSchemaVersion &&
    sourceSchemaVersion !== envelope.sourceSchemaVersion
  ) {
    const severity =
      driftPolicy === "reject"
        ? "error"
        : driftPolicy === "quarantine"
          ? "review"
          : "warning";
    issues.push(
      issue(
        "source_schema_version_mismatch",
        severity,
        `Expected source schema ${sourceSchemaVersion}, received ${envelope.sourceSchemaVersion}.`
      )
    );
  }

  const mappedEventTime = mapping.eventTimePath
    ? readPath(envelope.payload, mapping.eventTimePath)
    : undefined;
  const mappedObservedTime = mapping.observedTimePath
    ? readPath(envelope.payload, mapping.observedTimePath)
    : undefined;
  const effectiveEventTime = mapping.eventTimePath
    ? typeof mappedEventTime === "string"
      ? mappedEventTime
      : ""
    : envelope.eventTime;
  const effectiveObservedTime = mapping.observedTimePath
    ? typeof mappedObservedTime === "string"
      ? mappedObservedTime
      : ""
    : envelope.observedTime;

  if (asTimestamp(effectiveEventTime) === null) {
    issues.push(issue("invalid_event_time", "error", "Event time is not a valid timestamp."));
  }
  if (asTimestamp(effectiveObservedTime) === null) {
    issues.push(
      issue("invalid_observed_time", "error", "Observed time is not a valid timestamp.")
    );
  }

  const hasLatestAcceptedEventTime =
    input.latestAcceptedEventTime !== undefined &&
    input.latestAcceptedEventTime !== null;
  const latestAccepted = hasLatestAcceptedEventTime
    ? asTimestamp(input.latestAcceptedEventTime as string)
    : null;
  if (hasLatestAcceptedEventTime && latestAccepted === null) {
    issues.push(
      issue(
        "invalid_latest_accepted_event_time",
        "error",
        "The accepted event-time watermark must include an explicit UTC or numeric offset."
      )
    );
  }
  const currentEvent = asTimestamp(effectiveEventTime);
  const lateArrival = Boolean(
    latestAccepted !== null && currentEvent !== null && currentEvent < latestAccepted
  );
  if (lateArrival) {
    const severity =
      lateArrivalPolicy === "reject"
        ? "error"
        : lateArrivalPolicy === "quarantine"
          ? "review"
          : "warning";
    issues.push(
      issue(
        "late_arrival",
        severity,
        `Event time ${effectiveEventTime} precedes the accepted watermark ${input.latestAcceptedEventTime}.`
      )
    );
  }

  if (mapping.replayable === true && !mapping.idempotencyPath) {
    issues.push(
      issue(
        "missing_idempotency_path",
        "error",
        "A replayable mapping requires an explicit idempotency path."
      )
    );
  }
  const explicitIdempotencyValue = mapping.idempotencyPath
    ? readPath(envelope.payload, mapping.idempotencyPath)
    : envelope.sourceRecordKey;
  if (!isStableIdempotencyValue(explicitIdempotencyValue)) {
    issues.push(
      issue(
        "missing_idempotency_value",
        "error",
        "Governed source mappings require a nonblank, finite, stable idempotency value.",
        mapping.idempotencyPath || null
      )
    );
  }
  const idempotencyKey = semanticHash({
    sourceSystem: envelope.sourceSystem,
    sourceRecordKey: envelope.sourceRecordKey,
    mappingId,
    mappingHash,
    value: explicitIdempotencyValue ?? null,
  });
  const acceptedFieldPaths = fieldMappings.map((field) => field.sourcePath);
  const acceptedControlPaths = [
    mapping.idempotencyPath,
    mapping.eventTimePath,
    mapping.observedTimePath,
  ].filter(
    (path): path is string => typeof path === "string" && sourcePathIsSafe(path)
  );
  const unknownSourcePaths = sourceLeafPaths(envelope.payload)
    .filter(
      (path) =>
        !sourcePathCovered(path, acceptedFieldPaths, acceptedControlPaths)
    )
    .sort(compareCanonicalStrings);
  if (fieldMappings.length > 0 && unknownSourcePaths.length > 0) {
    const severity =
      driftPolicy === "reject"
        ? "error"
        : driftPolicy === "quarantine"
          ? "review"
          : "warning";
    issues.push(
      issue(
        "unmapped_source_fields",
        severity,
        `Source paths are not covered by the accepted mapping: ${unknownSourcePaths.join(
          ", "
        )}.`
      )
    );
  }

  const fields: CanonicalFieldValue[] = [];
  for (const field of fieldMappings) {
    if (duplicateTargets.has(field.targetProperty)) continue;
    const sourceValue = readPath(envelope.payload, field.sourcePath);
    if (sourceValue === undefined) {
      if (field.required) {
        issues.push(
          issue(
            "missing_required_source_field",
            "error",
            `Required source field ${field.sourcePath} is absent.`,
            field.sourcePath,
            field.targetProperty
          )
        );
      }
      continue;
    }

    const normalized = applyValueMap(
      normalizeValue(sourceValue, field.normalizations),
      field.valueMap
    );
    fields.push({
      propertyRef: field.targetProperty,
      value: cloneJson(normalized),
      conflictPolicy: field.conflictPolicy,
      provenance: {
        sourceSystem: envelope.sourceSystem,
        sourceLocator: envelope.sourceLocator,
        sourceRecordKey: envelope.sourceRecordKey,
        sourceSchemaVersion: envelope.sourceSchemaVersion,
        sourcePath: field.sourcePath,
        sourceValueHash: semanticHash(sourceValue),
        sourcePayloadHash,
        mappingId,
        mappingHash,
        eventTime: effectiveEventTime,
        observedTime: effectiveObservedTime,
        authenticationState: envelope.authenticationState,
        authorityRef: envelope.authorityRef,
        authorityDomain: field.authorityDomain || mapping.authority,
        dataClassification: envelope.dataClassification,
        purposeTags: [...envelope.purposeTags].sort(compareCanonicalStrings),
        retentionPolicy: cloneJson(envelope.retentionPolicy),
      },
    });
  }

  const byProperty = new Map(
    fields.map((field) => [field.propertyRef, field.value])
  );
  const validIdentityProperties: string[] = [];
  for (const propertyRef of targetIdentity) {
    if (!byProperty.has(propertyRef)) {
      issues.push(
        issue(
          "missing_target_identity_value",
          "error",
          `No canonical identity value was produced for ${propertyRef}.`,
          null,
          propertyRef
        )
      );
    } else if (!isUsableIdentifier(byProperty.get(propertyRef))) {
      issues.push(
        issue(
          "invalid_target_identity_value",
          "error",
          `Canonical identity value ${propertyRef} must be a nonblank string or finite number.`,
          null,
          propertyRef
        )
      );
    } else {
      validIdentityProperties.push(propertyRef);
    }
  }
  const identity = Object.fromEntries(
    validIdentityProperties
      .sort(compareCanonicalStrings)
      .map((propertyRef) => [
        propertyRef,
        cloneJson(byProperty.get(propertyRef) as JsonValue),
      ])
  );
  const canonicalRecord: FederatedCanonicalRecord = {
    objectRef,
    identity,
    fields,
  };
  const canonicalOutputHash = semanticHash(canonicalRecord);
  const priorRecords = (input.acceptedIdempotencyRecords ?? []).filter(
    (record) => record.idempotencyKey === idempotencyKey
  );
  const conflictingReplay = priorRecords.some(
    (record) =>
      record.sourcePayloadHash !== sourcePayloadHash ||
      record.canonicalOutputHash !== canonicalOutputHash
  );
  const exactReplay =
    priorRecords.length > 0 &&
    !conflictingReplay &&
    priorRecords.every(
      (record) =>
        record.sourcePayloadHash === sourcePayloadHash &&
        record.canonicalOutputHash === canonicalOutputHash
    );
  const keyOnlyReplay =
    !exactReplay &&
    !conflictingReplay &&
    new Set(input.seenIdempotencyKeys ?? []).has(idempotencyKey);
  const duplicate = exactReplay || keyOnlyReplay || conflictingReplay;
  if (conflictingReplay) {
    issues.push(
      issue(
        "conflicting_idempotency_key_reuse",
        "error",
        "The idempotency key matches prior accepted evidence, but the payload or canonical output hash changed."
      )
    );
  } else if (exactReplay) {
    issues.push(
      issue(
        "exact_duplicate_source_record",
        "warning",
        "The idempotency key, source payload hash, and canonical output hash match prior accepted evidence; no new authority is created."
      )
    );
  } else if (keyOnlyReplay) {
    issues.push(
      issue(
        "unverified_idempotency_key_reuse",
        "review",
        "A prior key was supplied without payload and output hashes, so exact replay cannot be verified."
      )
    );
  }

  const hasError = issues.some((item) => item.severity === "error");
  const hasReviewIssue = issues.some((item) => item.severity === "review");
  const policyRequiresReview =
    (lateArrival && lateArrivalPolicy === "accept_with_review") ||
    (driftPolicy === "allow_with_review" &&
      issues.some(
        (item) =>
          item.code === "source_schema_version_mismatch" ||
          item.code === "unmapped_source_fields"
      ));
  const humanReviewRequired =
    hasError ||
    hasReviewIssue ||
    policyRequiresReview ||
    humanCheckpoint === "always" ||
    (humanCheckpoint === "on_issue" && issues.length > 0) ||
    mapping.reviewStatus !== "accepted";
  const status: SourceMappingReceipt["status"] = hasError
    ? "rejected"
    : hasReviewIssue
      ? "quarantined"
      : duplicate
        ? "duplicate"
        : "mapped";
  const receiptWithoutHash = {
    receiptVersion: "t2k.source-mapping-receipt.v1" as const,
    status,
    sourceSystem: envelope.sourceSystem,
    sourceLocator: envelope.sourceLocator,
    sourceRecordKey: envelope.sourceRecordKey,
    sourceSchemaVersion: envelope.sourceSchemaVersion,
    authenticationState: envelope.authenticationState,
    authorityRef: envelope.authorityRef,
    dataClassification: envelope.dataClassification,
    purposeTags: [...envelope.purposeTags].sort(compareCanonicalStrings),
    retentionPolicy: cloneJson(envelope.retentionPolicy),
    mappingId,
    mappingVersion,
    mappingHash,
    sourcePayloadHash,
    canonicalOutputHash,
    idempotencyKey,
    eventTime: effectiveEventTime,
    observedTime: effectiveObservedTime,
    lateArrival,
    duplicate,
    humanReviewRequired,
    driftPolicy,
    lateArrivalPolicy,
    issues: [...issues].sort(
      (left, right) =>
        compareCanonicalStrings(left.code, right.code) ||
        compareCanonicalStrings(left.sourcePath ?? "", right.sourcePath ?? "") ||
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    ),
  };

  return {
    canonicalRecord,
    receipt: {
      ...receiptWithoutHash,
      receiptHash: semanticHash(receiptWithoutHash),
    },
  };
}

export interface EntityResolutionCandidate {
  entityKey: string;
  identifiers: Record<string, JsonValue>;
}

export interface EntityResolutionRule {
  identifier: string;
  weight: number;
  requiredForAutomaticMatch?: boolean;
  caseInsensitive?: boolean;
}

export interface EntityResolutionInput {
  sourceEntityKey: string;
  identifiers: Record<string, JsonValue>;
  candidates: EntityResolutionCandidate[];
  rules: EntityResolutionRule[];
  automaticMatchThreshold?: number;
  reviewThreshold?: number;
  ambiguityMargin?: number;
}

export interface EntityResolutionCandidateScore {
  entityKey: string;
  score: number;
  matchedIdentifiers: string[];
  mismatchedIdentifiers: string[];
  requiredMatchesSatisfied: boolean;
}

export interface EntityResolutionDecision {
  status: "matched" | "new_entity" | "needs_review";
  sourceEntityKey: string;
  targetEntityKey: string | null;
  humanReviewRequired: boolean;
  reversible: true;
  candidates: EntityResolutionCandidateScore[];
  inputHash: string;
  rulesHash: string;
  invalidRuleCount: number;
  thresholds: {
    automaticMatch: number;
    review: number;
    ambiguityMargin: number;
  };
  rationale: string;
  decisionHash: string;
}

function comparableValue(value: JsonValue, caseInsensitive: boolean) {
  const normalized =
    caseInsensitive && typeof value === "string"
      ? value.trim().toLowerCase()
      : value;
  return canonicalJson(normalized);
}

function isUsableIdentifier(
  value: JsonValue | undefined
): value is string | number {
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validUnitThreshold(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : fallback;
}

function validEntityResolutionRule(rule: EntityResolutionRule) {
  return (
    typeof rule.identifier === "string" &&
    rule.identifier.trim().length > 0 &&
    Number.isFinite(rule.weight) &&
    rule.weight > 0 &&
    (rule.requiredForAutomaticMatch === undefined ||
      typeof rule.requiredForAutomaticMatch === "boolean") &&
    (rule.caseInsensitive === undefined ||
      typeof rule.caseInsensitive === "boolean")
  );
}

/**
 * Produces a reversible entity-link proposal. It never mutates or merges the
 * supplied entities; ambiguous candidates fail to a human-review state.
 */
export function resolveEntityCandidates(
  input: EntityResolutionInput
): EntityResolutionDecision {
  const normalizedInputRules = [...input.rules].sort(
    (left, right) =>
      compareCanonicalStrings(
        typeof left.identifier === "string" ? left.identifier : "",
        typeof right.identifier === "string" ? right.identifier : ""
      ) || compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const invalidRuleCount = normalizedInputRules.filter(
    (rule) => !validEntityResolutionRule(rule)
  ).length;
  const rules = normalizedInputRules
    .filter(validEntityResolutionRule)
    .sort(
      (left, right) =>
        compareCanonicalStrings(left.identifier, right.identifier) ||
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    );
  const totalWeight = rules.reduce((sum, rule) => sum + rule.weight, 0);
  const candidates = input.candidates
    .map((candidate) => {
      const matchedIdentifiers: string[] = [];
      const mismatchedIdentifiers: string[] = [];
      let matchedWeight = 0;
      let requiredMatchesSatisfied = true;

      for (const rule of rules) {
        const sourceValue = input.identifiers[rule.identifier];
        const candidateValue = candidate.identifiers[rule.identifier];
        const matched =
          isUsableIdentifier(sourceValue) &&
          isUsableIdentifier(candidateValue) &&
          comparableValue(sourceValue, Boolean(rule.caseInsensitive)) ===
            comparableValue(candidateValue, Boolean(rule.caseInsensitive));
        if (matched) {
          matchedIdentifiers.push(rule.identifier);
          matchedWeight += rule.weight;
        } else {
          mismatchedIdentifiers.push(rule.identifier);
          if (rule.requiredForAutomaticMatch) requiredMatchesSatisfied = false;
        }
      }

      const candidateKeyValid =
        typeof candidate.entityKey === "string" &&
        candidate.entityKey.trim().length > 0;
      return {
        entityKey: candidate.entityKey,
        score:
          candidateKeyValid && totalWeight > 0
            ? matchedWeight / totalWeight
            : 0,
        matchedIdentifiers,
        mismatchedIdentifiers,
        requiredMatchesSatisfied:
          candidateKeyValid && requiredMatchesSatisfied,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        compareCanonicalStrings(left.entityKey, right.entityKey) ||
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    );

  const automaticThreshold = validUnitThreshold(
    input.automaticMatchThreshold,
    0.9
  );
  const requestedReviewThreshold = validUnitThreshold(input.reviewThreshold, 0.5);
  const reviewThreshold =
    requestedReviewThreshold <= automaticThreshold
      ? requestedReviewThreshold
      : Math.min(0.5, automaticThreshold);
  const ambiguityMargin =
    input.ambiguityMargin !== undefined &&
    Number.isFinite(input.ambiguityMargin) &&
    input.ambiguityMargin > 0 &&
    input.ambiguityMargin <= 1
      ? input.ambiguityMargin
      : 0.1;
  const thresholds = {
    automaticMatch: automaticThreshold,
    review: reviewThreshold,
    ambiguityMargin,
  };
  const normalizedCandidateEvidence = [...input.candidates].sort(
    (left, right) =>
      compareCanonicalStrings(left.entityKey, right.entityKey) ||
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const rulesHash = semanticHash(normalizedInputRules);
  const inputHash = semanticHash({
    sourceEntityKey: input.sourceEntityKey,
    identifiers: input.identifiers,
    candidates: normalizedCandidateEvidence,
    rules: normalizedInputRules,
    thresholds,
  });
  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  const unambiguous = Boolean(
    best &&
      (!runnerUp ||
        (best.score > runnerUp.score &&
          best.score - runnerUp.score >= ambiguityMargin))
  );

  let status: EntityResolutionDecision["status"] = "new_entity";
  let targetEntityKey: string | null = null;
  let rationale = "No candidate met the human-review threshold; propose a new entity.";
  if (
    best &&
    invalidRuleCount === 0 &&
    typeof input.sourceEntityKey === "string" &&
    input.sourceEntityKey.trim().length > 0 &&
    best.score >= automaticThreshold &&
    best.requiredMatchesSatisfied &&
    unambiguous
  ) {
    status = "matched";
    targetEntityKey = best.entityKey;
    rationale =
      "One candidate met the automatic threshold, all required identifiers, and the ambiguity margin.";
  } else if (best && best.score >= reviewThreshold) {
    status = "needs_review";
    targetEntityKey = best.entityKey;
    rationale = invalidRuleCount > 0
      ? "At least one entity-resolution rule is invalid; a candidate met the review threshold, but automatic matching is prohibited."
      : "At least one candidate met the review threshold, but automatic merge conditions were not satisfied.";
  }

  const decisionWithoutHash = {
    status,
    sourceEntityKey: input.sourceEntityKey,
    targetEntityKey,
    humanReviewRequired: status !== "matched",
    reversible: true as const,
    candidates,
    inputHash,
    rulesHash,
    invalidRuleCount,
    thresholds,
    rationale,
  };
  return {
    ...decisionWithoutHash,
    decisionHash: semanticHash(decisionWithoutHash),
  };
}
