import { describe, expect, it } from "vitest";

import { compareCanonicalStrings, semanticHash } from "../compiler.js";
import {
  evaluatePurposeLimitedAccess,
  type PurposeLimitedAccessPolicy,
  type PurposeLimitedAccessRequest,
} from "../reference-access.js";

const policy: PurposeLimitedAccessPolicy = {
  policyId: "benefits:purpose-limited-access",
  policyVersion: "1.0.0",
  defaultEffect: "deny",
  rules: [
    {
      ruleId: "allow-assigned-benefit-work",
      effect: "allow",
      roles: ["benefits_technician"],
      purposes: ["benefit_adjudication"],
      dataCategories: ["identity", "benefit_record"],
      jurisdictions: ["US-WA"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2027-01-01T00:00:00.000Z",
      reason: "Assigned technicians may use the minimum data needed for adjudication.",
    },
    {
      ruleId: "deny-self-record",
      effect: "deny",
      roles: ["benefits_technician"],
      purposes: ["benefit_adjudication"],
      subjectRelationships: ["self"],
      dataCategories: ["identity", "benefit_record"],
      jurisdictions: ["US-WA"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2027-01-01T00:00:00.000Z",
      reason: "Technicians may not access their own record.",
    },
  ],
};

const request: PurposeLimitedAccessRequest = {
  requestKey: "access-request-001",
  principalId: "user:technician-7",
  principalRoles: ["benefits_technician"],
  purpose: "benefit_adjudication",
  subjectRef: "beneficiary:123",
  subjectRelationship: "assigned_case",
  dataCategories: ["identity", "benefit_record"],
  jurisdiction: "US-WA",
  requestedAt: "2026-08-29T18:00:00.000Z",
  sourceRecordRefs: ["source:claim-2", "source:claim-1"],
  attributes: { deviceTrust: "managed" },
};

describe("purpose-limited access", () => {
  it("allows an active purpose match and emits a deterministic disclosure receipt", () => {
    const first = evaluatePurposeLimitedAccess(policy, request);
    const second = evaluatePurposeLimitedAccess(
      { ...structuredClone(policy), rules: [...policy.rules].reverse() },
      {
        ...structuredClone(request),
        principalRoles: [...request.principalRoles].reverse(),
        dataCategories: [...request.dataCategories].reverse(),
        sourceRecordRefs: [...request.sourceRecordRefs].reverse(),
      }
    );

    const canonicalPolicy = {
      ...policy,
      rules: [...policy.rules].sort((left, right) =>
        compareCanonicalStrings(left.ruleId, right.ruleId)
      ),
    };
    const canonicalRequest = {
      ...request,
      principalRoles: [...request.principalRoles].sort(compareCanonicalStrings),
      dataCategories: [...request.dataCategories].sort(compareCanonicalStrings),
      sourceRecordRefs: [...request.sourceRecordRefs].sort(compareCanonicalStrings),
    };

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      decision: "allow",
      reasonCode: "explicit_allow",
      matchedRuleId: "allow-assigned-benefit-work",
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyHash: semanticHash(canonicalPolicy),
      requestKey: request.requestKey,
      requestHash: semanticHash(canonicalRequest),
      principalId: request.principalId,
      purpose: request.purpose,
      subjectRef: request.subjectRef,
      subjectRelationship: request.subjectRelationship,
      dataCategories: ["benefit_record", "identity"],
      sourceRecordRefs: ["source:claim-1", "source:claim-2"],
    });
    const { receiptHash, ...receiptWithoutHash } = first;
    expect(receiptHash).toBe(semanticHash(receiptWithoutHash));
  });

  it("canonicalizes duplicate rule IDs before selecting a deterministic reason", () => {
    const duplicateIdPolicy: PurposeLimitedAccessPolicy = {
      ...policy,
      rules: [
        { ...policy.rules[0], reason: "Reason Z" },
        { ...policy.rules[0], reason: "Reason A" },
      ],
    };
    const first = evaluatePurposeLimitedAccess(duplicateIdPolicy, request);
    const reversed = evaluatePurposeLimitedAccess(
      { ...duplicateIdPolicy, rules: [...duplicateIdPolicy.rules].reverse() },
      request
    );

    expect(first).toEqual(reversed);
    expect(first.decision).toBe("allow");
  });

  it("applies default deny when the requested purpose is not authorized", () => {
    const receipt = evaluatePurposeLimitedAccess(policy, {
      ...request,
      purpose: "workforce_analytics",
    });

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "default_deny",
      matchedRuleId: null,
    });
  });

  it("does not let a partial category match authorize a broader disclosure", () => {
    const receipt = evaluatePurposeLimitedAccess(policy, {
      ...request,
      dataCategories: ["identity", "benefit_record", "medical_record"],
    });

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "default_deny",
      matchedRuleId: null,
    });
  });

  it("does not confuse a missing attribute with the literal string undefined", () => {
    const receipt = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [
          {
            ...policy.rules[0],
            attributeEquals: { deviceTrust: "undefined" },
          },
        ],
      },
      { ...request, attributes: {} }
    );

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "default_deny",
      matchedRuleId: null,
    });
  });

  it("treats present empty or malformed rule selectors as invalid, not wildcards", () => {
    const emptyRoles = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [{ ...policy.rules[0], roles: [] }],
      },
      { ...request, principalRoles: ["outsider"] }
    );
    const malformedDeny = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [
          policy.rules[0],
          {
            ...policy.rules[1],
            roles: null,
            subjectRelationships: ["assigned_case"],
          } as unknown as PurposeLimitedAccessPolicy["rules"][number],
        ],
      },
      request
    );

    expect(emptyRoles).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_rule",
      matchedRuleId: "allow-assigned-benefit-work",
    });
    expect(malformedDeny).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_rule",
      matchedRuleId: "deny-self-record",
    });
  });

  it("rejects an explicitly empty attribute constraint", () => {
    const receipt = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [{ ...policy.rules[0], attributeEquals: {} }],
      },
      request
    );

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_rule",
    });
  });

  it("treats omitted effective bounds as an unbounded active rule", () => {
    const unboundedPolicy: PurposeLimitedAccessPolicy = {
      ...policy,
      rules: [
        {
          ...policy.rules[0],
          effectiveFrom: undefined,
          effectiveTo: undefined,
        },
      ],
    };
    const receipt = evaluatePurposeLimitedAccess(unboundedPolicy, request);

    expect(receipt).toMatchObject({
      decision: "allow",
      reasonCode: "explicit_allow",
      matchedRuleId: "allow-assigned-benefit-work",
    });
  });

  it("gives an explicit deny precedence over a matching allow", () => {
    const receipt = evaluatePurposeLimitedAccess(policy, {
      ...request,
      subjectRelationship: "self",
    });

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "explicit_deny",
      matchedRuleId: "deny-self-record",
      reason: "Technicians may not access their own record.",
    });
  });

  it("treats the effective-to boundary as expired and fails closed", () => {
    const receipt = evaluatePurposeLimitedAccess(policy, {
      ...request,
      requestedAt: "2027-01-01T00:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "default_deny",
      matchedRuleId: null,
    });
  });

  it("fails closed on malformed policy or request timestamps", () => {
    const malformedRule = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [
          {
            ...policy.rules[0],
            effectiveFrom: "not-a-time",
          },
        ],
      },
      request
    );
    const malformedRequest = evaluatePurposeLimitedAccess(policy, {
      ...request,
      requestedAt: "not-a-time",
    });

    expect(malformedRule.reasonCode).toBe("invalid_policy_time");
    expect(malformedRequest.reasonCode).toBe("invalid_request_time");
    expect(malformedRequest.decision).toBe("deny");
  });

  it("rejects timezone-less request and policy timestamps", () => {
    const timezoneLessRequest = evaluatePurposeLimitedAccess(policy, {
      ...request,
      requestedAt: "2026-08-29T18:00:00",
    });
    const timezoneLessPolicy = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [
          {
            ...policy.rules[0],
            effectiveFrom: "2026-01-01T00:00:00",
          },
        ],
      },
      request
    );

    expect(timezoneLessRequest).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_request_time",
    });
    expect(timezoneLessPolicy).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_time",
    });
  });

  it("fails closed when an invalid deny rule would otherwise be bypassed by an allow", () => {
    const receipt = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [
          policy.rules[0],
          {
            ...policy.rules[1],
            subjectRelationships: ["assigned_case"],
            effectiveFrom: "timezone-less-invalid",
          },
        ],
      },
      request
    );

    expect(receipt).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_time",
      matchedRuleId: "deny-self-record",
    });
  });

  it("fails closed on blank or nonpositive policy windows", () => {
    const blankAllow = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [{ ...policy.rules[0], effectiveFrom: "" }],
      },
      request
    );
    const invertedDeny = evaluatePurposeLimitedAccess(
      {
        ...policy,
        rules: [
          policy.rules[0],
          {
            ...policy.rules[1],
            subjectRelationships: ["assigned_case"],
            effectiveFrom: "2027-01-01T00:00:00.000Z",
            effectiveTo: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      request
    );

    expect(blankAllow).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_time",
      matchedRuleId: "allow-assigned-benefit-work",
    });
    expect(invertedDeny).toMatchObject({
      decision: "deny",
      reasonCode: "invalid_policy_time",
      matchedRuleId: "deny-self-record",
    });
  });

  it("rejects calendar-overflow timestamps instead of normalizing them", () => {
    const invalidDate = evaluatePurposeLimitedAccess(policy, {
      ...request,
      requestedAt: "2026-02-30T18:00:00Z",
    });
    const invalidHour = evaluatePurposeLimitedAccess(policy, {
      ...request,
      requestedAt: "2026-08-29T24:00:00Z",
    });

    expect(invalidDate.reasonCode).toBe("invalid_request_time");
    expect(invalidHour.reasonCode).toBe("invalid_request_time");
  });
});
