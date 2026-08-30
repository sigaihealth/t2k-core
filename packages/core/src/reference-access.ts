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

function validRuleShape(rule: PurposeLimitedAccessRule) {
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
  const requestedAt = parseExplicitTimestamp(request.requestedAt);
  const sortedRules = [...policy.rules].sort(
    (left, right) =>
      compareCanonicalStrings(left.ruleId, right.ruleId) ||
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
  );
  const policyHash = semanticHash({ ...policy, rules: sortedRules });
  const normalizedRequest = {
    ...request,
    principalRoles: [...request.principalRoles].sort(compareCanonicalStrings),
    dataCategories: [...request.dataCategories].sort(compareCanonicalStrings),
    sourceRecordRefs: [...request.sourceRecordRefs].sort(compareCanonicalStrings),
  };
  const requestHash = semanticHash(normalizedRequest);

  let decision: PurposeLimitedAccessReceipt["decision"] = "deny";
  let reasonCode: PurposeLimitedAccessReceipt["reasonCode"] = "default_deny";
  let reason = "No active allow rule matched; default deny applies.";
  let matchedRuleId: string | null = null;
  const invalidShapeRule = sortedRules.find((rule) => !validRuleShape(rule));
  const invalidTimeRule = sortedRules.find((rule) => {
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

  if (requestedAt === null) {
    reasonCode = "invalid_request_time";
    reason = "The request time is invalid; access fails closed.";
  } else if (
    policy.defaultEffect !== "deny" ||
    invalidShapeRule
  ) {
    reasonCode = "invalid_policy_rule";
    reason = invalidShapeRule
      ? `Policy rule ${invalidShapeRule.ruleId || "<missing>"} is malformed; access fails closed.`
      : "The policy default is not deny; access fails closed.";
    matchedRuleId = invalidShapeRule?.ruleId || null;
  } else if (invalidTimeRule) {
    reasonCode = "invalid_policy_time";
    reason = `Policy rule ${invalidTimeRule.ruleId} has an invalid effective time; access fails closed.`;
    matchedRuleId = invalidTimeRule.ruleId;
  } else {
    const explicitDeny = sortedRules.find(
      (rule) =>
        rule.effect === "deny" && ruleMatches(rule, request, requestedAt)
    );
    const explicitAllow = sortedRules.find(
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
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyHash,
    requestKey: request.requestKey,
    requestHash,
    principalId: request.principalId,
    purpose: request.purpose,
    subjectRef: request.subjectRef,
    subjectRelationship: request.subjectRelationship,
    dataCategories: [...request.dataCategories].sort(compareCanonicalStrings),
    jurisdiction: request.jurisdiction,
    requestedAt: request.requestedAt,
    sourceRecordRefs: [...request.sourceRecordRefs].sort(compareCanonicalStrings),
  };

  return {
    ...receiptWithoutHash,
    receiptHash: semanticHash(receiptWithoutHash),
  };
}
