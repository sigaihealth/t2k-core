import { describe, expect, it } from "vitest";

import { compareCanonicalStrings, semanticHash } from "../compiler.js";
import type { OntologyPackSourceMapping } from "../manifest.js";
import {
  executeSourceMapping,
  type FederatedSourceEnvelope,
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
