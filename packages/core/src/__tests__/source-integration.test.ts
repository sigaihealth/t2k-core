import { describe, expect, it } from "vitest";

import { compareCanonicalStrings, semanticHash } from "../compiler.js";
import type { OntologyPackSourceMapping } from "../manifest.js";
import {
  type CanonicalAuthorityPolicy,
  executeSourceMapping,
  type ExecuteSourceMappingResult,
  type FederatedSourceEnvelope,
  reconcileCanonicalRecords,
  resolveEntityCandidates,
} from "../source-integration.js";

const sourceMapping: OntologyPackSourceMapping = {
  id: "benefits:claimant_api_v1",
  mappingVersion: "1.0.0",
  sourceType: "api",
  sourceLocator: "synthetic://claimant-api",
  sourceSchemaVersion: "1.0.0",
  fields: "",
  sheet: "",
  range: "",
  headers: "",
  object: "benefits:person",
  properties: "",
  transform: "",
  fieldMappings: [
    {
      sourcePath: "$.fullName",
      targetProperty: "benefits:person.display_name",
      required: true,
      normalizations: ["collapse_whitespace"],
      valueMap: {},
      authorityDomain: "claimant_identity",
      conflictPolicy: "require_review",
    },
    {
      sourcePath: "$.externalId",
      targetProperty: "benefits:person.external_id",
      required: true,
      normalizations: ["trim", "uppercase"],
      valueMap: {},
      authorityDomain: "claimant_identity",
      conflictPolicy: "preserve_all",
    },
    {
      sourcePath: "$.caseStatus",
      targetProperty: "benefits:person.case_status",
      required: true,
      normalizations: ["uppercase"],
      valueMap: { ALLEGED: "alleged" },
      authorityDomain: "case_status",
      conflictPolicy: "preserve_all",
    },
    {
      sourcePath: "$.eligibilityDate",
      targetProperty: "benefits:person.eligibility_date",
      required: false,
      normalizations: ["iso_date"],
      valueMap: {},
      authorityDomain: "eligibility",
      conflictPolicy: "prefer_authority",
    },
  ],
  targetIdentity: ["benefits:person.external_id"],
  idempotencyPath: "$.messageId",
  eventTimePath: "$.eventTime",
  observedTimePath: "$.observedTime",
  authority: "claimant_channel",
  riskTier: "restricted",
  reviewStatus: "accepted",
  driftPolicy: "quarantine",
  lateArrivalPolicy: "quarantine",
  humanCheckpoint: "on_issue",
  replayable: true,
};

const sourcePayload = {
  messageId: "message-001",
  eventTime: "2026-08-29T10:00:00-07:00",
  observedTime: "2026-08-29T10:00:05-07:00",
  externalId: " ab-123 ",
  fullName: "  Ada   Lovelace  ",
  caseStatus: "alleged",
  eligibilityDate: "2026-08-29T00:00:00-07:00",
};

function canonicalMappingHash(mapping: OntologyPackSourceMapping) {
  return semanticHash({
    ...mapping,
    fieldMappings: [...mapping.fieldMappings].sort(
      (left, right) =>
        compareCanonicalStrings(left.targetProperty, right.targetProperty) ||
        compareCanonicalStrings(left.sourcePath, right.sourcePath)
    ),
    targetIdentity: [...mapping.targetIdentity].sort(compareCanonicalStrings),
  });
}

function envelope(
  payload: FederatedSourceEnvelope["payload"] = sourcePayload,
  overrides: Partial<FederatedSourceEnvelope> = {}
): FederatedSourceEnvelope {
  return {
    sourceSystem: "claimant-api",
    sourceLocator: "claimant-api/messages/message-001",
    sourceRecordKey: "message-001",
    sourceSchemaVersion: "1.0.0",
    payload,
    eventTime: "2026-08-29T17:00:00.000Z",
    observedTime: "2026-08-29T17:00:05.000Z",
    authenticationState: "authenticated",
    authorityRef: "authority:claimant",
    dataClassification: "restricted_pii",
    purposeTags: ["case_review", "benefit_adjudication"],
    retentionPolicy: { schedule: "synthetic-seven-year" },
    contentHash: semanticHash(payload),
    ...overrides,
  };
}

const reconciliationAuthorityPolicy: CanonicalAuthorityPolicy = {
  policyId: "benefits:canonical-authority",
  policyVersion: "1.0.0",
  prioritiesByDomain: {
    claimant_identity: ["authority:master", "authority:secondary"],
  },
};

function reconciliationResult(input: {
  recordKey: string;
  authorityRef: string;
  displayName: string;
  conflictPolicy: "preserve_all" | "prefer_authority" | "require_review";
  externalId?: string;
  objectRef?: string;
  driftPolicy?: "reject" | "quarantine" | "allow_with_review";
  sourceSchemaVersion?: string;
  extraPayload?: Record<string, string>;
  acceptedResult?: ExecuteSourceMappingResult;
  authorityDomain?: string;
  humanCheckpoint?: "always" | "on_issue" | "none";
}): ExecuteSourceMappingResult {
  const identityField = sourceMapping.fieldMappings!.find(
    (field) => field.targetProperty === "benefits:person.external_id"
  )!;
  const nameField = sourceMapping.fieldMappings!.find(
    (field) => field.targetProperty === "benefits:person.display_name"
  )!;
  const mapping: OntologyPackSourceMapping = {
    ...structuredClone(sourceMapping),
    object: input.objectRef ?? sourceMapping.object,
    driftPolicy: input.driftPolicy ?? sourceMapping.driftPolicy,
    humanCheckpoint: input.humanCheckpoint ?? sourceMapping.humanCheckpoint,
    fieldMappings: [
      structuredClone(identityField),
      {
        ...structuredClone(nameField),
        authorityDomain: input.authorityDomain ?? nameField.authorityDomain,
        conflictPolicy: input.conflictPolicy,
      },
    ],
    targetIdentity: ["benefits:person.external_id"],
  };
  const payload = {
    messageId: input.recordKey,
    eventTime: "2026-08-29T10:00:00-07:00",
    observedTime: "2026-08-29T10:00:05-07:00",
    externalId: input.externalId ?? "AB-123",
    fullName: input.displayName,
    ...input.extraPayload,
  };
  return executeSourceMapping({
    mapping,
    envelope: envelope(payload, {
      sourceSystem: `source:${input.recordKey}`,
      sourceLocator: `source:${input.recordKey}/record`,
      sourceRecordKey: input.recordKey,
      sourceSchemaVersion: input.sourceSchemaVersion ?? "1.0.0",
      authorityRef: input.authorityRef,
    }),
    acceptedIdempotencyRecords: input.acceptedResult
      ? [
          {
            idempotencyKey: input.acceptedResult.receipt.idempotencyKey,
            sourcePayloadHash: input.acceptedResult.receipt.sourcePayloadHash,
            canonicalOutputHash:
              input.acceptedResult.receipt.canonicalOutputHash,
          },
        ]
      : undefined,
  });
}

function rehashReconciliationResult(result: ExecuteSourceMappingResult) {
  result.receipt.canonicalOutputHash = semanticHash(result.canonicalRecord);
  const { receiptHash: _receiptHash, ...receiptWithoutHash } = result.receipt;
  result.receipt.receiptHash = semanticHash(receiptWithoutHash);
  return result;
}

describe("source integration", () => {
  it("fails closed instead of throwing for a schema-valid descriptive mapping", () => {
    const descriptiveMapping: OntologyPackSourceMapping = {
      id: "benefits:legacy_csv_description",
      sourceType: "csv",
      sourceLocator: "synthetic://legacy-description",
      fields: "A:C",
      sheet: "",
      range: "",
      headers: "person_id,name,status",
      object: "benefits:person",
      properties: "external_id,display_name,case_status",
      transform: "legacy documentation only",
      authority: "legacy_owner",
      riskTier: "restricted",
      reviewStatus: "accepted",
    };

    const result = executeSourceMapping({
      mapping: descriptiveMapping,
      envelope: envelope(),
    });

    expect(result.receipt).toMatchObject({
      status: "rejected",
      humanReviewRequired: true,
      mappingId: "benefits:legacy_csv_description",
      mappingVersion: "",
      driftPolicy: "reject",
      lateArrivalPolicy: "reject",
    });
    expect(result.canonicalRecord).toEqual({
      objectRef: "benefits:person",
      identity: {},
      fields: [],
    });
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_mapping_not_executable",
          severity: "error",
        }),
        expect.objectContaining({
          code: "missing_target_identity_contract",
          severity: "error",
        }),
      ])
    );
  });

  it("maps deterministically with field-level provenance and verifiable hashes", () => {
    const sourceEnvelope = envelope();
    const originalInput = structuredClone({
      mapping: sourceMapping,
      envelope: sourceEnvelope,
    });

    const first = executeSourceMapping({
      mapping: sourceMapping,
      envelope: sourceEnvelope,
    });
    const reorderedMapping: OntologyPackSourceMapping = {
      ...structuredClone(sourceMapping),
      fieldMappings: [...sourceMapping.fieldMappings].reverse(),
      targetIdentity: [...sourceMapping.targetIdentity].reverse(),
    };
    const second = executeSourceMapping({
      mapping: reorderedMapping,
      envelope: structuredClone(sourceEnvelope),
    });

    expect(first).toEqual(second);
    expect({ mapping: sourceMapping, envelope: sourceEnvelope }).toEqual(
      originalInput
    );
    expect(first.receipt).toMatchObject({
      status: "mapped",
      mappingHash: canonicalMappingHash(sourceMapping),
      sourcePayloadHash: semanticHash(sourcePayload),
      lateArrival: false,
      duplicate: false,
      humanReviewRequired: false,
      issues: [],
    });
    expect(first.receipt.canonicalOutputHash).toBe(
      semanticHash(first.canonicalRecord)
    );

    const values = Object.fromEntries(
      first.canonicalRecord.fields.map((field) => [field.propertyRef, field.value])
    );
    expect(values).toEqual({
      "benefits:person.case_status": "alleged",
      "benefits:person.display_name": "Ada Lovelace",
      "benefits:person.eligibility_date": "2026-08-29T07:00:00.000Z",
      "benefits:person.external_id": "AB-123",
    });
    expect(first.canonicalRecord.identity).toEqual({
      "benefits:person.external_id": "AB-123",
    });

    const identityField = first.canonicalRecord.fields.find(
      (field) => field.propertyRef === "benefits:person.external_id"
    );
    expect(identityField?.provenance).toMatchObject({
      sourceSystem: "claimant-api",
      sourceLocator: "claimant-api/messages/message-001",
      sourceRecordKey: "message-001",
      sourceSchemaVersion: "1.0.0",
      sourcePath: "$.externalId",
      sourceValueHash: semanticHash(" ab-123 "),
      sourcePayloadHash: semanticHash(sourcePayload),
      mappingId: sourceMapping.id,
      mappingHash: canonicalMappingHash(sourceMapping),
      eventTime: "2026-08-29T10:00:00-07:00",
      observedTime: "2026-08-29T10:00:05-07:00",
      authenticationState: "authenticated",
      authorityRef: "authority:claimant",
      authorityDomain: "claimant_identity",
      dataClassification: "restricted_pii",
      purposeTags: ["benefit_adjudication", "case_review"],
      retentionPolicy: { schedule: "synthetic-seven-year" },
    });

    const { receiptHash, ...receiptWithoutHash } = first.receipt;
    expect(receiptHash).toBe(semanticHash(receiptWithoutHash));
  });

  it("quarantines drift and late arrivals, then recognizes an idempotent replay", () => {
    const driftedPayload = {
      ...sourcePayload,
      eventTime: "2026-08-28T10:00:00-07:00",
      unexpectedField: "schema-drift",
    };
    const driftedEnvelope = envelope(driftedPayload, {
      sourceSchemaVersion: "2.0.0",
    });
    const first = executeSourceMapping({
      mapping: sourceMapping,
      envelope: driftedEnvelope,
      latestAcceptedEventTime: "2026-08-29T00:00:00.000Z",
    });

    expect(first.receipt.status).toBe("quarantined");
    expect(first.receipt.lateArrival).toBe(true);
    expect(first.receipt.duplicate).toBe(false);
    expect(first.receipt.humanReviewRequired).toBe(true);
    expect(first.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "late_arrival",
          severity: "review",
        }),
        expect.objectContaining({
          code: "source_schema_version_mismatch",
          severity: "review",
        }),
        expect.objectContaining({
          code: "unmapped_source_fields",
          severity: "review",
        }),
      ])
    );

    const replay = executeSourceMapping({
      mapping: sourceMapping,
      envelope: driftedEnvelope,
      latestAcceptedEventTime: "2026-08-29T00:00:00.000Z",
      acceptedIdempotencyRecords: [
        {
          idempotencyKey: first.receipt.idempotencyKey,
          sourcePayloadHash: first.receipt.sourcePayloadHash,
          canonicalOutputHash: first.receipt.canonicalOutputHash,
        },
      ],
    });

    expect(replay.receipt).toMatchObject({
      status: "quarantined",
      duplicate: true,
      idempotencyKey: first.receipt.idempotencyKey,
      canonicalOutputHash: first.receipt.canonicalOutputHash,
    });
    expect(replay.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "exact_duplicate_source_record",
          severity: "warning",
        }),
      ])
    );

    const clean = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(),
    });
    const cleanReplay = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(),
      acceptedIdempotencyRecords: [
        {
          idempotencyKey: clean.receipt.idempotencyKey,
          sourcePayloadHash: clean.receipt.sourcePayloadHash,
          canonicalOutputHash: clean.receipt.canonicalOutputHash,
        },
      ],
    });
    expect(cleanReplay.receipt).toMatchObject({
      status: "duplicate",
      duplicate: true,
      idempotencyKey: clean.receipt.idempotencyKey,
      canonicalOutputHash: clean.receipt.canonicalOutputHash,
    });
  });

  it("rejects changed content that reuses an accepted idempotency key", () => {
    const first = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(),
    });
    const changedPayload = { ...sourcePayload, fullName: "Grace Hopper" };
    const conflict = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(changedPayload),
      acceptedIdempotencyRecords: [
        {
          idempotencyKey: first.receipt.idempotencyKey,
          sourcePayloadHash: first.receipt.sourcePayloadHash,
          canonicalOutputHash: first.receipt.canonicalOutputHash,
        },
      ],
    });

    expect(conflict.receipt).toMatchObject({
      status: "rejected",
      duplicate: true,
      idempotencyKey: first.receipt.idempotencyKey,
    });
    expect(conflict.receipt.sourcePayloadHash).not.toBe(
      first.receipt.sourcePayloadHash
    );
    expect(conflict.receipt.canonicalOutputHash).not.toBe(
      first.receipt.canonicalOutputHash
    );
    expect(conflict.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "conflicting_idempotency_key_reuse",
          severity: "error",
        }),
      ])
    );
  });

  it("quarantines a reused key when prior hashes are unavailable", () => {
    const first = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(),
    });
    const unverified = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(),
      seenIdempotencyKeys: [first.receipt.idempotencyKey],
    });

    expect(unverified.receipt).toMatchObject({
      status: "quarantined",
      duplicate: true,
      humanReviewRequired: true,
    });
    expect(unverified.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unverified_idempotency_key_reuse",
          severity: "review",
        }),
      ])
    );
  });

  it("rejects source drift and late arrivals when the mapping fails closed", () => {
    const rejectingMapping: OntologyPackSourceMapping = {
      ...sourceMapping,
      driftPolicy: "reject",
      lateArrivalPolicy: "reject",
    };
    const rejected = executeSourceMapping({
      mapping: rejectingMapping,
      envelope: envelope(
        {
          ...sourcePayload,
          eventTime: "2026-08-28T10:00:00-07:00",
          unexpectedField: "schema-drift",
        },
        { sourceSchemaVersion: "2.0.0" }
      ),
      latestAcceptedEventTime: "2026-08-29T00:00:00.000Z",
    });

    expect(rejected.receipt.status).toBe("rejected");
    expect(rejected.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "late_arrival",
          severity: "error",
        }),
        expect.objectContaining({
          code: "source_schema_version_mismatch",
          severity: "error",
        }),
        expect.objectContaining({
          code: "unmapped_source_fields",
          severity: "error",
        }),
      ])
    );
  });

  it("preserves review obligations for accept-with-review policies", () => {
    const reviewMapping: OntologyPackSourceMapping = {
      ...sourceMapping,
      driftPolicy: "allow_with_review",
      lateArrivalPolicy: "accept_with_review",
      humanCheckpoint: "none",
    };
    const payload = {
      ...sourcePayload,
      eventTime: "2026-08-28T10:00:00-07:00",
      newOptionalField: "schema-drift",
    };
    const result = executeSourceMapping({
      mapping: reviewMapping,
      envelope: envelope(payload),
      latestAcceptedEventTime: "2026-08-29T00:00:00.000Z",
    });

    expect(result.receipt).toMatchObject({
      status: "mapped",
      lateArrival: true,
      humanReviewRequired: true,
    });
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "late_arrival", severity: "warning" }),
        expect.objectContaining({
          code: "unmapped_source_fields",
          severity: "warning",
        }),
      ])
    );
  });

  it("maps an allowed source-schema mismatch but preserves required review", () => {
    const result = executeSourceMapping({
      mapping: { ...sourceMapping, driftPolicy: "allow_with_review" },
      envelope: envelope(sourcePayload, { sourceSchemaVersion: "2.0.0" }),
    });

    expect(result.receipt).toMatchObject({
      status: "mapped",
      humanReviewRequired: true,
    });
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_schema_version_mismatch",
          severity: "warning",
        }),
      ])
    );
  });

  it("rejects blank, nonfinite, or blank-fallback idempotency values", () => {
    const cases = [
      {
        mapping: sourceMapping,
        envelope: envelope({ ...sourcePayload, messageId: "   " }),
      },
      {
        mapping: sourceMapping,
        envelope: envelope({ ...sourcePayload, messageId: Number.NaN }),
      },
      {
        mapping: sourceMapping,
        envelope: envelope({ ...sourcePayload, messageId: {} }),
      },
      {
        mapping: sourceMapping,
        envelope: envelope({ ...sourcePayload, messageId: [] }),
      },
      {
        mapping: sourceMapping,
        envelope: envelope({ ...sourcePayload, messageId: { part: [] } }),
      },
      {
        mapping: {
          ...sourceMapping,
          replayable: false,
          idempotencyPath: undefined,
        },
        envelope: envelope(sourcePayload, { sourceRecordKey: "   " }),
      },
    ];

    for (const input of cases) {
      const result = executeSourceMapping(input);
      expect(result.receipt.status).toBe("rejected");
      expect(result.receipt.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "missing_idempotency_value",
            severity: "error",
          }),
        ])
      );
    }
  });

  it("rejects timezone-less source and watermark timestamps", () => {
    const timezoneLessPayload = {
      ...sourcePayload,
      eventTime: "2026-08-29T10:00:00",
      observedTime: "2026-08-29T10:00:05",
    };
    const result = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(timezoneLessPayload),
      latestAcceptedEventTime: "2026-08-29T09:00:00",
    });

    expect(result.receipt.status).toBe("rejected");
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_event_time", severity: "error" }),
        expect.objectContaining({
          code: "invalid_observed_time",
          severity: "error",
        }),
        expect.objectContaining({
          code: "invalid_latest_accepted_event_time",
          severity: "error",
        }),
      ])
    );
  });

  it("rejects a supplied blank event-time watermark", () => {
    const result = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(),
      latestAcceptedEventTime: "",
    });

    expect(result.receipt.status).toBe("rejected");
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_latest_accepted_event_time",
          severity: "error",
        }),
      ])
    );
  });

  it("rejects calendar-overflow source timestamps", () => {
    const invalidPayload = {
      ...sourcePayload,
      eventTime: "2026-02-30T10:00:00Z",
      observedTime: "2026-08-29T24:00:00Z",
    };
    const result = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(invalidPayload),
    });

    expect(result.receipt.status).toBe("rejected");
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_event_time", severity: "error" }),
        expect.objectContaining({
          code: "invalid_observed_time",
          severity: "error",
        }),
      ])
    );
  });

  it("rejects tampered content and missing required fields without hiding them as duplicates", () => {
    const tamperedPayload = { ...sourcePayload };
    delete (tamperedPayload as Partial<typeof sourcePayload>).externalId;
    const rejected = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(tamperedPayload, {
        contentHash: semanticHash({ ...tamperedPayload, injected: true }),
      }),
      seenIdempotencyKeys: [
        executeSourceMapping({
          mapping: sourceMapping,
          envelope: envelope(tamperedPayload),
        }).receipt.idempotencyKey,
      ],
    });

    expect(rejected.receipt).toMatchObject({
      status: "rejected",
      duplicate: true,
      humanReviewRequired: true,
    });
    expect(rejected.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_content_hash_mismatch",
          severity: "error",
        }),
        expect.objectContaining({
          code: "missing_required_source_field",
          severity: "error",
          targetProperty: "benefits:person.external_id",
        }),
      ])
    );
  });

  it("rejects an explicitly supplied blank content hash", () => {
    const result = executeSourceMapping({
      mapping: sourceMapping,
      envelope: envelope(sourcePayload, { contentHash: "" }),
    });

    expect(result.receipt.status).toBe("rejected");
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_content_hash_mismatch",
          severity: "error",
        }),
      ])
    );
  });

  it("rejects duplicate canonical targets without selecting an identity value", () => {
    const duplicateMapping: OntologyPackSourceMapping = {
      ...structuredClone(sourceMapping),
      fieldMappings: [
        ...sourceMapping.fieldMappings!,
        {
          ...sourceMapping.fieldMappings!.find(
            (field) => field.targetProperty === "benefits:person.external_id"
          )!,
          sourcePath: "$.alternateExternalId",
        },
      ],
    };
    const payload = { ...sourcePayload, alternateExternalId: "AB-999" };
    const result = executeSourceMapping({
      mapping: duplicateMapping,
      envelope: envelope(payload),
    });

    expect(result.receipt.status).toBe("rejected");
    expect(result.canonicalRecord.identity).toEqual({});
    expect(
      result.canonicalRecord.fields.some(
        (field) => field.propertyRef === "benefits:person.external_id"
      )
    ).toBe(false);
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_target_property_mapping",
          severity: "error",
        }),
        expect.objectContaining({
          code: "target_identity_not_exactly_mapped",
          severity: "error",
        }),
        expect.objectContaining({
          code: "missing_target_identity_value",
          severity: "error",
        }),
      ])
    );
  });

  it("rejects alias-mismatched identity references instead of returning empty identity", () => {
    const aliasMapping: OntologyPackSourceMapping = {
      ...structuredClone(sourceMapping),
      targetIdentity: ["external_id"],
    };
    const result = executeSourceMapping({
      mapping: aliasMapping,
      envelope: envelope(),
    });

    expect(result.receipt.status).toBe("rejected");
    expect(result.canonicalRecord.identity).toEqual({});
    expect(result.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "target_identity_not_exactly_mapped",
          severity: "error",
        }),
        expect.objectContaining({
          code: "missing_target_identity_value",
          severity: "error",
        }),
      ])
    );
  });

  it("rejects malformed and duplicate raw identity contracts", () => {
    const malformedMapping = {
      ...structuredClone(sourceMapping),
      targetIdentity: ["benefits:person.external_id", ""],
    } as OntologyPackSourceMapping;
    const duplicateMapping = {
      ...structuredClone(sourceMapping),
      targetIdentity: [
        "benefits:person.external_id",
        "benefits:person.external_id",
      ],
    } as OntologyPackSourceMapping;

    const malformed = executeSourceMapping({
      mapping: malformedMapping,
      envelope: envelope(),
    });
    const duplicate = executeSourceMapping({
      mapping: duplicateMapping,
      envelope: envelope(),
    });

    expect(malformed.receipt).toMatchObject({ status: "rejected" });
    expect(malformed.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_target_identity_contract" }),
      ])
    );
    expect(duplicate.receipt).toMatchObject({ status: "rejected" });
    expect(duplicate.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_target_identity_property",
        }),
      ])
    );
  });

  it("rejects null and blank canonical identity values after normalization", () => {
    for (const invalidIdentity of [null, "", "   "] as const) {
      const payload = { ...sourcePayload, externalId: invalidIdentity };
      const result = executeSourceMapping({
        mapping: sourceMapping,
        envelope: envelope(payload),
      });

      expect(result.receipt.status).toBe("rejected");
      expect(result.canonicalRecord.identity).toEqual({});
      expect(result.receipt.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid_target_identity_value",
            severity: "error",
            targetProperty: "benefits:person.external_id",
          }),
        ])
      );
    }
  });

  it("detects nested source drift and lets an explicit root mapping cover descendants", () => {
    const nestedMapping: OntologyPackSourceMapping = {
      ...structuredClone(sourceMapping),
      driftPolicy: "reject",
      fieldMappings: sourceMapping.fieldMappings!.map((field) =>
        field.targetProperty === "benefits:person.display_name"
          ? { ...field, sourcePath: "$.profile.fullName" }
          : field
      ),
    };
    const { fullName: _fullName, ...basePayload } = sourcePayload;
    const nestedPayload = {
      ...basePayload,
      profile: { fullName: "Ada Lovelace", unexpectedSibling: "drift" },
    };
    const nested = executeSourceMapping({
      mapping: nestedMapping,
      envelope: envelope(nestedPayload),
    });
    expect(nested.receipt.status).toBe("rejected");
    expect(nested.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unmapped_source_fields",
          severity: "error",
          message: expect.stringContaining("$.profile.unexpectedSibling"),
        }),
      ])
    );

    const rootMapping: OntologyPackSourceMapping = {
      ...structuredClone(sourceMapping),
      driftPolicy: "reject",
      fieldMappings: sourceMapping.fieldMappings!.map((field) =>
        field.targetProperty === "benefits:person.display_name"
          ? { ...field, sourcePath: "$", normalizations: [] }
          : field
      ),
    };
    const root = executeSourceMapping({
      mapping: rootMapping,
      envelope: envelope({ ...sourcePayload, newlyAdded: { nested: true } }),
    });
    expect(root.receipt.status).toBe("mapped");
    expect(
      root.receipt.issues.some((item) => item.code === "unmapped_source_fields")
    ).toBe(false);

    const collisionMapping: OntologyPackSourceMapping = {
      ...structuredClone(nestedMapping),
      fieldMappings: nestedMapping.fieldMappings!.map((field) =>
        field.targetProperty === "benefits:person.display_name"
          ? { ...field, required: false }
          : field
      ),
    };
    const collisionPayload = {
      ...basePayload,
      "profile.fullName": "unaddressable-key-collision",
    };
    const collision = executeSourceMapping({
      mapping: collisionMapping,
      envelope: envelope(collisionPayload),
    });
    expect(collision.receipt.status).toBe("rejected");
    expect(collision.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unmapped_source_fields",
          severity: "error",
          message: expect.stringContaining('$["profile.fullName"]'),
        }),
      ])
    );

    const rootControlMapping: OntologyPackSourceMapping = {
      ...structuredClone(sourceMapping),
      driftPolicy: "reject",
      idempotencyPath: "$",
    };
    const rootControl = executeSourceMapping({
      mapping: rootControlMapping,
      envelope: envelope({
        ...sourcePayload,
        unexpected: { secret: "must-not-be-covered-by-control-path" },
      }),
    });
    expect(rootControl.receipt.status).toBe("rejected");
    expect(rootControl.receipt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_control_source_path",
          severity: "error",
          sourcePath: "$",
        }),
        expect.objectContaining({
          code: "unmapped_source_fields",
          severity: "error",
          message: expect.stringContaining("$.unexpected.secret"),
        }),
      ])
    );
  });
});

describe("canonical record reconciliation", () => {
  function field(
    proposal: ReturnType<typeof reconcileCanonicalRecords>,
    propertyRef = "benefits:person.display_name"
  ) {
    return proposal.fields.find(
      (candidate) => candidate.propertyRef === propertyRef
    )!;
  }

  it("coalesces equal values with all provenance deterministically without mutating inputs", () => {
    const master = reconciliationResult({
      recordKey: "master-1",
      authorityRef: "authority:master",
      displayName: " Ada   Lovelace ",
      conflictPolicy: "prefer_authority",
    });
    const secondary = reconciliationResult({
      recordKey: "secondary-1",
      authorityRef: "authority:secondary",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });
    const input = {
      results: [master, secondary],
      authorityPolicy: structuredClone(reconciliationAuthorityPolicy),
    };
    const original = structuredClone(input);

    const first = reconcileCanonicalRecords(input);
    const reordered = reconcileCanonicalRecords({
      ...input,
      results: [...input.results].reverse(),
    });

    expect(first).toEqual(reordered);
    expect(input).toEqual(original);
    expect(first).toMatchObject({
      proposalVersion: "t2k.canonical-reconciliation-proposal.v1",
      status: "proposed",
      objectRef: "benefits:person",
      identity: { "benefits:person.external_id": "AB-123" },
      policyId: reconciliationAuthorityPolicy.policyId,
      policyVersion: reconciliationAuthorityPolicy.policyVersion,
      policyHash: semanticHash(reconciliationAuthorityPolicy),
      humanReviewRequired: false,
      nonMutating: true,
      alternativesPreserved: true,
      issues: [],
    });
    expect(field(first)).toMatchObject({
      status: "selected",
      resolution: "single_value",
      selectedValue: "Ada Lovelace",
    });
    expect(field(first).candidates).toHaveLength(1);
    expect(field(first).candidates[0].evidence).toHaveLength(2);
    expect(
      field(first).candidates[0].evidence.map(
        (evidence) => evidence.receiptAuthorityRef
      )
    ).toEqual(["authority:master", "authority:secondary"]);
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    const { proposalHash, ...proposalWithoutHash } = first;
    expect(proposalHash).toBe(semanticHash(proposalWithoutHash));
  });

  it("rejects an invalid authority policy or an empty mapped-evidence set", () => {
    const result = reconciliationResult({
      recordKey: "invalid-policy",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });
    const invalidPolicy = reconcileCanonicalRecords({
      results: [result],
      authorityPolicy: {
        policyId: " ",
        policyVersion: "1.0.0",
        prioritiesByDomain: {},
      },
    });
    const empty = reconcileCanonicalRecords({
      results: [],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(invalidPolicy.status).toBe("rejected");
    expect(invalidPolicy.fields.every((candidate) => candidate.selectedValue === null)).toBe(
      true
    );
    expect(invalidPolicy.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_authority_policy" }),
      ])
    );
    expect(empty).toMatchObject({
      status: "rejected",
      objectRef: "",
      identity: {},
      fields: [],
      humanReviewRequired: true,
    });
    expect(empty.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "no_mapped_source_evidence" }),
      ])
    );
  });

  it("fails closed without throwing for malformed serialized shapes", () => {
    const valid = reconciliationResult({
      recordKey: "malformed-shape-control",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });
    const malformedFieldRecord = structuredClone(valid.canonicalRecord) as unknown as {
      objectRef: string;
      identity: Record<string, unknown>;
      fields: unknown[];
    };
    malformedFieldRecord.fields = [null];
    const cases: Array<{
      name: string;
      input: unknown;
      issueCode: string;
    }> = [
      {
        name: "input",
        input: null,
        issueCode: "malformed_reconciliation_input",
      },
      {
        name: "results",
        input: {
          results: null,
          authorityPolicy: reconciliationAuthorityPolicy,
        },
        issueCode: "malformed_reconciliation_results",
      },
      {
        name: "result",
        input: {
          results: [null],
          authorityPolicy: reconciliationAuthorityPolicy,
        },
        issueCode: "malformed_source_result",
      },
      {
        name: "receipt",
        input: {
          results: [{ receipt: null, canonicalRecord: valid.canonicalRecord }],
          authorityPolicy: reconciliationAuthorityPolicy,
        },
        issueCode: "malformed_source_receipt",
      },
      {
        name: "record",
        input: {
          results: [{ receipt: valid.receipt, canonicalRecord: null }],
          authorityPolicy: reconciliationAuthorityPolicy,
        },
        issueCode: "malformed_canonical_record",
      },
      {
        name: "field",
        input: {
          results: [
            {
              receipt: valid.receipt,
              canonicalRecord: malformedFieldRecord,
            },
          ],
          authorityPolicy: reconciliationAuthorityPolicy,
        },
        issueCode: "malformed_canonical_record",
      },
    ];

    for (const item of cases) {
      let proposal: ReturnType<typeof reconcileCanonicalRecords> | undefined;
      expect(
        () =>
          (proposal = reconcileCanonicalRecords(
            item.input as Parameters<typeof reconcileCanonicalRecords>[0]
          )),
        item.name
      ).not.toThrow();
      expect(proposal?.status, item.name).toBe("rejected");
      expect(
        proposal?.issues.some((issue) => issue.code === item.issueCode),
        item.name
      ).toBe(true);
    }
  });

  it("rejects invalid authority-priority arrays", () => {
    const result = reconciliationResult({
      recordKey: "invalid-priorities",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });
    const invalidPriorities: unknown[] = [
      [],
      ["authority:master", "authority:master"],
      ["authority:master", 7],
      [" "],
    ];

    for (const priorities of invalidPriorities) {
      const proposal = reconcileCanonicalRecords({
        results: [result],
        authorityPolicy: {
          ...reconciliationAuthorityPolicy,
          prioritiesByDomain: {
            claimant_identity: priorities,
          },
        } as CanonicalAuthorityPolicy,
      });

      expect(proposal.status).toBe("rejected");
      expect(proposal.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "invalid_authority_priority" }),
        ])
      );
      expect(
        proposal.fields.every((candidate) => candidate.selectedValue === null)
      ).toBe(true);
    }
  });

  it("rejects cross-bound provenance forgery even after hashes are recomputed", () => {
    type FieldProvenance =
      ExecuteSourceMappingResult["canonicalRecord"]["fields"][number]["provenance"];
    const mismatches: Array<{
      name: string;
      replacement: Partial<FieldProvenance>;
    }> = [
      { name: "sourceSystem", replacement: { sourceSystem: "forged:source" } },
      {
        name: "sourceLocator",
        replacement: { sourceLocator: "forged://record" },
      },
      {
        name: "sourceRecordKey",
        replacement: { sourceRecordKey: "forged-record" },
      },
      {
        name: "sourceSchemaVersion",
        replacement: { sourceSchemaVersion: "9.9.9" },
      },
      {
        name: "sourcePayloadHash",
        replacement: { sourcePayloadHash: semanticHash("forged-payload") },
      },
      { name: "mappingId", replacement: { mappingId: "forged:mapping" } },
      {
        name: "mappingHash",
        replacement: { mappingHash: semanticHash("forged-mapping") },
      },
      {
        name: "eventTime",
        replacement: { eventTime: "2026-08-30T17:00:00.000Z" },
      },
      {
        name: "observedTime",
        replacement: { observedTime: "2026-08-30T17:00:05.000Z" },
      },
      {
        name: "authenticationState",
        replacement: { authenticationState: "system_asserted" },
      },
      {
        name: "authorityRef",
        replacement: { authorityRef: "authority:forged" },
      },
      {
        name: "dataClassification",
        replacement: { dataClassification: "public" },
      },
      {
        name: "purposeTags",
        replacement: { purposeTags: ["forged_purpose"] },
      },
      {
        name: "retentionPolicy",
        replacement: { retentionPolicy: { schedule: "forged" } },
      },
    ];

    for (const mismatch of mismatches) {
      const forged = structuredClone(
        reconciliationResult({
          recordKey: `forged-${mismatch.name}`,
          authorityRef: "authority:master",
          displayName: "Ada Lovelace",
          conflictPolicy: "prefer_authority",
        })
      );
      const displayNameField = forged.canonicalRecord.fields.find(
        (candidate) =>
          candidate.propertyRef === "benefits:person.display_name"
      )!;
      Object.assign(displayNameField.provenance, mismatch.replacement);
      rehashReconciliationResult(forged);

      const proposal = reconcileCanonicalRecords({
        results: [forged],
        authorityPolicy: reconciliationAuthorityPolicy,
      });

      expect(proposal.status, mismatch.name).toBe("rejected");
      expect(proposal.includedReceiptHashes, mismatch.name).toEqual([]);
      expect(
        proposal.issues.some(
          (issue) => issue.code === "source_field_provenance_mismatch"
        ),
        mismatch.name
      ).toBe(true);
    }

    const reorderedTags = structuredClone(
      reconciliationResult({
        recordKey: "semantic-purpose-tags",
        authorityRef: "authority:master",
        displayName: "Ada Lovelace",
        conflictPolicy: "prefer_authority",
      })
    );
    for (const candidate of reorderedTags.canonicalRecord.fields) {
      candidate.provenance.purposeTags.reverse();
    }
    rehashReconciliationResult(reorderedTags);
    expect(
      reconcileCanonicalRecords({
        results: [reorderedTags],
        authorityPolicy: reconciliationAuthorityPolicy,
      }).status
    ).toBe("proposed");
  });

  it("requires exactly one identity field equal to each identity value", () => {
    const identityProperty = "benefits:person.external_id";
    const base = reconciliationResult({
      recordKey: "identity-contract",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });
    const missing = structuredClone(base);
    missing.canonicalRecord.fields = missing.canonicalRecord.fields.filter(
      (candidate) => candidate.propertyRef !== identityProperty
    );
    const duplicate = structuredClone(base);
    duplicate.canonicalRecord.fields.push(
      structuredClone(
        duplicate.canonicalRecord.fields.find(
          (candidate) => candidate.propertyRef === identityProperty
        )!
      )
    );
    const contradictory = structuredClone(base);
    contradictory.canonicalRecord.fields.find(
      (candidate) => candidate.propertyRef === identityProperty
    )!.value = "OTHER-999";

    for (const [result, issueCode] of [
      [missing, "missing_canonical_identity_field"],
      [duplicate, "duplicate_canonical_identity_field"],
      [contradictory, "contradictory_canonical_identity_field"],
    ] as const) {
      rehashReconciliationResult(result);
      const proposal = reconcileCanonicalRecords({
        results: [result],
        authorityPolicy: reconciliationAuthorityPolicy,
      });

      expect(proposal.status).toBe("rejected");
      expect(proposal.includedReceiptHashes).toEqual([]);
      expect(proposal.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: issueCode })])
      );
    }
  });

  it("rejects duplicate non-identity fields even after hashes are recomputed", () => {
    const duplicate = structuredClone(
      reconciliationResult({
        recordKey: "duplicate-non-identity-field",
        authorityRef: "authority:master",
        displayName: "Ada Lovelace",
        conflictPolicy: "preserve_all",
      })
    );
    const displayNameField = duplicate.canonicalRecord.fields.find(
      (candidate) => candidate.propertyRef === "benefits:person.display_name"
    )!;
    duplicate.canonicalRecord.fields.push({
      ...structuredClone(displayNameField),
      value: "Augusta Ada King",
    });
    rehashReconciliationResult(duplicate);

    const proposal = reconcileCanonicalRecords({
      results: [duplicate],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("rejected");
    expect(proposal.includedReceiptHashes).toEqual([]);
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_canonical_field",
          propertyRef: "benefits:person.display_name",
        }),
      ])
    );
  });

  it("preserves conflicting values without inventing a winner", () => {
    const proposal = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "preserve-a",
          authorityRef: "authority:master",
          displayName: "Ada Lovelace",
          conflictPolicy: "preserve_all",
        }),
        reconciliationResult({
          recordKey: "preserve-b",
          authorityRef: "authority:secondary",
          displayName: "Augusta Ada King",
          conflictPolicy: "preserve_all",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal).toMatchObject({
      status: "proposed",
      humanReviewRequired: false,
    });
    expect(field(proposal)).toMatchObject({
      conflictPolicy: "preserve_all",
      status: "preserved",
      resolution: "preserve_all",
      selectedValue: null,
      selectedValueHash: null,
    });
    expect(field(proposal).candidates).toHaveLength(2);
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "conflicting_values_preserved",
          severity: "warning",
        }),
      ])
    );
  });

  it("routes require-review conflicts without selecting a value", () => {
    const proposal = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "review-a",
          authorityRef: "authority:master",
          displayName: "Ada Lovelace",
          conflictPolicy: "require_review",
        }),
        reconciliationResult({
          recordKey: "review-b",
          authorityRef: "authority:secondary",
          displayName: "Augusta Ada King",
          conflictPolicy: "require_review",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal).toMatchObject({
      status: "needs_review",
      humanReviewRequired: true,
    });
    expect(field(proposal)).toMatchObject({
      conflictPolicy: "require_review",
      status: "needs_review",
      resolution: "unresolved",
      selectedValue: null,
    });
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "conflicting_values_require_review",
          severity: "review",
        }),
      ])
    );
  });

  it("selects only one value backed by the unique highest-ranked authority", () => {
    const proposal = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "authority-secondary",
          authorityRef: "authority:secondary",
          displayName: "Secondary Name",
          conflictPolicy: "prefer_authority",
        }),
        reconciliationResult({
          recordKey: "authority-master",
          authorityRef: "authority:master",
          displayName: "Master Name",
          conflictPolicy: "prefer_authority",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("proposed");
    expect(field(proposal)).toMatchObject({
      status: "selected",
      resolution: "preferred_authority",
      selectedValue: "Master Name",
      selectedValueHash: semanticHash("Master Name"),
    });
    expect(field(proposal).candidates).toHaveLength(2);
  });

  it("leaves authority conflicts unresolved when priorities are missing or tied", () => {
    const first = reconciliationResult({
      recordKey: "missing-a",
      authorityRef: "authority:master",
      displayName: "Name A",
      conflictPolicy: "prefer_authority",
    });
    const second = reconciliationResult({
      recordKey: "missing-b",
      authorityRef: "authority:secondary",
      displayName: "Name B",
      conflictPolicy: "prefer_authority",
    });
    const missing = reconcileCanonicalRecords({
      results: [first, second],
      authorityPolicy: {
        ...reconciliationAuthorityPolicy,
        prioritiesByDomain: {},
      },
    });
    const tied = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "tie-a",
          authorityRef: "authority:master",
          displayName: "Name A",
          conflictPolicy: "prefer_authority",
        }),
        reconciliationResult({
          recordKey: "tie-b",
          authorityRef: "authority:master",
          displayName: "Name B",
          conflictPolicy: "prefer_authority",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(field(missing).selectedValue).toBeNull();
    expect(missing.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_authority_priority" }),
      ])
    );
    expect(field(tied).selectedValue).toBeNull();
    expect(tied.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "authority_priority_tie" }),
      ])
    );
    expect(missing.status).toBe("needs_review");
    expect(tied.status).toBe("needs_review");
  });

  it("does not rank values across mixed authority domains", () => {
    const proposal = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "mixed-domain-a",
          authorityRef: "authority:master",
          authorityDomain: "claimant_identity",
          displayName: "Name A",
          conflictPolicy: "prefer_authority",
        }),
        reconciliationResult({
          recordKey: "mixed-domain-b",
          authorityRef: "authority:secondary",
          authorityDomain: "alternate_identity",
          displayName: "Name B",
          conflictPolicy: "prefer_authority",
        }),
      ],
      authorityPolicy: {
        ...reconciliationAuthorityPolicy,
        prioritiesByDomain: {
          claimant_identity: ["authority:master", "authority:secondary"],
          alternate_identity: ["authority:secondary", "authority:master"],
        },
      },
    });

    expect(proposal.status).toBe("needs_review");
    expect(field(proposal)).toMatchObject({
      status: "needs_review",
      resolution: "unresolved",
      selectedValue: null,
    });
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "mixed_authority_domains" }),
      ])
    );
  });

  it("leaves conflicts unresolved when no evidence has a ranked authority", () => {
    const proposal = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "unranked-a",
          authorityRef: "authority:unranked-a",
          displayName: "Name A",
          conflictPolicy: "prefer_authority",
        }),
        reconciliationResult({
          recordKey: "unranked-b",
          authorityRef: "authority:unranked-b",
          displayName: "Name B",
          conflictPolicy: "prefer_authority",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("needs_review");
    expect(field(proposal).selectedValue).toBeNull();
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "no_ranked_authority_evidence" }),
      ])
    );
  });

  it("preserves upstream review obligations on mapped evidence", () => {
    const upstreamReview = reconciliationResult({
      recordKey: "upstream-review",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
      humanCheckpoint: "always",
    });
    expect(upstreamReview.receipt).toMatchObject({
      status: "mapped",
      humanReviewRequired: true,
    });

    const proposal = reconcileCanonicalRecords({
      results: [upstreamReview],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal).toMatchObject({
      status: "needs_review",
      humanReviewRequired: true,
    });
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mapped_source_evidence_requires_review",
        }),
      ])
    );
  });

  it("fails closed when source mappings assert mixed conflict policies", () => {
    const proposal = reconcileCanonicalRecords({
      results: [
        reconciliationResult({
          recordKey: "mixed-a",
          authorityRef: "authority:master",
          displayName: "Name A",
          conflictPolicy: "preserve_all",
        }),
        reconciliationResult({
          recordKey: "mixed-b",
          authorityRef: "authority:secondary",
          displayName: "Name B",
          conflictPolicy: "require_review",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("rejected");
    expect(proposal.humanReviewRequired).toBe(true);
    expect(proposal.fields.every((candidate) => candidate.selectedValue === null)).toBe(
      true
    );
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mixed_field_conflict_policies",
          severity: "error",
        }),
      ])
    );
  });

  it("verifies receipt and canonical-output hashes before using evidence", () => {
    const valid = reconciliationResult({
      recordKey: "integrity-valid",
      authorityRef: "authority:master",
      displayName: "Valid Name",
      conflictPolicy: "prefer_authority",
    });
    const canonicalTamper = structuredClone(
      reconciliationResult({
        recordKey: "integrity-canonical",
        authorityRef: "authority:secondary",
        displayName: "Original Name",
        conflictPolicy: "prefer_authority",
      })
    );
    canonicalTamper.canonicalRecord.fields[0].value = "Tampered Name";
    const receiptTamper = structuredClone(
      reconciliationResult({
        recordKey: "integrity-receipt",
        authorityRef: "authority:secondary",
        displayName: "Receipt Name",
        conflictPolicy: "prefer_authority",
      })
    );
    receiptTamper.receipt.humanReviewRequired =
      !receiptTamper.receipt.humanReviewRequired;

    const proposal = reconcileCanonicalRecords({
      results: [valid, canonicalTamper, receiptTamper],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("rejected");
    expect(proposal.includedReceiptHashes).toEqual([valid.receipt.receiptHash]);
    expect(proposal.fields.every((candidate) => candidate.selectedValue === null)).toBe(
      true
    );
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_canonical_output_hash" }),
        expect.objectContaining({ code: "invalid_source_receipt_hash" }),
      ])
    );
  });

  it("requires exact canonical object and identity agreement", () => {
    const base = reconciliationResult({
      recordKey: "agreement-base",
      authorityRef: "authority:master",
      displayName: "Name A",
      conflictPolicy: "prefer_authority",
    });
    const objectMismatch = reconcileCanonicalRecords({
      results: [
        base,
        reconciliationResult({
          recordKey: "agreement-object",
          authorityRef: "authority:secondary",
          displayName: "Name B",
          conflictPolicy: "prefer_authority",
          objectRef: "benefits:other-person",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });
    const identityMismatch = reconcileCanonicalRecords({
      results: [
        base,
        reconciliationResult({
          recordKey: "agreement-identity",
          authorityRef: "authority:secondary",
          displayName: "Name B",
          conflictPolicy: "prefer_authority",
          externalId: "OTHER-999",
        }),
      ],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(objectMismatch).toMatchObject({ status: "rejected", objectRef: "" });
    expect(objectMismatch.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "canonical_object_mismatch" }),
      ])
    );
    expect(identityMismatch).toMatchObject({ status: "rejected", identity: {} });
    expect(identityMismatch.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "canonical_identity_mismatch" }),
      ])
    );
    expect(
      [...objectMismatch.fields, ...identityMismatch.fields].every(
        (candidate) => candidate.selectedValue === null
      )
    ).toBe(true);
  });

  it("excludes quarantined and rejected inputs so they cannot win", () => {
    const accepted = reconciliationResult({
      recordKey: "accepted-evidence",
      authorityRef: "authority:secondary",
      displayName: "Accepted Name",
      conflictPolicy: "prefer_authority",
    });
    const quarantined = reconciliationResult({
      recordKey: "quarantined-evidence",
      authorityRef: "authority:master",
      displayName: "Quarantined Name",
      conflictPolicy: "prefer_authority",
      sourceSchemaVersion: "2.0.0",
    });
    const rejected = reconciliationResult({
      recordKey: "rejected-evidence",
      authorityRef: "authority:master",
      displayName: "Rejected Name",
      conflictPolicy: "prefer_authority",
      sourceSchemaVersion: "2.0.0",
      driftPolicy: "reject",
    });
    expect(quarantined.receipt.status).toBe("quarantined");
    expect(rejected.receipt.status).toBe("rejected");

    const proposal = reconcileCanonicalRecords({
      results: [accepted, quarantined, rejected],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("needs_review");
    expect(proposal.includedReceiptHashes).toEqual([accepted.receipt.receiptHash]);
    expect(field(proposal)).toMatchObject({
      selectedValue: "Accepted Name",
      resolution: "single_value",
    });
    expect(field(proposal).candidates).toHaveLength(1);
    expect(proposal.issues.filter((issue) => issue.code === "unaccepted_source_evidence_excluded")).toHaveLength(
      2
    );
  });

  it("excludes exact duplicate receipts with a deterministic warning", () => {
    const first = reconciliationResult({
      recordKey: "duplicate-evidence",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });
    const duplicate = reconciliationResult({
      recordKey: "duplicate-evidence",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
      acceptedResult: first,
    });
    expect(duplicate.receipt.status).toBe("duplicate");

    const proposal = reconcileCanonicalRecords({
      results: [duplicate, first],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal.status).toBe("proposed");
    expect(proposal.humanReviewRequired).toBe(false);
    expect(proposal.includedReceiptHashes).toEqual([first.receipt.receiptHash]);
    expect(field(proposal).candidates[0].evidence).toHaveLength(1);
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_source_evidence_excluded",
          severity: "warning",
        }),
      ])
    );
  });

  it("counts a repeated mapped receipt only once", () => {
    const mapped = reconciliationResult({
      recordKey: "repeated-mapped-receipt",
      authorityRef: "authority:master",
      displayName: "Ada Lovelace",
      conflictPolicy: "prefer_authority",
    });

    const proposal = reconcileCanonicalRecords({
      results: [mapped, mapped],
      authorityPolicy: reconciliationAuthorityPolicy,
    });

    expect(proposal).toMatchObject({
      status: "proposed",
      humanReviewRequired: false,
      includedReceiptHashes: [mapped.receipt.receiptHash],
    });
    expect(proposal.inputReceiptHashes).toEqual([
      mapped.receipt.receiptHash,
      mapped.receipt.receiptHash,
    ]);
    expect(field(proposal).candidates[0].evidence).toHaveLength(1);
    expect(proposal.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "repeated_input_receipt_excluded",
          severity: "warning",
        }),
      ])
    );
  });
});

describe("entity resolution", () => {
  const rules = [
    {
      identifier: "beneficiary_id",
      weight: 0.7,
      requiredForAutomaticMatch: true,
      caseInsensitive: true,
    },
    { identifier: "birth_date", weight: 0.3 },
  ];

  it("automatically selects one unambiguous candidate without mutating entities", () => {
    const input = {
      sourceEntityKey: "source:person-1",
      identifiers: {
        beneficiary_id: " AB-123 ",
        birth_date: "1980-01-02",
      },
      candidates: [
        {
          entityKey: "canonical:partial",
          identifiers: {
            beneficiary_id: "different",
            birth_date: "1980-01-02",
          },
        },
        {
          entityKey: "canonical:ada",
          identifiers: {
            beneficiary_id: "ab-123",
            birth_date: "1980-01-02",
          },
        },
      ],
      rules,
    };
    const original = structuredClone(input);

    const decision = resolveEntityCandidates(input);
    const reordered = resolveEntityCandidates({
      ...input,
      candidates: [...input.candidates].reverse(),
      rules: [...input.rules].reverse(),
    });

    expect(decision).toEqual(reordered);
    expect(input).toEqual(original);
    expect(decision).toMatchObject({
      status: "matched",
      targetEntityKey: "canonical:ada",
      humanReviewRequired: false,
      reversible: true,
      thresholds: {
        automaticMatch: 0.9,
        review: 0.5,
        ambiguityMargin: 0.1,
      },
    });
    expect(decision.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decision.rulesHash).toBe(
      semanticHash(
        [...rules].sort(
          (left, right) =>
            compareCanonicalStrings(left.identifier, right.identifier) ||
            compareCanonicalStrings(
              JSON.stringify(left),
              JSON.stringify(right)
            )
        )
      )
    );
    const { decisionHash, ...decisionWithoutHash } = decision;
    expect(decisionHash).toBe(semanticHash(decisionWithoutHash));
  });

  it("routes equally strong candidates to review instead of silently merging", () => {
    const decision = resolveEntityCandidates({
      sourceEntityKey: "source:person-ambiguous",
      identifiers: {
        beneficiary_id: "AB-123",
        birth_date: "1980-01-02",
      },
      candidates: [
        {
          entityKey: "canonical:b",
          identifiers: {
            beneficiary_id: "AB-123",
            birth_date: "1980-01-02",
          },
        },
        {
          entityKey: "canonical:a",
          identifiers: {
            beneficiary_id: "AB-123",
            birth_date: "1980-01-02",
          },
        },
      ],
      rules,
    });

    expect(decision).toMatchObject({
      status: "needs_review",
      targetEntityKey: "canonical:a",
      humanReviewRequired: true,
      reversible: true,
    });
    expect(decision.candidates.map((candidate) => candidate.entityKey)).toEqual([
      "canonical:a",
      "canonical:b",
    ]);
  });

  it("proposes a new entity when no candidate clears the review threshold", () => {
    const decision = resolveEntityCandidates({
      sourceEntityKey: "source:new-person",
      identifiers: {
        beneficiary_id: "NEW-999",
        birth_date: "1999-09-09",
      },
      candidates: [
        {
          entityKey: "canonical:other",
          identifiers: {
            beneficiary_id: "OLD-111",
            birth_date: "1970-01-01",
          },
        },
      ],
      rules,
    });

    expect(decision).toMatchObject({
      status: "new_entity",
      targetEntityKey: null,
      humanReviewRequired: true,
      reversible: true,
    });
    expect(decision.candidates[0]?.score).toBe(0);
  });

  it("does not treat null or blank identifiers as matching evidence", () => {
    for (const emptyIdentifier of [null, "", "   "] as const) {
      const decision = resolveEntityCandidates({
        sourceEntityKey: "source:empty-identifier",
        identifiers: { beneficiary_id: emptyIdentifier },
        candidates: [
          {
            entityKey: "canonical:empty-identifier",
            identifiers: { beneficiary_id: emptyIdentifier },
          },
        ],
        rules: [
          {
            identifier: "beneficiary_id",
            weight: 1,
            requiredForAutomaticMatch: true,
          },
        ],
      });

      expect(decision).toMatchObject({
        status: "new_entity",
        targetEntityKey: null,
        humanReviewRequired: true,
      });
      expect(decision.candidates[0]).toMatchObject({
        score: 0,
        requiredMatchesSatisfied: false,
      });
    }
  });

  it("fails safely when rules or thresholds contain no valid evidence controls", () => {
    const decision = resolveEntityCandidates({
      sourceEntityKey: "source:no-evidence",
      identifiers: {},
      candidates: [{ entityKey: "canonical:no-evidence", identifiers: {} }],
      rules: [],
      automaticMatchThreshold: 0,
      reviewThreshold: 0,
      ambiguityMargin: -1,
    });

    expect(decision).toMatchObject({
      status: "new_entity",
      targetEntityKey: null,
      humanReviewRequired: true,
    });
    expect(decision.candidates[0]?.score).toBe(0);
  });

  it("does not discard an invalid required rule and silently auto-match", () => {
    const decision = resolveEntityCandidates({
      sourceEntityKey: "source:mixed-rules",
      identifiers: { ssn: "111", name: "Sample Person" },
      candidates: [
        {
          entityKey: "canonical:mixed-rules",
          identifiers: { ssn: "999", name: "Sample Person" },
        },
      ],
      rules: [
        {
          identifier: "ssn",
          weight: 0,
          requiredForAutomaticMatch: true,
        },
        { identifier: "name", weight: 1 },
      ],
    });

    expect(decision).toMatchObject({
      status: "needs_review",
      targetEntityKey: "canonical:mixed-rules",
      humanReviewRequired: true,
      invalidRuleCount: 1,
    });
    expect(decision.rationale).toContain("rule is invalid");
  });

  it("never selects blank source or candidate entity keys automatically", () => {
    const baseInput = {
      sourceEntityKey: "source:valid",
      identifiers: { beneficiary_id: "AB-123" },
      candidates: [
        {
          entityKey: "canonical:valid",
          identifiers: { beneficiary_id: "AB-123" },
        },
      ],
      rules: [
        {
          identifier: "beneficiary_id",
          weight: 1,
          requiredForAutomaticMatch: true,
        },
      ],
    };
    const blankSource = resolveEntityCandidates({
      ...baseInput,
      sourceEntityKey: " ",
    });
    const blankCandidate = resolveEntityCandidates({
      ...baseInput,
      candidates: [
        { entityKey: " ", identifiers: { beneficiary_id: "AB-123" } },
      ],
    });

    expect(blankSource.status).not.toBe("matched");
    expect(blankSource.humanReviewRequired).toBe(true);
    expect(blankCandidate.status).not.toBe("matched");
    expect(blankCandidate.humanReviewRequired).toBe(true);
  });

  it("does not let a zero ambiguity margin auto-select tied candidates", () => {
    const decision = resolveEntityCandidates({
      sourceEntityKey: "source:tied",
      identifiers: { beneficiary_id: "AB-123" },
      candidates: [
        { entityKey: "canonical:a", identifiers: { beneficiary_id: "AB-123" } },
        { entityKey: "canonical:b", identifiers: { beneficiary_id: "AB-123" } },
      ],
      rules: [
        {
          identifier: "beneficiary_id",
          weight: 1,
          requiredForAutomaticMatch: true,
        },
      ],
      ambiguityMargin: 0,
    });

    expect(decision).toMatchObject({
      status: "needs_review",
      humanReviewRequired: true,
    });
  });

  it("orders tied non-ASCII entity keys by canonical code-point order", () => {
    const decision = resolveEntityCandidates({
      sourceEntityKey: "source:canonical-order",
      identifiers: { identifier: "same" },
      candidates: [
        { entityKey: "entity:ä", identifiers: { identifier: "same" } },
        { entityKey: "entity:a", identifiers: { identifier: "same" } },
        { entityKey: "entity:Z", identifiers: { identifier: "same" } },
      ],
      rules: [{ identifier: "identifier", weight: 1 }],
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.candidates.map((candidate) => candidate.entityKey)).toEqual([
      "entity:Z",
      "entity:a",
      "entity:ä",
    ]);
  });
});
