import {
  canonicalJson,
  compareCanonicalStrings,
  semanticHash,
} from "./compiler.js";
import { parseExplicitTimestamp } from "./reference-time.js";
import type { JsonObject } from "./types.js";

export interface PurposeLimitedAccessRequest {
  requestKey: string;
  principalId: string;
  principalRoles: string[];
  purpose: string;
  subjectRef: string;
  subjectRelationship: string;
  dataCategories: string[];
  jurisdiction: string;
  requestedAt: string;
  sourceRecordRefs: string[];
  attributes?: JsonObject;
}

export interface PurposeLimitedAccessRule {
  ruleId: string;
  effect: "allow" | "deny";
  roles?: string[];
  purposes?: string[];
  subjectRelationships?: string[];
  dataCategories?: string[];
  jurisdictions?: string[];
  attributeEquals?: JsonObject;
  effectiveFrom?: string;
  effectiveTo?: string;
  reason: string;
}

export interface PurposeLimitedAccessPolicy {
  policyId: string;
  policyVersion: string;
  defaultEffect: "deny";
  rules: PurposeLimitedAccessRule[];
}

export interface PurposeLimitedAccessReceipt {
  receiptVersion: "t2k.purpose-access-receipt.v1";
  decision: "allow" | "deny";
  reasonCode:
    | "explicit_deny"
    | "explicit_allow"
    | "default_deny"
    | "invalid_request"
    | "invalid_request_time"
    | "invalid_policy_rule"
    | "invalid_policy_time";
  reason: string;
  matchedRuleId: string | null;
  policyId: string;
  policyVersion: string;
  policyHash: string;
  requestKey: string;
  requestHash: string;
  principalId: string;
  purpose: string;
  subjectRef: string;
  subjectRelationship: string;
  dataCategories: string[];
  jurisdiction: string;
  requestedAt: string;
  sourceRecordRefs: string[];
  receiptHash: string;
}

function includesAny(expected: string[] | undefined, actual: string[]) {
  return expected === undefined
    ? true
    : expected.some((value) => actual.includes(value));
}

function includesAll(expected: string[] | undefined, actual: string[]) {
  return expected === undefined
    ? true
    : actual.every((value) => expected.includes(value));
}

function includesValue(expected: string[] | undefined, actual: string) {
  return expected === undefined ? true : expected.includes(actual);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function validSelector(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) => typeof item === "string" && item.trim().length > 0
    )
  );
}

function validRuleShape(rule: unknown): rule is PurposeLimitedAccessRule {
  if (!isRecord(rule)) return false;
  const selectors = [
    rule.roles,
    rule.purposes,
    rule.subjectRelationships,
    rule.dataCategories,
    rule.jurisdictions,
  ];
  const attributesValid =
    rule.attributeEquals === undefined ||
    (isRecord(rule.attributeEquals) &&
      Object.keys(rule.attributeEquals).length > 0 &&
      Object.values(rule.attributeEquals).every(isJsonValue));
  return (
    typeof rule.ruleId === "string" &&
    rule.ruleId.trim().length > 0 &&
    (rule.effect === "allow" || rule.effect === "deny") &&
    typeof rule.reason === "string" &&
    rule.reason.trim().length > 0 &&
    selectors.every(
      (selector) => selector === undefined || validSelector(selector)
    ) &&
    attributesValid
  );
}

function nonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validRequestStringArray(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => nonblankString(item))
  );
}

function validRequestShape(
  request: unknown
): request is PurposeLimitedAccessRequest {
  if (!isRecord(request)) return false;
  return (
    [
      request.requestKey,
      request.principalId,
      request.purpose,
      request.subjectRef,
      request.subjectRelationship,
      request.jurisdiction,
      request.requestedAt,
    ].every(nonblankString) &&
    validRequestStringArray(request.principalRoles) &&
    validRequestStringArray(request.dataCategories) &&
    validRequestStringArray(request.sourceRecordRefs) &&
    (request.attributes === undefined ||
      (isRecord(request.attributes) &&
        Object.values(request.attributes).every(isJsonValue)))
  );
}

function unknownString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function receiptStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .sort(compareCanonicalStrings)
    : [];
}

function sortUnknownArray(value: unknown) {
  if (!Array.isArray(value)) return value;
  if (value.every((item) => typeof item === "string")) {
    return [...value].sort(compareCanonicalStrings);
  }
  return [...value].sort((left, right) =>
    compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
}

function isRuleActive(rule: PurposeLimitedAccessRule, requestedAt: number) {
  const effectiveFrom =
    rule.effectiveFrom !== undefined && typeof rule.effectiveFrom === "string"
      ? parseExplicitTimestamp(rule.effectiveFrom)
      : null;
  const effectiveTo =
    rule.effectiveTo !== undefined && typeof rule.effectiveTo === "string"
      ? parseExplicitTimestamp(rule.effectiveTo)
      : null;
  return (
    (effectiveFrom === null ||
      requestedAt >= effectiveFrom) &&
    (effectiveTo === null ||
      requestedAt < effectiveTo)
  );
}

function ruleMatches(
  rule: PurposeLimitedAccessRule,
  request: PurposeLimitedAccessRequest,
  requestedAt: number
) {
  const requestAttributes = request.attributes ?? {};
  const attributesMatch = Object.entries(rule.attributeEquals ?? {}).every(
    ([key, value]) =>
      Object.hasOwn(requestAttributes, key) &&
      semanticHash(requestAttributes[key]) === semanticHash(value)
  );
  const categoriesMatch =
    rule.effect === "deny"
      ? includesAny(rule.dataCategories, request.dataCategories)
      : includesAll(rule.dataCategories, request.dataCategories);

  return (
    isRuleActive(rule, requestedAt) &&
    includesAny(rule.roles, request.principalRoles) &&
    includesValue(rule.purposes, request.purpose) &&
    includesValue(rule.subjectRelationships, request.subjectRelationship) &&
    categoriesMatch &&
    includesValue(rule.jurisdictions, request.jurisdiction) &&
    attributesMatch
  );
}

/**
 * Evaluates a purpose-limited access request with explicit-deny precedence and
 * a mandatory default deny. The result is a deterministic disclosure receipt,
 * not an authentication token or substitute for the owning IAM system.
 */
export function evaluatePurposeLimitedAccess(
  policy: PurposeLimitedAccessPolicy,
  request: PurposeLimitedAccessRequest
): PurposeLimitedAccessReceipt {
  const rawPolicy: unknown = policy;
  const policyRecord = isRecord(rawPolicy) ? rawPolicy : {};
  const rawRequest: unknown = request;
  const requestRecord = isRecord(rawRequest) ? rawRequest : {};
  const rawRules = policyRecord.rules;
  const sortedRules = (Array.isArray(rawRules) ? [...rawRules] : []).sort(
    (left, right) =>
      compareCanonicalStrings(
        isRecord(left) && typeof left.ruleId === "string" ? left.ruleId : "",
        isRecord(right) && typeof right.ruleId === "string" ? right.ruleId : ""
      ) ||
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const policyHash = semanticHash(
    isRecord(rawPolicy) && Array.isArray(rawRules)
      ? { ...rawPolicy, rules: sortedRules }
      : rawPolicy
  );
  const normalizedRequest = {
    ...requestRecord,
    principalRoles: sortUnknownArray(requestRecord.principalRoles),
    dataCategories: sortUnknownArray(requestRecord.dataCategories),
    sourceRecordRefs: sortUnknownArray(requestRecord.sourceRecordRefs),
  };
  const requestHash = semanticHash(normalizedRequest);
  const requestValid = validRequestShape(rawRequest);
  const requestedAt = requestValid
    ? parseExplicitTimestamp(request.requestedAt)
    : null;
  const policyId = unknownString(policyRecord.policyId);
  const policyVersion = unknownString(policyRecord.policyVersion);
  const policyShapeValid =
    nonblankString(policyRecord.policyId) &&
    nonblankString(policyRecord.policyVersion) &&
    policyRecord.defaultEffect === "deny" &&
    Array.isArray(rawRules);

  let decision: PurposeLimitedAccessReceipt["decision"] = "deny";
  let reasonCode: PurposeLimitedAccessReceipt["reasonCode"] = "default_deny";
  let reason = "No active allow rule matched; default deny applies.";
  let matchedRuleId: string | null = null;
  const invalidShapeRule = sortedRules.find((rule) => !validRuleShape(rule));
  const invalidTimeRule = sortedRules.find((rule) => {
    if (!validRuleShape(rule)) return false;
    const hasEffectiveFrom = rule.effectiveFrom !== undefined;
    const hasEffectiveTo = rule.effectiveTo !== undefined;
    const effectiveFrom =
      hasEffectiveFrom && typeof rule.effectiveFrom === "string"
        ? parseExplicitTimestamp(rule.effectiveFrom)
        : null;
    const effectiveTo =
      hasEffectiveTo && typeof rule.effectiveTo === "string"
        ? parseExplicitTimestamp(rule.effectiveTo)
        : null;

    return (
      (hasEffectiveFrom && effectiveFrom === null) ||
      (hasEffectiveTo && effectiveTo === null) ||
      (effectiveFrom !== null &&
        effectiveTo !== null &&
        effectiveFrom >= effectiveTo)
    );
  });

  if (!requestValid) {
    reasonCode = "invalid_request";
    reason = "The access request is malformed or incomplete; access fails closed.";
  } else if (requestedAt === null) {
    reasonCode = "invalid_request_time";
    reason = "The request time is invalid; access fails closed.";
  } else if (
    !policyShapeValid ||
    invalidShapeRule
  ) {
    reasonCode = "invalid_policy_rule";
    reason = invalidShapeRule
      ? `Policy rule ${
          isRecord(invalidShapeRule) &&
          typeof invalidShapeRule.ruleId === "string" &&
          invalidShapeRule.ruleId
            ? invalidShapeRule.ruleId
            : "<missing>"
        } is malformed; access fails closed.`
      : "The policy identity, rules, or mandatory default deny is invalid; access fails closed.";
    matchedRuleId =
      isRecord(invalidShapeRule) && typeof invalidShapeRule.ruleId === "string"
        ? invalidShapeRule.ruleId || null
        : null;
  } else if (invalidTimeRule) {
    reasonCode = "invalid_policy_time";
    reason = `Policy rule ${invalidTimeRule.ruleId} has an invalid effective time; access fails closed.`;
    matchedRuleId = invalidTimeRule.ruleId;
  } else {
    const validRules = sortedRules.filter(validRuleShape);
    const explicitDeny = validRules.find(
      (rule) =>
        rule.effect === "deny" && ruleMatches(rule, request, requestedAt)
    );
    const explicitAllow = validRules.find(
      (rule) =>
        rule.effect === "allow" && ruleMatches(rule, request, requestedAt)
    );

    if (explicitDeny) {
      reasonCode = "explicit_deny";
      reason = explicitDeny.reason;
      matchedRuleId = explicitDeny.ruleId;
    } else if (explicitAllow) {
      decision = "allow";
      reasonCode = "explicit_allow";
      reason = explicitAllow.reason;
      matchedRuleId = explicitAllow.ruleId;
    }
  }

  const receiptWithoutHash = {
    receiptVersion: "t2k.purpose-access-receipt.v1" as const,
    decision,
    reasonCode,
    reason,
    matchedRuleId,
    policyId,
    policyVersion,
    policyHash,
    requestKey: unknownString(requestRecord.requestKey),
    requestHash,
    principalId: unknownString(requestRecord.principalId),
    purpose: unknownString(requestRecord.purpose),
    subjectRef: unknownString(requestRecord.subjectRef),
    subjectRelationship: unknownString(requestRecord.subjectRelationship),
    dataCategories: receiptStringArray(requestRecord.dataCategories),
    jurisdiction: unknownString(requestRecord.jurisdiction),
    requestedAt: unknownString(requestRecord.requestedAt),
    sourceRecordRefs: receiptStringArray(requestRecord.sourceRecordRefs),
  };

  return {
    ...receiptWithoutHash,
    receiptHash: semanticHash(receiptWithoutHash),
  };
}
