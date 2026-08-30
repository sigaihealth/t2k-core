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

export interface CanonicalAuthorityPolicy {
  policyId: string;
  policyVersion: string;
  prioritiesByDomain: Record<string, readonly string[]>;
}

export interface ReconcileCanonicalRecordsInput {
  results: readonly ExecuteSourceMappingResult[];
  authorityPolicy: CanonicalAuthorityPolicy;
}

export interface CanonicalReconciliationIssue {
  code: string;
  severity: "error" | "review" | "warning";
  message: string;
  propertyRef: string | null;
  receiptHash: string | null;
}

export interface CanonicalReconciliationEvidence {
  receiptHash: string;
  receiptAuthorityRef: string;
  provenance: CanonicalFieldProvenance;
}

export interface CanonicalReconciliationCandidate {
  value: JsonValue;
  valueHash: string;
  evidence: CanonicalReconciliationEvidence[];
}

export interface CanonicalReconciledField {
  propertyRef: string;
  conflictPolicy: OntologyPackSourceFieldMapping["conflictPolicy"] | null;
  status: "selected" | "preserved" | "needs_review";
  resolution:
    | "single_value"
    | "preserve_all"
    | "preferred_authority"
    | "unresolved";
  selectedValue: JsonValue | null;
  selectedValueHash: string | null;
  candidates: CanonicalReconciliationCandidate[];
}

export interface CanonicalReconciliationProposal {
  proposalVersion: "t2k.canonical-reconciliation-proposal.v1";
  status: "proposed" | "needs_review" | "rejected";
  objectRef: string;
  identity: Record<string, JsonValue>;
  fields: CanonicalReconciledField[];
  policyId: string;
  policyVersion: string;
  policyHash: string;
  inputReceiptHashes: string[];
  includedReceiptHashes: string[];
  inputHash: string;
  issues: CanonicalReconciliationIssue[];
  humanReviewRequired: boolean;
  nonMutating: true;
  alternativesPreserved: true;
  proposalHash: string;
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

function normalizeValue(
  value: JsonValue,
  normalizations: OntologyPackSourceNormalization[]
):
  | { valid: true; value: JsonValue }
  | { valid: false; normalization: OntologyPackSourceNormalization } {
  let current = value;
  for (const normalization of normalizations) {
    switch (normalization) {
      case "trim":
        current = typeof current === "string" ? current.trim() : current;
        break;
      case "collapse_whitespace":
        current = typeof current === "string"
          ? current.replace(/\s+/g, " ").trim()
          : current;
        break;
      case "lowercase":
        current =
          typeof current === "string" ? current.toLowerCase() : current;
        break;
      case "uppercase":
        current =
          typeof current === "string" ? current.toUpperCase() : current;
        break;
      case "digits_only":
        current = typeof current === "string"
          ? current.replace(/[^0-9]/g, "")
          : current;
        break;
      case "iso_date": {
        if (typeof current !== "string") {
          return { valid: false, normalization };
        }
        const timestamp = parseDateOnlyUtc(current) ?? asTimestamp(current);
        if (timestamp === null || !Number.isFinite(timestamp)) {
          return { valid: false, normalization };
        }
        current = new Date(timestamp).toISOString();
        break;
      }
    }
  }
  return { valid: true, value: current };
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
  const rawInput: unknown = input;
  const inputRecord = isRecord(rawInput) ? rawInput : {};
  const rawMapping = inputRecord.mapping;
  const mapping = (isRecord(rawMapping) ? rawMapping : {}) as unknown as
    OntologyPackSourceMapping;
  const rawEnvelope = inputRecord.envelope;
  const envelopeRecord = isRecord(rawEnvelope) ? rawEnvelope : {};
  const rawPayload = envelopeRecord.payload;
  const payloadValid = isJsonObjectShape(rawPayload);
  const payload: JsonObject = payloadValid ? rawPayload : {};
  const rawPurposeTags = envelopeRecord.purposeTags;
  const purposeTagsValid =
    Array.isArray(rawPurposeTags) &&
    rawPurposeTags.every(
      (tag) => typeof tag === "string" && tag.trim().length > 0
    );
  const purposeTags: string[] = purposeTagsValid
    ? rawPurposeTags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const rawRetentionPolicy = envelopeRecord.retentionPolicy;
  const retentionPolicyValid = isJsonObjectShape(rawRetentionPolicy);
  const retentionPolicy: JsonObject = retentionPolicyValid
    ? rawRetentionPolicy
    : {};
  const authenticationStateValid = SOURCE_AUTHENTICATION_STATES.includes(
    envelopeRecord.authenticationState as SourceAuthenticationState
  );
  const envelopeStringFields = [
    "sourceSystem",
    "sourceLocator",
    "sourceRecordKey",
    "sourceSchemaVersion",
    "eventTime",
    "observedTime",
    "authorityRef",
    "dataClassification",
  ] as const;
  const envelopeStringsValid = envelopeStringFields.every(
    (field) =>
      typeof envelopeRecord[field] === "string" &&
      envelopeRecord[field].trim().length > 0
  );
  const contentHashValid =
    envelopeRecord.contentHash === undefined ||
    (typeof envelopeRecord.contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(envelopeRecord.contentHash));
  const envelope: FederatedSourceEnvelope = {
    sourceSystem:
      typeof envelopeRecord.sourceSystem === "string"
        ? envelopeRecord.sourceSystem
        : "",
    sourceLocator:
      typeof envelopeRecord.sourceLocator === "string"
        ? envelopeRecord.sourceLocator
        : "",
    sourceRecordKey:
      typeof envelopeRecord.sourceRecordKey === "string"
        ? envelopeRecord.sourceRecordKey
        : "",
    sourceSchemaVersion:
      typeof envelopeRecord.sourceSchemaVersion === "string"
        ? envelopeRecord.sourceSchemaVersion
        : "",
    payload,
    eventTime:
      typeof envelopeRecord.eventTime === "string"
        ? envelopeRecord.eventTime
        : "",
    observedTime:
      typeof envelopeRecord.observedTime === "string"
        ? envelopeRecord.observedTime
        : "",
    authenticationState: authenticationStateValid
      ? (envelopeRecord.authenticationState as SourceAuthenticationState)
      : "unknown",
    authorityRef:
      typeof envelopeRecord.authorityRef === "string"
        ? envelopeRecord.authorityRef
        : "",
    dataClassification:
      typeof envelopeRecord.dataClassification === "string"
        ? envelopeRecord.dataClassification
        : "",
    purposeTags: [...purposeTags],
    retentionPolicy,
    ...(typeof envelopeRecord.contentHash === "string"
      ? { contentHash: envelopeRecord.contentHash }
      : {}),
  };
  const issues: SourceMappingIssue[] = [];
  if (!isRecord(rawEnvelope) || !envelopeStringsValid || !payloadValid) {
    issues.push(
      issue(
        "invalid_source_envelope",
        "error",
        "The source envelope requires nonblank identity, locator, schema, time, authority, and classification fields plus a JSON object payload."
      )
    );
  }
  if (!authenticationStateValid) {
    issues.push(
      issue(
        "invalid_source_authentication_state",
        "error",
        "The source authentication state must be authenticated, unauthenticated, system_asserted, or unknown."
      )
    );
  }
  if (!purposeTagsValid) {
    issues.push(
      issue(
        "invalid_source_purpose_tags",
        "error",
        "Source purpose tags must be an array containing only nonblank strings."
      )
    );
  }
  if (!retentionPolicyValid) {
    issues.push(
      issue(
        "invalid_source_retention_policy",
        "error",
        "The source retention policy must be a JSON object."
      )
    );
  }
  if (!contentHashValid) {
    issues.push(
      issue(
        "invalid_source_content_hash",
        "error",
        "A supplied source content hash must be a lowercase SHA-256 digest."
      )
    );
  }
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
  const usableControlPaths = new Map<string, string>();
  for (const [controlName, controlPath] of [
    ["idempotencyPath", mapping.idempotencyPath],
    ["eventTimePath", mapping.eventTimePath],
    ["observedTimePath", mapping.observedTimePath],
  ] as const) {
    if (
      controlPath !== undefined &&
      (typeof controlPath !== "string" ||
        !sourcePathIsSafe(controlPath) ||
        controlPath === "$")
    ) {
      issues.push(
        issue(
          "invalid_control_source_path",
          "error",
          `${controlName} must select one explicit safe source path below the payload root.`,
          typeof controlPath === "string" ? controlPath : null
        )
      );
    } else if (typeof controlPath === "string") {
      usableControlPaths.set(controlName, controlPath);
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

  const idempotencyPath = usableControlPaths.get("idempotencyPath");
  const eventTimePath = usableControlPaths.get("eventTimePath");
  const observedTimePath = usableControlPaths.get("observedTimePath");
  const mappedEventTime = eventTimePath
    ? readPath(envelope.payload, eventTimePath)
    : undefined;
  const mappedObservedTime = observedTimePath
    ? readPath(envelope.payload, observedTimePath)
    : undefined;
  const effectiveEventTime = eventTimePath
    ? typeof mappedEventTime === "string"
      ? mappedEventTime
      : ""
    : envelope.eventTime;
  const effectiveObservedTime = observedTimePath
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

  const latestAcceptedEventTime = inputRecord.latestAcceptedEventTime;
  const hasLatestAcceptedEventTime =
    latestAcceptedEventTime !== undefined && latestAcceptedEventTime !== null;
  const latestAccepted = hasLatestAcceptedEventTime
    ? typeof latestAcceptedEventTime === "string"
      ? asTimestamp(latestAcceptedEventTime)
      : null
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
        `Event time ${effectiveEventTime} precedes the accepted watermark ${String(
          latestAcceptedEventTime
        )}.`
      )
    );
  }

  if (mapping.replayable === true && !idempotencyPath) {
    issues.push(
      issue(
        "missing_idempotency_path",
        "error",
        "A replayable mapping requires an explicit idempotency path."
      )
    );
  }
  const explicitIdempotencyValue = idempotencyPath
    ? readPath(envelope.payload, idempotencyPath)
    : envelope.sourceRecordKey;
  if (!isStableIdempotencyValue(explicitIdempotencyValue)) {
    issues.push(
      issue(
        "missing_idempotency_value",
        "error",
        "Governed source mappings require a nonblank, finite, stable idempotency value.",
        idempotencyPath ?? null
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
    idempotencyPath,
    eventTimePath,
    observedTimePath,
  ].filter((path): path is string => typeof path === "string");
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

    const normalization = normalizeValue(sourceValue, field.normalizations);
    if (!normalization.valid) {
      issues.push(
        issue(
          "invalid_iso_date_value",
          "error",
          `Source field ${field.sourcePath} is not a valid calendar date or explicit-offset timestamp required by iso_date normalization.`,
          field.sourcePath,
          field.targetProperty
        )
      );
      continue;
    }
    const normalized = applyValueMap(normalization.value, field.valueMap);
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
  const rawAcceptedIdempotencyRecords = inputRecord.acceptedIdempotencyRecords;
  const acceptedIdempotencyRecords = Array.isArray(
    rawAcceptedIdempotencyRecords
  )
    ? rawAcceptedIdempotencyRecords.filter(
        (record): record is AcceptedIdempotencyRecord =>
          isRecord(record) &&
          typeof record.idempotencyKey === "string" &&
          SHA256_HEX.test(record.idempotencyKey) &&
          typeof record.sourcePayloadHash === "string" &&
          SHA256_HEX.test(record.sourcePayloadHash) &&
          typeof record.canonicalOutputHash === "string" &&
          SHA256_HEX.test(record.canonicalOutputHash)
      )
    : [];
  if (
    rawAcceptedIdempotencyRecords !== undefined &&
    (!Array.isArray(rawAcceptedIdempotencyRecords) ||
      acceptedIdempotencyRecords.length !==
        rawAcceptedIdempotencyRecords.length)
  ) {
    issues.push(
      issue(
        "invalid_accepted_idempotency_evidence",
        "error",
        "Accepted idempotency evidence must contain complete lowercase SHA-256 key, payload, and output hashes."
      )
    );
  }
  const rawSeenIdempotencyKeys = inputRecord.seenIdempotencyKeys;
  const seenIdempotencyKeys = Array.isArray(rawSeenIdempotencyKeys)
    ? rawSeenIdempotencyKeys.filter(
        (value): value is string =>
          typeof value === "string" && SHA256_HEX.test(value)
      )
    : [];
  if (
    rawSeenIdempotencyKeys !== undefined &&
    (!Array.isArray(rawSeenIdempotencyKeys) ||
      seenIdempotencyKeys.length !== rawSeenIdempotencyKeys.length)
  ) {
    issues.push(
      issue(
        "invalid_seen_idempotency_keys",
        "error",
        "Seen idempotency keys must be lowercase SHA-256 digests."
      )
    );
  }
  const priorRecords = acceptedIdempotencyRecords.filter(
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
    new Set(seenIdempotencyKeys).has(idempotencyKey);
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

function reconciliationIssue(
  code: string,
  severity: CanonicalReconciliationIssue["severity"],
  message: string,
  propertyRef: string | null = null,
  receiptHash: string | null = null
): CanonicalReconciliationIssue {
  return { code, severity, message, propertyRef, receiptHash };
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const RECONCILABLE_SOURCE_STATUSES = new Set<SourceMappingReceipt["status"]>([
  "mapped",
  "quarantined",
  "rejected",
  "duplicate",
]);

function isSerializableJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isSerializableJsonValue);
  return (
    isRecord(value) && Object.values(value).every(isSerializableJsonValue)
  );
}

function isJsonObjectShape(value: unknown): value is JsonObject {
  return (
    isRecord(value) && Object.values(value).every(isSerializableJsonValue)
  );
}

function isStringArrayShape(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSourceIssueShape(value: unknown): value is SourceMappingIssue {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    ["error", "review", "warning"].includes(String(value.severity)) &&
    typeof value.message === "string" &&
    (value.sourcePath === null || typeof value.sourcePath === "string") &&
    (value.targetProperty === null || typeof value.targetProperty === "string")
  );
}

function isSourceReceiptShape(value: unknown): value is SourceMappingReceipt {
  if (!isRecord(value)) return false;
  const stringFields = [
    "sourceSystem",
    "sourceLocator",
    "sourceRecordKey",
    "sourceSchemaVersion",
    "authorityRef",
    "dataClassification",
    "mappingId",
    "mappingVersion",
    "eventTime",
    "observedTime",
  ];
  const hashFields = [
    "mappingHash",
    "sourcePayloadHash",
    "canonicalOutputHash",
    "idempotencyKey",
    "receiptHash",
  ];
  return (
    value.receiptVersion === "t2k.source-mapping-receipt.v1" &&
    RECONCILABLE_SOURCE_STATUSES.has(
      value.status as SourceMappingReceipt["status"]
    ) &&
    stringFields.every((field) => typeof value[field] === "string") &&
    hashFields.every(
      (field) =>
        typeof value[field] === "string" && SHA256_HEX.test(value[field])
    ) &&
    SOURCE_AUTHENTICATION_STATES.includes(
      value.authenticationState as SourceAuthenticationState
    ) &&
    isStringArrayShape(value.purposeTags) &&
    isJsonObjectShape(value.retentionPolicy) &&
    typeof value.lateArrival === "boolean" &&
    typeof value.duplicate === "boolean" &&
    typeof value.humanReviewRequired === "boolean" &&
    DRIFT_POLICIES.has(
      value.driftPolicy as NonNullable<OntologyPackSourceMapping["driftPolicy"]>
    ) &&
    LATE_ARRIVAL_POLICIES.has(
      value.lateArrivalPolicy as NonNullable<
        OntologyPackSourceMapping["lateArrivalPolicy"]
      >
    ) &&
    Array.isArray(value.issues) &&
    value.issues.every(isSourceIssueShape)
  );
}

function isCanonicalProvenanceShape(
  value: unknown
): value is CanonicalFieldProvenance {
  if (!isRecord(value)) return false;
  const stringFields = [
    "sourceSystem",
    "sourceLocator",
    "sourceRecordKey",
    "sourceSchemaVersion",
    "sourcePath",
    "mappingId",
    "eventTime",
    "observedTime",
    "authorityRef",
    "authorityDomain",
    "dataClassification",
  ];
  return (
    stringFields.every((field) => typeof value[field] === "string") &&
    ["sourceValueHash", "sourcePayloadHash", "mappingHash"].every(
      (field) =>
        typeof value[field] === "string" && SHA256_HEX.test(value[field])
    ) &&
    SOURCE_AUTHENTICATION_STATES.includes(
      value.authenticationState as SourceAuthenticationState
    ) &&
    isStringArrayShape(value.purposeTags) &&
    isJsonObjectShape(value.retentionPolicy)
  );
}

function isCanonicalFieldShape(value: unknown): value is CanonicalFieldValue {
  return (
    isRecord(value) &&
    typeof value.propertyRef === "string" &&
    value.propertyRef.trim().length > 0 &&
    isSerializableJsonValue(value.value) &&
    CONFLICT_POLICIES.has(
      value.conflictPolicy as OntologyPackSourceFieldMapping["conflictPolicy"]
    ) &&
    isCanonicalProvenanceShape(value.provenance)
  );
}

function isCanonicalRecordShape(value: unknown): value is FederatedCanonicalRecord {
  return (
    isRecord(value) &&
    typeof value.objectRef === "string" &&
    isRecord(value.identity) &&
    Object.keys(value.identity).every((key) => key.trim().length > 0) &&
    Object.values(value.identity).every(isSerializableJsonValue) &&
    Array.isArray(value.fields) &&
    value.fields.every(isCanonicalFieldShape)
  );
}

function sortedSemanticStrings(values: readonly string[]) {
  return [...values].sort(compareCanonicalStrings);
}

function provenanceMatchesReceipt(
  provenance: CanonicalFieldProvenance,
  receipt: SourceMappingReceipt
) {
  return (
    provenance.sourceSystem === receipt.sourceSystem &&
    provenance.sourceLocator === receipt.sourceLocator &&
    provenance.sourceRecordKey === receipt.sourceRecordKey &&
    provenance.sourceSchemaVersion === receipt.sourceSchemaVersion &&
    provenance.sourcePayloadHash === receipt.sourcePayloadHash &&
    provenance.mappingId === receipt.mappingId &&
    provenance.mappingHash === receipt.mappingHash &&
    provenance.eventTime === receipt.eventTime &&
    provenance.observedTime === receipt.observedTime &&
    provenance.authenticationState === receipt.authenticationState &&
    provenance.authorityRef === receipt.authorityRef &&
    provenance.dataClassification === receipt.dataClassification &&
    semanticHash(sortedSemanticStrings(provenance.purposeTags)) ===
      semanticHash(sortedSemanticStrings(receipt.purposeTags)) &&
    semanticHash(provenance.retentionPolicy) ===
      semanticHash(receipt.retentionPolicy)
  );
}

function unknownReceiptHash(value: unknown) {
  if (!isRecord(value) || !isRecord(value.receipt)) return null;
  return typeof value.receipt.receiptHash === "string"
    ? value.receipt.receiptHash
    : null;
}

/**
 * Produces a deterministic, non-mutating proposal from mapped source evidence.
 * It never mutates its inputs, promotes a value to accepted truth, or infers
 * authority from source order, authentication state, or event recency.
 */
export function reconcileCanonicalRecords(
  input: ReconcileCanonicalRecordsInput
): CanonicalReconciliationProposal {
  const issues: CanonicalReconciliationIssue[] = [];
  const rawInput: unknown = input;
  const inputRecord = isRecord(rawInput) ? rawInput : {};
  if (!isRecord(rawInput)) {
    issues.push(
      reconciliationIssue(
        "malformed_reconciliation_input",
        "error",
        "Reconciliation input must be a serialized object."
      )
    );
  }
  const rawPolicy = inputRecord.authorityPolicy;
  const policyRecord = isRecord(rawPolicy) ? rawPolicy : {};
  const policyId =
    typeof policyRecord.policyId === "string"
      ? policyRecord.policyId
      : "";
  const policyVersion =
    typeof policyRecord.policyVersion === "string"
      ? policyRecord.policyVersion
      : "";
  const rawPriorities = policyRecord.prioritiesByDomain;
  const policyHash = semanticHash(rawPolicy);
  const prioritiesByDomain = new Map<string, string[]>();

  if (!policyId.trim() || !policyVersion.trim() || !isRecord(rawPriorities)) {
    issues.push(
      reconciliationIssue(
        "invalid_authority_policy",
        "error",
        "Reconciliation requires a nonblank policy ID, policy version, and priorities-by-domain object."
      )
    );
  } else {
    for (const [domain, priorities] of Object.entries(rawPriorities).sort(
      ([left], [right]) => compareCanonicalStrings(left, right)
    )) {
      const validPriorities =
        domain.trim().length > 0 &&
        Array.isArray(priorities) &&
        priorities.length > 0 &&
        priorities.every(
          (authorityRef) =>
            typeof authorityRef === "string" && authorityRef.trim().length > 0
        ) &&
        new Set(priorities).size === priorities.length;
      if (!validPriorities) {
        issues.push(
          reconciliationIssue(
            "invalid_authority_priority",
            "error",
            `Authority priorities for ${domain || "<missing>"} must be a nonempty list of unique, nonblank authority references.`
          )
        );
      } else {
        prioritiesByDomain.set(domain, [...priorities] as string[]);
      }
    }
  }

  const rawResults = inputRecord.results;
  if (!Array.isArray(rawResults)) {
    issues.push(
      reconciliationIssue(
        "malformed_reconciliation_results",
        "error",
        "Reconciliation results must be a serialized array."
      )
    );
  }
  const normalizedResults = (Array.isArray(rawResults) ? [...rawResults] : []).sort(
    (left, right) =>
      compareCanonicalStrings(
        unknownReceiptHash(left) ?? "",
        unknownReceiptHash(right) ?? ""
      ) || compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const inputHash = semanticHash(
    Array.isArray(rawResults) ? normalizedResults : rawResults
  );
  const inputReceiptHashes = normalizedResults
    .map((result) => unknownReceiptHash(result) ?? "")
    .sort(compareCanonicalStrings);
  const includedResults: ExecuteSourceMappingResult[] = [];
  const includedReceiptHashes = new Set<string>();

  for (const rawResult of normalizedResults) {
    const candidateReceiptHash = unknownReceiptHash(rawResult);
    if (!isRecord(rawResult)) {
      issues.push(
        reconciliationIssue(
          "malformed_source_result",
          "error",
          "Each reconciliation result must be a serialized object.",
          null,
          candidateReceiptHash
        )
      );
      continue;
    }
    if (!isSourceReceiptShape(rawResult.receipt)) {
      issues.push(
        reconciliationIssue(
          "malformed_source_receipt",
          "error",
          "A reconciliation result contains a malformed source receipt.",
          null,
          candidateReceiptHash
        )
      );
      continue;
    }
    if (!isCanonicalRecordShape(rawResult.canonicalRecord)) {
      issues.push(
        reconciliationIssue(
          "malformed_canonical_record",
          "error",
          "A reconciliation result contains a malformed canonical record or field.",
          null,
          candidateReceiptHash
        )
      );
      continue;
    }
    const result: ExecuteSourceMappingResult = {
      receipt: rawResult.receipt,
      canonicalRecord: rawResult.canonicalRecord,
    };
    const { receiptHash, ...receiptWithoutHash } = result.receipt;
    if (semanticHash(receiptWithoutHash) !== receiptHash) {
      issues.push(
        reconciliationIssue(
          "invalid_source_receipt_hash",
          "error",
          "A source receipt hash does not match its receipt body; the input is excluded.",
          null,
          receiptHash
        )
      );
      continue;
    }
    if (
      semanticHash(result.canonicalRecord) !== result.receipt.canonicalOutputHash
    ) {
      issues.push(
        reconciliationIssue(
          "invalid_canonical_output_hash",
          "error",
          "A canonical record does not match the output hash in its source receipt; the input is excluded.",
          null,
          receiptHash
        )
      );
      continue;
    }
    const provenanceMismatches = result.canonicalRecord.fields
      .filter(
        (field) => !provenanceMatchesReceipt(field.provenance, result.receipt)
      )
      .sort(
        (left, right) =>
          compareCanonicalStrings(left.propertyRef, right.propertyRef) ||
          compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
      );
    if (provenanceMismatches.length > 0) {
      for (const field of provenanceMismatches) {
        issues.push(
          reconciliationIssue(
            "source_field_provenance_mismatch",
            "error",
            `Field provenance for ${field.propertyRef} does not match its enclosing source receipt.`,
            field.propertyRef,
            receiptHash
          )
        );
      }
      continue;
    }
    if (result.receipt.status === "duplicate") {
      issues.push(
        reconciliationIssue(
          "duplicate_source_evidence_excluded",
          "warning",
          "Exact duplicate source evidence is excluded from the reconciliation proposal.",
          null,
          receiptHash
        )
      );
      continue;
    }
    if (result.receipt.status !== "mapped") {
      issues.push(
        reconciliationIssue(
          "unaccepted_source_evidence_excluded",
          "review",
          `Source evidence with status ${result.receipt.status} cannot win reconciliation and is excluded.`,
          null,
          receiptHash
        )
      );
      continue;
    }
    const identityEntries = Object.entries(result.canonicalRecord.identity).sort(
      ([left], [right]) => compareCanonicalStrings(left, right)
    );
    let identityContractValid = true;
    const fieldCounts = new Map<string, number>();
    for (const field of result.canonicalRecord.fields) {
      fieldCounts.set(
        field.propertyRef,
        (fieldCounts.get(field.propertyRef) ?? 0) + 1
      );
    }
    for (const [propertyRef, count] of [...fieldCounts.entries()].sort(
      ([left], [right]) => compareCanonicalStrings(left, right)
    )) {
      if (count <= 1) continue;
      identityContractValid = false;
      issues.push(
        reconciliationIssue(
          "duplicate_canonical_field",
          "error",
          `Canonical property ${propertyRef} appears more than once in one source result.`,
          propertyRef,
          receiptHash
        )
      );
    }
    if (
      identityEntries.length === 0 ||
      identityEntries.some(([, value]) => !isUsableIdentifier(value))
    ) {
      identityContractValid = false;
      issues.push(
        reconciliationIssue(
          "invalid_canonical_identity",
          "error",
          "Mapped source evidence must contain nonblank string or finite-number canonical identity values.",
          null,
          receiptHash
        )
      );
    }
    for (const [propertyRef, identityValue] of identityEntries) {
      const identityFields = result.canonicalRecord.fields.filter(
        (field) => field.propertyRef === propertyRef
      );
      if (identityFields.length === 0) {
        identityContractValid = false;
        issues.push(
          reconciliationIssue(
            "missing_canonical_identity_field",
            "error",
            `Canonical identity ${propertyRef} has no corresponding field evidence.`,
            propertyRef,
            receiptHash
          )
        );
      } else if (identityFields.length > 1) {
        identityContractValid = false;
        issues.push(
          reconciliationIssue(
            "duplicate_canonical_identity_field",
            "error",
            `Canonical identity ${propertyRef} has more than one corresponding field.`,
            propertyRef,
            receiptHash
          )
        );
      } else if (
        canonicalJson(identityFields[0].value) !== canonicalJson(identityValue)
      ) {
        identityContractValid = false;
        issues.push(
          reconciliationIssue(
            "contradictory_canonical_identity_field",
            "error",
            `Canonical identity ${propertyRef} contradicts its corresponding field value.`,
            propertyRef,
            receiptHash
          )
        );
      }
    }
    if (!identityContractValid) continue;
    if (includedReceiptHashes.has(receiptHash)) {
      issues.push(
        reconciliationIssue(
          "repeated_input_receipt_excluded",
          "warning",
          "The same mapped receipt was supplied more than once; repeated evidence is excluded.",
          null,
          receiptHash
        )
      );
      continue;
    }
    includedReceiptHashes.add(receiptHash);
    includedResults.push(result);
    if (result.receipt.humanReviewRequired) {
      issues.push(
        reconciliationIssue(
          "mapped_source_evidence_requires_review",
          "review",
          "Mapped source evidence retains an upstream human-review obligation.",
          null,
          receiptHash
        )
      );
    }
  }

  let objectRef = includedResults[0]?.canonicalRecord.objectRef ?? "";
  let identity: Record<string, JsonValue> = includedResults[0]
    ? cloneJson(includedResults[0].canonicalRecord.identity)
    : {};
  let objectMismatch = false;
  let identityMismatch = false;

  if (includedResults.length === 0) {
    issues.push(
      reconciliationIssue(
        "no_mapped_source_evidence",
        "error",
        "At least one verified mapped source result is required for reconciliation."
      )
    );
  } else {
    if (!objectRef.trim()) {
      issues.push(
        reconciliationIssue(
          "invalid_canonical_object",
          "error",
          "Mapped source evidence must identify a nonblank canonical object."
        )
      );
    }
    if (Object.keys(identity).length === 0) {
      issues.push(
        reconciliationIssue(
          "invalid_canonical_identity",
          "error",
          "Mapped source evidence must contain a canonical identity."
        )
      );
    }
    const identityJson = canonicalJson(identity);
    for (const result of includedResults.slice(1)) {
      if (result.canonicalRecord.objectRef !== objectRef) {
        objectMismatch = true;
        issues.push(
          reconciliationIssue(
            "canonical_object_mismatch",
            "error",
            "Mapped source evidence targets different canonical objects and cannot be reconciled together.",
            null,
            result.receipt.receiptHash
          )
        );
      }
      if (canonicalJson(result.canonicalRecord.identity) !== identityJson) {
        identityMismatch = true;
        issues.push(
          reconciliationIssue(
            "canonical_identity_mismatch",
            "error",
            "Mapped source evidence has different canonical identities and cannot be reconciled without an accepted entity-link decision.",
            null,
            result.receipt.receiptHash
          )
        );
      }
    }
  }

  if (objectMismatch) objectRef = "";
  if (identityMismatch) identity = {};

  const fieldsByProperty = new Map<
    string,
    Array<{
      field: CanonicalFieldValue;
      receiptHash: string;
      authorityRef: string;
    }>
  >();
  for (const result of includedResults) {
    for (const field of result.canonicalRecord.fields) {
      const entries = fieldsByProperty.get(field.propertyRef) ?? [];
      entries.push({
        field,
        receiptHash: result.receipt.receiptHash,
        authorityRef: result.receipt.authorityRef,
      });
      fieldsByProperty.set(field.propertyRef, entries);
    }
  }

  let fields: CanonicalReconciledField[] = [...fieldsByProperty.entries()]
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([propertyRef, entries]) => {
      const policies = [...new Set(entries.map(({ field }) => field.conflictPolicy))]
        .sort(compareCanonicalStrings);
      const conflictPolicy = policies.length === 1 ? policies[0] : null;
      if (policies.length !== 1) {
        issues.push(
          reconciliationIssue(
            "mixed_field_conflict_policies",
            "error",
            `Canonical property ${propertyRef} has incompatible conflict policies.`,
            propertyRef
          )
        );
      }

      const candidatesByValue = new Map<
        string,
        {
          value: JsonValue;
          valueHash: string;
          evidence: Map<string, CanonicalReconciliationEvidence>;
        }
      >();
      for (const {
        field,
        receiptHash,
        authorityRef,
      } of entries) {
        const valueKey = canonicalJson(field.value);
        const candidate = candidatesByValue.get(valueKey) ?? {
          value: cloneJson(field.value),
          valueHash: semanticHash(field.value),
          evidence: new Map<string, CanonicalReconciliationEvidence>(),
        };
        const evidence: CanonicalReconciliationEvidence = {
          receiptHash,
          receiptAuthorityRef: authorityRef,
          provenance: structuredClone(field.provenance),
        };
        candidate.evidence.set(canonicalJson(evidence), evidence);
        candidatesByValue.set(valueKey, candidate);
      }
      const candidates = [...candidatesByValue.values()]
        .map((candidate) => ({
          value: candidate.value,
          valueHash: candidate.valueHash,
          evidence: [...candidate.evidence.values()].sort(
            (left, right) =>
              compareCanonicalStrings(left.receiptHash, right.receiptHash) ||
              compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
          ),
        }))
        .sort(
          (left, right) =>
            compareCanonicalStrings(left.valueHash, right.valueHash) ||
            compareCanonicalStrings(canonicalJson(left.value), canonicalJson(right.value))
        );

      let status: CanonicalReconciledField["status"] = "needs_review";
      let resolution: CanonicalReconciledField["resolution"] = "unresolved";
      let selectedValue: JsonValue | null = null;
      let selectedValueHash: string | null = null;

      if (candidates.length === 1 && conflictPolicy) {
        status = "selected";
        resolution = "single_value";
        selectedValue = cloneJson(candidates[0].value);
        selectedValueHash = candidates[0].valueHash;
      } else if (candidates.length > 1 && conflictPolicy === "preserve_all") {
        status = "preserved";
        resolution = "preserve_all";
        issues.push(
          reconciliationIssue(
            "conflicting_values_preserved",
            "warning",
            `Distinct values for ${propertyRef} are preserved without selecting a winner.`,
            propertyRef
          )
        );
      } else if (candidates.length > 1 && conflictPolicy === "require_review") {
        issues.push(
          reconciliationIssue(
            "conflicting_values_require_review",
            "review",
            `Distinct values for ${propertyRef} require human review.`,
            propertyRef
          )
        );
      } else if (candidates.length > 1 && conflictPolicy === "prefer_authority") {
        const authorityDomains = [
          ...new Set(
            candidates.flatMap((candidate) =>
              candidate.evidence.map(
                (evidence) => evidence.provenance.authorityDomain
              )
            )
          ),
        ].sort(compareCanonicalStrings);
        const authorityDomain =
          authorityDomains.length === 1 ? authorityDomains[0] : null;
        const priorities = authorityDomain
          ? prioritiesByDomain.get(authorityDomain)
          : undefined;

        if (!authorityDomain) {
          issues.push(
            reconciliationIssue(
              "mixed_authority_domains",
              "review",
              `Distinct values for ${propertyRef} assert different authority domains.`,
              propertyRef
            )
          );
        } else if (!priorities) {
          issues.push(
            reconciliationIssue(
              "missing_authority_priority",
              "review",
              `No explicit authority priority is defined for ${authorityDomain}; ${propertyRef} remains unresolved.`,
              propertyRef
            )
          );
        } else {
          const ranked = candidates.map((candidate) => {
            const ranks = candidate.evidence
              .map((evidence) =>
                priorities.indexOf(evidence.receiptAuthorityRef)
              )
              .filter((rank) => rank >= 0);
            return {
              candidate,
              rank: ranks.length > 0 ? Math.min(...ranks) : Number.POSITIVE_INFINITY,
            };
          });
          const bestRank = Math.min(...ranked.map(({ rank }) => rank));
          const winners = Number.isFinite(bestRank)
            ? ranked.filter(({ rank }) => rank === bestRank)
            : [];
          if (winners.length === 1) {
            status = "selected";
            resolution = "preferred_authority";
            selectedValue = cloneJson(winners[0].candidate.value);
            selectedValueHash = winners[0].candidate.valueHash;
          } else {
            issues.push(
              reconciliationIssue(
                winners.length === 0
                  ? "no_ranked_authority_evidence"
                  : "authority_priority_tie",
                "review",
                winners.length === 0
                  ? `No candidate for ${propertyRef} is backed by a ranked authority reference.`
                  : `More than one value for ${propertyRef} is backed by the highest-ranked authority reference.`,
                propertyRef
              )
            );
          }
        }
      }

      return {
        propertyRef,
        conflictPolicy,
        status,
        resolution,
        selectedValue,
        selectedValueHash,
        candidates,
      };
    });

  const hasFatalIssue = issues.some(({ severity }) => severity === "error");
  if (hasFatalIssue) {
    fields = fields.map((field) => ({
      ...field,
      status: "needs_review",
      resolution: "unresolved",
      selectedValue: null,
      selectedValueHash: null,
    }));
  }

  const sortedIssues = [...issues].sort(
    (left, right) =>
      compareCanonicalStrings(left.code, right.code) ||
      compareCanonicalStrings(left.propertyRef ?? "", right.propertyRef ?? "") ||
      compareCanonicalStrings(left.receiptHash ?? "", right.receiptHash ?? "") ||
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const humanReviewRequired = sortedIssues.some(
    ({ severity }) => severity === "error" || severity === "review"
  );
  const proposalWithoutHash = {
    proposalVersion: "t2k.canonical-reconciliation-proposal.v1" as const,
    status: hasFatalIssue
      ? ("rejected" as const)
      : humanReviewRequired
        ? ("needs_review" as const)
        : ("proposed" as const),
    objectRef,
    identity,
    fields,
    policyId,
    policyVersion,
    policyHash,
    inputReceiptHashes,
    includedReceiptHashes: [...includedReceiptHashes].sort(compareCanonicalStrings),
    inputHash,
    issues: sortedIssues,
    humanReviewRequired,
    nonMutating: true as const,
    alternativesPreserved: true as const,
  };

  return {
    ...proposalWithoutHash,
    proposalHash: semanticHash(proposalWithoutHash),
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
  invalidThresholdCount?: number;
  invalidInputCount?: number;
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

function isValidUnitThreshold(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
  );
}

function validEntityResolutionRule(
  rule: unknown
): rule is EntityResolutionRule {
  return (
    isRecord(rule) &&
    typeof rule.identifier === "string" &&
    rule.identifier.trim().length > 0 &&
    typeof rule.weight === "number" &&
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
  const rawInput: unknown = input;
  const inputRecord = isRecord(rawInput) ? rawInput : {};
  const rawRules = inputRecord.rules;
  const rawRuleArray = Array.isArray(rawRules) ? [...rawRules] : [];
  const normalizedInputRules = rawRuleArray.sort(
    (left, right) =>
      compareCanonicalStrings(
        isRecord(left) && typeof left.identifier === "string"
          ? left.identifier
          : "",
        isRecord(right) && typeof right.identifier === "string"
          ? right.identifier
          : ""
      ) || compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const invalidRuleCount =
    normalizedInputRules.filter((rule) => !validEntityResolutionRule(rule))
      .length + (Array.isArray(rawRules) ? 0 : 1);
  const rules = normalizedInputRules
    .filter(validEntityResolutionRule)
    .sort(
      (left, right) =>
        compareCanonicalStrings(left.identifier, right.identifier) ||
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
    );
  const totalWeight = rules.reduce((sum, rule) => sum + rule.weight, 0);
  const sourceEntityKey =
    typeof inputRecord.sourceEntityKey === "string"
      ? inputRecord.sourceEntityKey
      : "";
  const sourceIdentifiers = isJsonObjectShape(inputRecord.identifiers)
    ? inputRecord.identifiers
    : {};
  const rawCandidates = inputRecord.candidates;
  const candidateArray = Array.isArray(rawCandidates) ? [...rawCandidates] : [];
  const structurallyInvalidCandidates = candidateArray.filter(
    (candidate) =>
      !isRecord(candidate) ||
      typeof candidate.entityKey !== "string" ||
      candidate.entityKey.trim().length === 0 ||
      !isJsonObjectShape(candidate.identifiers)
  ).length;
  const invalidInputCount =
    (isRecord(rawInput) ? 0 : 1) +
    (typeof inputRecord.sourceEntityKey === "string" &&
    inputRecord.sourceEntityKey.trim().length > 0
      ? 0
      : 1) +
    (isJsonObjectShape(inputRecord.identifiers) ? 0 : 1) +
    (Array.isArray(rawCandidates) ? 0 : 1) +
    structurallyInvalidCandidates;
  const candidates = candidateArray
    .map((rawCandidate) => {
      const candidate = isRecord(rawCandidate) ? rawCandidate : {};
      const candidateIdentifiers = isJsonObjectShape(candidate.identifiers)
        ? candidate.identifiers
        : {};
      const matchedIdentifiers: string[] = [];
      const mismatchedIdentifiers: string[] = [];
      let matchedWeight = 0;
      let requiredMatchesSatisfied = true;

      for (const rule of rules) {
        const sourceValue = sourceIdentifiers[rule.identifier];
        const candidateValue = candidateIdentifiers[rule.identifier];
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
        entityKey:
          typeof candidate.entityKey === "string" ? candidate.entityKey : "",
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

  const rawAutomaticThreshold = inputRecord.automaticMatchThreshold;
  const rawReviewThreshold = inputRecord.reviewThreshold;
  const rawAmbiguityMargin = inputRecord.ambiguityMargin;
  const automaticThreshold = isValidUnitThreshold(rawAutomaticThreshold)
    ? rawAutomaticThreshold
    : 0.9;
  const requestedReviewThreshold = isValidUnitThreshold(rawReviewThreshold)
    ? rawReviewThreshold
    : 0.5;
  const reviewThreshold =
    requestedReviewThreshold <= automaticThreshold
      ? requestedReviewThreshold
      : Math.min(0.5, automaticThreshold);
  const ambiguityMargin = isValidUnitThreshold(rawAmbiguityMargin)
    ? rawAmbiguityMargin
    : 0.1;
  const invalidThresholdCount =
    (rawAutomaticThreshold !== undefined &&
    !isValidUnitThreshold(rawAutomaticThreshold)
      ? 1
      : 0) +
    (rawReviewThreshold !== undefined &&
    !isValidUnitThreshold(rawReviewThreshold)
      ? 1
      : 0) +
    (rawAmbiguityMargin !== undefined &&
    !isValidUnitThreshold(rawAmbiguityMargin)
      ? 1
      : 0) +
    (isValidUnitThreshold(rawAutomaticThreshold) &&
    isValidUnitThreshold(rawReviewThreshold) &&
    rawReviewThreshold > rawAutomaticThreshold
      ? 1
      : 0);
  const thresholds = {
    automaticMatch: automaticThreshold,
    review: reviewThreshold,
    ambiguityMargin,
  };
  const normalizedCandidateEvidence = candidateArray.sort(
    (left, right) =>
      compareCanonicalStrings(
        isRecord(left) && typeof left.entityKey === "string"
          ? left.entityKey
          : "",
        isRecord(right) && typeof right.entityKey === "string"
          ? right.entityKey
          : ""
      ) ||
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const normalizedRuleEvidence = Array.isArray(rawRules)
    ? normalizedInputRules
    : rawRules;
  const rulesHash = semanticHash(normalizedRuleEvidence);
  const inputHash = semanticHash({
    sourceEntityKey: inputRecord.sourceEntityKey,
    identifiers: inputRecord.identifiers,
    candidates: Array.isArray(rawCandidates)
      ? normalizedCandidateEvidence
      : rawCandidates,
    rules: normalizedRuleEvidence,
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
    invalidThresholdCount === 0 &&
    invalidInputCount === 0 &&
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
    rationale =
      invalidThresholdCount > 0
        ? "At least one entity-resolution threshold is invalid; a candidate met the review threshold, but automatic matching is prohibited."
        : invalidRuleCount > 0
          ? "At least one entity-resolution rule is invalid; a candidate met the review threshold, but automatic matching is prohibited."
          : invalidInputCount > 0
            ? "The entity-resolution input is malformed; a candidate met the review threshold, but automatic matching is prohibited."
            : "At least one candidate met the review threshold, but automatic merge conditions were not satisfied.";
  } else if (
    invalidRuleCount > 0 ||
    invalidThresholdCount > 0 ||
    invalidInputCount > 0
  ) {
    rationale =
      "Entity-resolution inputs or controls are invalid; automatic matching is prohibited and no candidate met the review threshold.";
  }

  const decisionWithoutHash = {
    status,
    sourceEntityKey,
    targetEntityKey,
    humanReviewRequired: status !== "matched",
    reversible: true as const,
    candidates,
    inputHash,
    rulesHash,
    invalidRuleCount,
    ...(invalidThresholdCount > 0 ? { invalidThresholdCount } : {}),
    ...(invalidInputCount > 0 ? { invalidInputCount } : {}),
    thresholds,
    rationale,
  };
  return {
    ...decisionWithoutHash,
    decisionHash: semanticHash(decisionWithoutHash),
  };
}
