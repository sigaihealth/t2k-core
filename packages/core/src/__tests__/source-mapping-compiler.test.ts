import { describe, expect, it } from "vitest";

import { compileOntologyPackSet } from "../compiler.js";
import {
  parseOntologyPackManifest,
  validateOntologyPackManifest,
} from "../manifest.js";

function baseManifest() {
  return {
    manifestType: "t2k.ontology-pack",
    manifestVersion: "1.0",
    ontologyVersion: "1.0.0",
    ontologyId: "benefits",
    label: "Benefits",
    description: "Synthetic compiler fixture",
    packKind: "vertical",
    status: "accepted",
    scope: {
      domain: "public_benefits",
      description: "Synthetic mapping validation",
    },
    objectTypes: [
      {
        id: "person",
        label: "Person",
        family: "Party",
        nodeKind: "person",
        identity: ["person_id"],
        purpose: "Synthetic person",
        properties: [
          {
            id: "person_id",
            valueType: "string",
            required: true,
            description: "Synthetic identifier",
            authorityDomain: "identity",
            temporal: false,
          },
          {
            id: "display_name",
            valueType: "string",
            required: false,
            description: "Display name",
            authorityDomain: "identity",
            temporal: true,
          },
        ],
      },
    ],
    sourceMappings: [
      {
        id: "person_api_v1",
        mappingVersion: "1.0.0",
        sourceType: "api",
        sourceLocator: "synthetic://person-api",
        sourceSchemaVersion: "1.0.0",
        object: "person",
        fieldMappings: [
          {
            sourcePath: "$.person_id",
            targetProperty: "person_id",
            required: true,
            normalizations: ["trim"],
            valueMap: {},
            authorityDomain: "identity",
            conflictPolicy: "require_review",
          },
        ],
        targetIdentity: ["person_id"],
        idempotencyPath: "$.message_id",
        eventTimePath: "$.event_time",
        observedTimePath: "$.observed_time",
        authority: "synthetic_person_api",
        riskTier: "high",
        reviewStatus: "accepted",
        driftPolicy: "quarantine",
        lateArrivalPolicy: "quarantine",
        humanCheckpoint: "on_issue",
        replayable: true,
      },
    ],
    eventTypes: [
      {
        id: "person_observed",
        source: "integration_hub",
        createsOrUpdates: "person",
        humanCheckpoint: "on_issue",
      },
    ],
  };
}

function compile(manifest: unknown) {
  return compileOntologyPackSet({
    manifests: [manifest],
    roots: [{ ontologyId: "benefits", version: "1.0.0" }],
  });
}

describe("source-mapping compiler integrity", () => {
  it("accepts a replayable structured mapping whose object and properties resolve", () => {
    const result = compile(baseManifest());

    expect(result.status).toBe("valid");
    expect(result.diagnostics).toEqual([]);
  });

  it("parses compatibility-optional executable source bindings", () => {
    const manifest = baseManifest();
    const mapping = manifest.sourceMappings[0] as (typeof manifest.sourceMappings)[number] & {
      sourceSystem: string;
      sourceLocatorMatch: "prefix";
      acceptedAuthorityRefs: string[];
    };
    mapping.sourceSystem = "synthetic-person-api";
    mapping.sourceLocatorMatch = "prefix";
    mapping.acceptedAuthorityRefs = ["authority:synthetic-person-api"];

    expect(validateOntologyPackManifest(manifest)).toEqual({
      valid: true,
      errors: [],
    });
    expect(parseOntologyPackManifest(manifest)?.sourceMappings[0]).toMatchObject({
      sourceSystem: "synthetic-person-api",
      sourceLocatorMatch: "prefix",
      acceptedAuthorityRefs: ["authority:synthetic-person-api"],
    });
    expect(compile(manifest).status).toBe("valid");
  });

  it("rejects authority references that collide after trimming", () => {
    const manifest = baseManifest();
    const mapping = manifest.sourceMappings[0] as (typeof manifest.sourceMappings)[number] &
      { acceptedAuthorityRefs: string[] };
    mapping.acceptedAuthorityRefs = [
      "authority:synthetic-person-api",
      " authority:synthetic-person-api ",
    ];

    expect(validateOntologyPackManifest(manifest)).toEqual({
      valid: false,
      errors: [
        expect.objectContaining({
          path: "/sourceMappings/0/acceptedAuthorityRefs/1",
          keyword: "uniqueItems",
        }),
      ],
    });
    expect(parseOntologyPackManifest(manifest)).toBeNull();

    const legacyCompilerResult = compileOntologyPackSet({
      manifests: [manifest],
      roots: [{ ontologyId: "benefits", version: "1.0.0" }],
      legacyManifestIndexes: [0],
    });
    expect(legacyCompilerResult.status).toBe("invalid");
    expect(legacyCompilerResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_source_mapping_authority_ref",
          level: "error",
        }),
      ])
    );
  });

  it("rejects dangling mapping and event objects", () => {
    const manifest = baseManifest();
    manifest.sourceMappings[0].object = "missing_person";
    manifest.eventTypes[0].createsOrUpdates = "missing_work_item";
    const result = compile(manifest);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "dangling_source_mapping_object",
        "dangling_event_object",
      ])
    );
  });

  it("rejects unknown target and identity properties", () => {
    const manifest = baseManifest();
    manifest.sourceMappings[0].fieldMappings[0].targetProperty = "unknown_field";
    manifest.sourceMappings[0].targetIdentity = ["unknown_identity"];
    const result = compile(manifest);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "unknown_source_mapping_property",
        "unknown_source_mapping_identity_property",
      ])
    );
  });

  it("keeps descriptive legacy mappings valid but marks them non-executable", () => {
    const manifest = baseManifest();
    const mapping = manifest.sourceMappings[0] as Partial<
      (typeof manifest.sourceMappings)[number]
    >;
    delete mapping.mappingVersion;
    delete mapping.sourceSchemaVersion;
    delete mapping.fieldMappings;
    delete mapping.targetIdentity;
    delete mapping.idempotencyPath;
    delete mapping.eventTimePath;
    delete mapping.observedTimePath;
    delete mapping.driftPolicy;
    delete mapping.lateArrivalPolicy;
    delete mapping.humanCheckpoint;
    delete mapping.replayable;
    const parsed = parseOntologyPackManifest(manifest);
    const result = compile(manifest);

    expect(parsed).not.toBeNull();
    for (const executionField of [
      "mappingVersion",
      "sourceSchemaVersion",
      "fieldMappings",
      "targetIdentity",
      "idempotencyPath",
      "eventTimePath",
      "observedTimePath",
      "driftPolicy",
      "lateArrivalPolicy",
      "humanCheckpoint",
      "replayable",
    ]) {
      expect(Object.hasOwn(parsed!.sourceMappings[0]!, executionField)).toBe(false);
    }
    expect(result.status).toBe("valid");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "review",
          code: "descriptive_source_mapping_not_executable",
        }),
      ])
    );
  });

  it("does not tighten legacy descriptive whitespace under schema v1", () => {
    const manifest = baseManifest();
    const mapping = manifest.sourceMappings[0] as Partial<
      (typeof manifest.sourceMappings)[number]
    >;
    delete mapping.mappingVersion;
    delete mapping.sourceSchemaVersion;
    delete mapping.fieldMappings;
    delete mapping.targetIdentity;
    delete mapping.idempotencyPath;
    delete mapping.eventTimePath;
    delete mapping.observedTimePath;
    delete mapping.driftPolicy;
    delete mapping.lateArrivalPolicy;
    delete mapping.humanCheckpoint;
    delete mapping.replayable;
    mapping.sourceType = " ";
    mapping.sourceLocator = " ";
    mapping.authority = " ";
    mapping.reviewStatus = " ";
    (manifest.scope as typeof manifest.scope & { jurisdictions: string[] })
      .jurisdictions = [" "];

    expect(validateOntologyPackManifest(manifest).valid).toBe(true);
    expect(parseOntologyPackManifest(manifest)).not.toBeNull();
    expect(compile(manifest).status).toBe("valid");
  });

  it("rejects duplicate canonical targets even when aliases differ", () => {
    const manifest = baseManifest();
    manifest.sourceMappings[0].fieldMappings.push({
      ...manifest.sourceMappings[0].fieldMappings[0],
      sourcePath: "$.alternate_person_id",
      targetProperty: "person.person_id",
    });
    const result = compile(manifest);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_source_mapping_target" }),
      ])
    );
  });

  it("requires identity references to use one exact required field mapping", () => {
    const aliasManifest = baseManifest();
    aliasManifest.sourceMappings[0].targetIdentity = ["person.person_id"];
    const aliasResult = compile(aliasManifest);

    const optionalManifest = baseManifest();
    optionalManifest.sourceMappings[0].fieldMappings[0].required = false;
    const optionalResult = compile(optionalManifest);

    expect(aliasResult.status).toBe("invalid");
    expect(aliasResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_mapping_identity_not_exactly_mapped",
        }),
      ])
    );
    expect(optionalResult.status).toBe("invalid");
    expect(optionalResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_mapping_identity_not_required",
        }),
      ])
    );
  });

  it("requires mapped identities to be declared by the target object", () => {
    const manifest = baseManifest();
    manifest.sourceMappings[0].fieldMappings.push({
      ...manifest.sourceMappings[0].fieldMappings[0],
      sourcePath: "$.display_name",
      targetProperty: "display_name",
    });
    manifest.sourceMappings[0].targetIdentity = ["display_name"];
    const result = compile(manifest);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_mapping_identity_not_declared_by_object",
        }),
      ])
    );
  });

  it("rejects source paths that traverse prototype-sensitive segments", () => {
    const manifest = baseManifest();
    manifest.sourceMappings[0].fieldMappings[0].sourcePath =
      "$.__proto__.person_id";

    const validation = validateOntologyPackManifest(manifest);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/sourceMappings/0/fieldMappings/0/sourcePath",
        }),
      ])
    );
  });

  it("rejects payload-root selectors for control paths", () => {
    const manifest = baseManifest();
    manifest.sourceMappings[0].idempotencyPath = "$";

    const validation = validateOntologyPackManifest(manifest);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/sourceMappings/0/idempotencyPath",
        }),
      ])
    );
  });

  it("rejects whitespace-only governed mapping metadata before parsing", () => {
    for (const mutate of [
      (manifest: ReturnType<typeof baseManifest>) => {
        manifest.sourceMappings[0].authority = " ";
      },
      (manifest: ReturnType<typeof baseManifest>) => {
        manifest.sourceMappings[0].fieldMappings[0].authorityDomain = " ";
      },
      (manifest: ReturnType<typeof baseManifest>) => {
        manifest.sourceMappings[0].sourceLocator = " ";
      },
      (manifest: ReturnType<typeof baseManifest>) => {
        manifest.sourceMappings[0].targetIdentity.push(" ");
      },
    ]) {
      const manifest = baseManifest();
      mutate(manifest);
      expect(validateOntologyPackManifest(manifest).valid).toBe(false);
      expect(parseOntologyPackManifest(manifest)).toBeNull();
    }
  });
});
