import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  evaluatePurposeLimitedAccess,
  type PurposeLimitedAccessPolicy,
  type PurposeLimitedAccessRequest,
} from "@t2kai/core";
import { describe, expect, it } from "vitest";

import {
  T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS,
  T2K_MCP_PUBLIC_INPUT_LIMITS,
  createT2kMcpRuntime,
  type T2kMcpRuntime,
} from "../server.js";

const specification = {
  referencePolicy: {
    rules: [
      {
        all: [{ path: "risk", operator: "gte", value: 0.7 }],
        action: "review",
      },
    ],
    defaultAction: "proceed",
    evaluation: {
      minimumEpisodes: 20,
      minimumImprovement: 0.05,
      confidenceZ: 1.96,
      minimumCoverage: 0.2,
    },
  },
};

function governedSourceInput(
  recordKey: string,
  authorityRef: string,
  displayName: string,
) {
  return {
    mapping: {
      id: "synthetic:person-api-v1",
      mappingVersion: "1.0.0",
      sourceType: "api",
      sourceLocator: "synthetic://person-api",
      sourceSchemaVersion: "1.0.0",
      object: "synthetic:person",
      fieldMappings: [
        {
          sourcePath: "$.externalId",
          targetProperty: "synthetic:person.external_id",
          required: true,
          normalizations: ["trim", "uppercase"],
          valueMap: {},
          authorityDomain: "identity",
          conflictPolicy: "preserve_all",
        },
        {
          sourcePath: "$.displayName",
          targetProperty: "synthetic:person.display_name",
          required: true,
          normalizations: ["collapse_whitespace"],
          valueMap: {},
          authorityDomain: "identity",
          conflictPolicy: "prefer_authority",
        },
      ],
      targetIdentity: ["synthetic:person.external_id"],
      idempotencyPath: "$.messageId",
      eventTimePath: "$.eventTime",
      observedTimePath: "$.observedTime",
      authority: "synthetic-identity",
      riskTier: "restricted",
      reviewStatus: "accepted",
      driftPolicy: "reject",
      lateArrivalPolicy: "reject",
      humanCheckpoint: "none",
      replayable: true,
    },
    envelope: {
      sourceSystem: `synthetic:${recordKey}`,
      sourceLocator: `synthetic:${recordKey}/record`,
      sourceRecordKey: recordKey,
      sourceSchemaVersion: "1.0.0",
      payload: {
        messageId: recordKey,
        eventTime: "2026-08-29T10:00:00-07:00",
        observedTime: "2026-08-29T10:00:05-07:00",
        externalId: " person-123 ",
        displayName,
      },
      eventTime: "2026-08-29T17:00:00.000Z",
      observedTime: "2026-08-29T17:00:05.000Z",
      authenticationState: "authenticated",
      authorityRef,
      dataClassification: "synthetic_restricted",
      purposeTags: ["identity_resolution"],
      retentionPolicy: { schedule: "synthetic-test-only" },
    },
  };
}

const purposeAccessPolicy = {
  policyId: "synthetic:case-access",
  policyVersion: "1.0.0",
  defaultEffect: "deny",
  rules: [
    {
      ruleId: "assigned-reviewer",
      effect: "allow",
      roles: ["case_reviewer"],
      purposes: ["benefit_review"],
      subjectRelationships: ["assigned"],
      dataCategories: ["case_summary"],
      jurisdictions: ["WA"],
      reason: "Assigned reviewers may inspect the synthetic case summary.",
    },
  ],
};

const purposeAccessRequest = {
  requestKey: "request-001",
  principalId: "principal:reviewer-001",
  principalRoles: ["case_reviewer"],
  purpose: "benefit_review",
  subjectRef: "synthetic:case-001",
  subjectRelationship: "assigned",
  dataCategories: ["case_summary"],
  jurisdiction: "WA",
  requestedAt: "2026-08-29T17:00:00.000Z",
  sourceRecordRefs: ["synthetic:case-001"],
};

async function connect(runtime: T2kMcpRuntime) {
  const client = new Client({ name: "t2k-mcp-test", version: "1.0.0" });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function structuredResult(value: {
  structuredContent?: Record<string, unknown>;
}) {
  return value.structuredContent?.result;
}

interface AdvertisedJsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: boolean;
  allOf?: AdvertisedJsonSchema[];
  maxItems?: number;
}

function closedWorldObjectSchema(schema: AdvertisedJsonSchema | undefined) {
  if (schema?.type === "object" && schema.additionalProperties === false) {
    return schema;
  }
  return schema?.allOf
    ?.map((branch) => closedWorldObjectSchema(branch))
    .find((branch) => branch !== undefined);
}

function defineOwnKey(target: object, key: string, value: unknown = true) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  expect(Object.hasOwn(target, key)).toBe(true);
  return target;
}

function toolErrorText(result: {
  content?: Array<{ type: string; text?: string }>;
}) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

describe("T2K MCP semantic mode", () => {
  it("advertises and executes the database-free tools", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toEqual([
        "validate_ontology_pack",
        "compile_ontology_pack_set",
        "evaluate_reference_policy",
        "evaluate_reference_replay",
        "evaluate_reference_reward",
        "map_governed_source_record",
        "propose_canonical_reconciliation",
        "propose_entity_link",
        "evaluate_purpose_limited_access",
      ]);
      for (const name of [
        "map_governed_source_record",
        "propose_canonical_reconciliation",
        "propose_entity_link",
        "evaluate_purpose_limited_access",
      ]) {
        const tool = listed.tools.find((item) => item.name === name);
        expect(tool?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
        expect(closedWorldObjectSchema(tool?.inputSchema)).toMatchObject({
          type: "object",
          additionalProperties: false,
        });
      }
      expect(
        names.filter((name) =>
          T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS.includes(
            name as (typeof T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS)[number],
          ),
        ),
      ).toEqual([]);

      const evaluated = await client.callTool({
        name: "evaluate_reference_policy",
        arguments: { specification, state: { risk: 0.8 } },
      });
      expect(evaluated.isError).not.toBe(true);
      expect(structuredResult(evaluated)).toBe("review");

      const invalid = await client.callTool({
        name: "validate_ontology_pack",
        arguments: { manifest: { ontologyId: "incomplete" } },
      });
      expect(structuredResult(invalid)).toMatchObject({ valid: false });

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      const body = JSON.parse(capabilities.contents[0]?.text ?? "{}") as {
        mode?: string;
        mutationToolsEnabled?: boolean;
        omittedHumanGovernanceOperations?: string[];
      };
      expect(body).toMatchObject({
        mode: "semantic-only",
        mutationToolsEnabled: false,
        omittedHumanGovernanceOperations: [
          ...T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS,
        ],
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("returns governed validation errors without throwing a protocol error", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const result = await client.callTool({
        name: "evaluate_reference_policy",
        arguments: { specification: { referencePolicy: {} }, state: {} },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("referencePolicy"),
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("advertises bounded batch contracts and rejects oversized or deeply nested calls", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const compileSchema = closedWorldObjectSchema(
        listed.tools.find((tool) => tool.name === "compile_ontology_pack_set")
          ?.inputSchema,
      );
      expect(compileSchema?.properties).toMatchObject({
        manifests: expect.objectContaining({ maxItems: 128 }),
        roots: expect.objectContaining({ maxItems: 64 }),
      });

      const oversizedEpisodes = Array.from(
        { length: T2K_MCP_PUBLIC_INPUT_LIMITS.maxCollectionEntries + 1 },
        () => null,
      );
      await expect(
        client.callTool({
          name: "evaluate_reference_replay",
          arguments: {
            candidateSpecification: specification,
            baselineSpecification: specification,
            episodes: oversizedEpisodes,
          },
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("entry limit"),
      });

      let deeplyNested: Record<string, unknown> = {};
      for (
        let depth = 0;
        depth < T2K_MCP_PUBLIC_INPUT_LIMITS.maxDepth + 2;
        depth += 1
      ) {
        deeplyNested = { nested: deeplyNested };
      }
      await expect(
        client.callTool({
          name: "evaluate_reference_policy",
          arguments: { specification, state: deeplyNested },
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("nesting limit"),
      });

      const oversizedPropertyKey = "k".repeat(
        T2K_MCP_PUBLIC_INPUT_LIMITS.maxPropertyKeyLength + 1,
      );
      await expect(
        client.callTool({
          name: "evaluate_reference_policy",
          arguments: {
            specification,
            state: { [oversizedPropertyKey]: true },
          },
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("property key"),
      });

      const textChunk = "x".repeat(
        Math.floor(
          T2K_MCP_PUBLIC_INPUT_LIMITS.maxTotalTextCharacters / 2,
        ),
      );
      await expect(
        client.callTool({
          name: "evaluate_reference_policy",
          arguments: {
            specification,
            state: { first: textChunk, second: textChunk },
          },
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.stringContaining("total character limit"),
      });

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      expect(JSON.parse(capabilities.contents[0]?.text ?? "{}")).toMatchObject({
        inputLimits: T2K_MCP_PUBLIC_INPUT_LIMITS,
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("maps the executable source mapping directly from a validated public manifest", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const input = governedSourceInput(
        "manifest-001",
        "authority:manifest",
        "Ada Lovelace",
      );
      const manifest = {
        manifestType: "t2k.ontology-pack",
        manifestVersion: "1.0",
        ontologyVersion: "1.0.0",
        ontologyId: "synthetic",
        label: "Synthetic source mapping",
        description: "A transport fixture for the public manifest contract.",
        packKind: "project",
        status: "accepted",
        scope: {
          domain: "synthetic_identity",
          description: "Synthetic identity mapping only.",
        },
        objectTypes: [
          {
            id: "synthetic:person",
            label: "Synthetic person",
            family: "Party",
            nodeKind: "person",
            identity: ["synthetic:person.external_id"],
            purpose: "Preserve independently governed identity evidence.",
            properties: [
              {
                id: "synthetic:person.external_id",
                valueType: "string",
                required: true,
                description: "Synthetic source identifier.",
                authorityDomain: "identity",
                temporal: false,
              },
              {
                id: "synthetic:person.display_name",
                valueType: "string",
                required: false,
                description: "Synthetic display-name candidate.",
                authorityDomain: "identity",
                temporal: true,
              },
            ],
          },
        ],
        sourceMappings: [input.mapping],
      };

      const validation = await client.callTool({
        name: "validate_ontology_pack",
        arguments: { manifest },
      });
      expect(structuredResult(validation)).toEqual({ valid: true, errors: [] });

      const mapped = await client.callTool({
        name: "map_governed_source_record",
        arguments: {
          mapping: manifest.sourceMappings[0],
          envelope: input.envelope,
        },
      });
      expect(mapped.isError).not.toBe(true);
      expect(structuredResult(mapped)).toMatchObject({
        receipt: { status: "mapped", mappingId: input.mapping.id },
      });

      const normalizedAuthorityInput = governedSourceInput(
        "authority-normalized-001",
        "authority:manifest",
        "Ada Lovelace",
      );
      Object.assign(normalizedAuthorityInput.mapping, {
        acceptedAuthorityRefs: [" authority:manifest "],
      });
      const normalizedAuthority = await client.callTool({
        name: "map_governed_source_record",
        arguments: normalizedAuthorityInput,
      });
      expect(normalizedAuthority.isError).not.toBe(true);
      expect(structuredResult(normalizedAuthority)).toMatchObject({
        receipt: { status: "mapped" },
      });

      const duplicateAuthorityInput = structuredClone(
        normalizedAuthorityInput,
      );
      Object.assign(duplicateAuthorityInput.mapping, {
        acceptedAuthorityRefs: ["authority:manifest", " authority:manifest "],
      });
      const duplicateAuthority = await client.callTool({
        name: "map_governed_source_record",
        arguments: duplicateAuthorityInput,
      });
      expect(duplicateAuthority.isError).toBe(true);
      expect(toolErrorText(duplicateAuthority)).toContain(
        "unique after trimming",
      );

      const descriptive = await client.callTool({
        name: "map_governed_source_record",
        arguments: {
          mapping: {
            id: "synthetic:descriptive-source",
            sourceType: "csv",
            sourceLocator: "synthetic://descriptive-source",
            fields: "A:C",
            object: "synthetic:person",
            properties: "external_id,display_name",
            transform: "Legacy documentation only",
            authority: "synthetic-owner",
            reviewStatus: "accepted",
          },
          envelope: input.envelope,
        },
      });
      expect(descriptive.isError).not.toBe(true);
      expect(structuredResult(descriptive)).toMatchObject({
        receipt: {
          status: "rejected",
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "source_mapping_not_executable" }),
          ]),
        },
      });

      const unsupportedSpreadsheetKeys = await client.callTool({
        name: "map_governed_source_record",
        arguments: {
          mapping: {
            ...input.mapping,
            sheet: "People",
            range: "A:C",
            headers: "external_id,display_name",
          },
          envelope: input.envelope,
        },
      });
      expect(unsupportedSpreadsheetKeys.isError).toBe(true);
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("maps, reconciles, and evaluates reversible integration proposals without writes", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const masterInput = governedSourceInput(
        "master-001",
        "authority:master",
        "Ada Lovelace",
      );
      const secondaryInput = governedSourceInput(
        "secondary-001",
        "authority:secondary",
        "Augusta Ada King",
      );
      const masterInputBefore = structuredClone(masterInput);

      const masterMapped = await client.callTool({
        name: "map_governed_source_record",
        arguments: masterInput,
      });
      const secondaryMapped = await client.callTool({
        name: "map_governed_source_record",
        arguments: secondaryInput,
      });
      expect(masterMapped.isError).not.toBe(true);
      expect(secondaryMapped.isError).not.toBe(true);
      expect(masterInput).toEqual(masterInputBefore);

      const masterResult = structuredResult(masterMapped) as {
        receipt: { status: string; humanReviewRequired: boolean };
      };
      const secondaryResult = structuredResult(secondaryMapped) as {
        receipt: { status: string; humanReviewRequired: boolean };
      };
      expect(masterResult.receipt).toMatchObject({
        status: "mapped",
        humanReviewRequired: false,
      });
      expect(secondaryResult.receipt.status).toBe("mapped");

      const authorityPolicy = {
        policyId: "synthetic:identity-authority",
        policyVersion: "1.0.0",
        prioritiesByDomain: {
          identity: ["authority:master", "authority:secondary"],
        },
      };
      const reconciled = await client.callTool({
        name: "propose_canonical_reconciliation",
        arguments: {
          results: [secondaryResult, masterResult],
          authorityPolicy,
        },
      });
      const reconciledReverse = await client.callTool({
        name: "propose_canonical_reconciliation",
        arguments: {
          results: [masterResult, secondaryResult],
          authorityPolicy,
        },
      });
      expect(reconciled.isError).not.toBe(true);
      const proposal = structuredResult(reconciled) as {
        status: string;
        nonMutating: boolean;
        alternativesPreserved: boolean;
        proposalHash: string;
        fields: Array<{
          propertyRef: string;
          status: string;
          selectedValue: unknown;
          candidates: unknown[];
        }>;
      };
      const reverseProposal = structuredResult(reconciledReverse) as {
        proposalHash: string;
      };
      expect(proposal).toMatchObject({
        status: "proposed",
        nonMutating: true,
        alternativesPreserved: true,
      });
      expect(reverseProposal.proposalHash).toBe(proposal.proposalHash);
      expect(
        proposal.fields.find(
          (field) => field.propertyRef === "synthetic:person.display_name",
        ),
      ).toMatchObject({
        status: "selected",
        selectedValue: "Ada Lovelace",
        candidates: expect.arrayContaining([
          expect.objectContaining({ value: "Ada Lovelace" }),
          expect.objectContaining({ value: "Augusta Ada King" }),
        ]),
      });

      const tamperedMaster = structuredClone(masterResult) as {
        receipt: { receiptHash: string };
      };
      tamperedMaster.receipt.receiptHash = "0".repeat(64);
      const tampered = await client.callTool({
        name: "propose_canonical_reconciliation",
        arguments: {
          results: [tamperedMaster],
          authorityPolicy,
        },
      });
      expect(structuredResult(tampered)).toMatchObject({
        status: "rejected",
        humanReviewRequired: true,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_source_receipt_hash" }),
        ]),
      });

      const entityInput = {
        sourceEntityKey: "source:person-123",
        identifiers: {
          external_id: "PERSON-123",
          email: "Ada@Example.test",
        },
        candidates: [
          {
            entityKey: "entity:secondary",
            identifiers: {
              external_id: "PERSON-999",
              email: "ada@example.test",
            },
          },
          {
            entityKey: "entity:master",
            identifiers: {
              external_id: "PERSON-123",
              email: "ada@example.test",
            },
          },
        ],
        rules: [
          {
            identifier: "external_id",
            weight: 2,
            requiredForAutomaticMatch: true,
          },
          { identifier: "email", weight: 1, caseInsensitive: true },
        ],
        automaticMatchThreshold: 0.9,
        reviewThreshold: 0.5,
        ambiguityMargin: 0.1,
      };
      const entityProposal = await client.callTool({
        name: "propose_entity_link",
        arguments: entityInput,
      });
      const entityProposalReverse = await client.callTool({
        name: "propose_entity_link",
        arguments: {
          ...entityInput,
          candidates: [...entityInput.candidates].reverse(),
        },
      });
      expect(structuredResult(entityProposal)).toMatchObject({
        status: "matched",
        targetEntityKey: "entity:master",
        reversible: true,
      });
      expect(
        (structuredResult(entityProposalReverse) as { decisionHash: string })
          .decisionHash,
      ).toBe(
        (structuredResult(entityProposal) as { decisionHash: string })
          .decisionHash,
      );

      const access = await client.callTool({
        name: "evaluate_purpose_limited_access",
        arguments: {
          policy: purposeAccessPolicy,
          request: purposeAccessRequest,
        },
      });
      expect(structuredResult(access)).toMatchObject({
        decision: "allow",
        reasonCode: "explicit_allow",
        matchedRuleId: "assigned-reviewer",
      });
      expect(structuredResult(access)).not.toHaveProperty("token");
      expect(structuredResult(access)).not.toHaveProperty("credential");

      const invalidTime = await client.callTool({
        name: "evaluate_purpose_limited_access",
        arguments: {
          policy: purposeAccessPolicy,
          request: { ...purposeAccessRequest, requestedAt: "not-a-time" },
        },
      });
      expect(structuredResult(invalidTime)).toMatchObject({
        decision: "deny",
        reasonCode: "invalid_request_time",
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects malformed or expansive integration arguments before execution", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const withPersistenceRequest = await client.callTool({
        name: "map_governed_source_record",
        arguments: {
          ...governedSourceInput(
            "master-001",
            "authority:master",
            "Ada Lovelace",
          ),
          persist: true,
        },
      });
      expect(withPersistenceRequest.isError).toBe(true);

      const invalidAccessPolicy = await client.callTool({
        name: "evaluate_purpose_limited_access",
        arguments: {
          policy: { ...purposeAccessPolicy, defaultEffect: "allow" },
          request: purposeAccessRequest,
        },
      });
      expect(invalidAccessPolicy.isError).toBe(true);

      const invalidEntityProposal = await client.callTool({
        name: "propose_entity_link",
        arguments: {
          sourceEntityKey: "source:person-123",
          identifiers: { external_id: "PERSON-123" },
          candidates: [
            {
              entityKey: "entity:master",
              identifiers: { external_id: "PERSON-123" },
              merge: true,
            },
          ],
          rules: [{ identifier: "external_id", weight: 1 }],
        },
      });
      expect(invalidEntityProposal.isError).toBe(true);
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("preserves exact access selectors with direct-Core parity", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);
    const basePolicy = purposeAccessPolicy as PurposeLimitedAccessPolicy;
    const baseRequest = purposeAccessRequest as PurposeLimitedAccessRequest;
    const cases: Array<{
      label: string;
      policy: PurposeLimitedAccessPolicy;
      request: PurposeLimitedAccessRequest;
    }> = [
      {
        label: "role",
        policy: structuredClone(basePolicy),
        request: {
          ...structuredClone(baseRequest),
          requestKey: "request-role-whitespace",
          principalRoles: [" case_reviewer "],
        },
      },
      {
        label: "purpose",
        policy: {
          ...structuredClone(basePolicy),
          rules: [
            {
              ...structuredClone(basePolicy.rules[0]!),
              purposes: [" benefit_review "],
            },
          ],
        },
        request: {
          ...structuredClone(baseRequest),
          requestKey: "request-purpose-whitespace",
        },
      },
      {
        label: "data category",
        policy: structuredClone(basePolicy),
        request: {
          ...structuredClone(baseRequest),
          requestKey: "request-category-whitespace",
          dataCategories: [" case_summary "],
        },
      },
    ];

    try {
      for (const testCase of cases) {
        const direct = evaluatePurposeLimitedAccess(
          testCase.policy,
          testCase.request,
        );
        expect(direct, testCase.label).toMatchObject({
          decision: "deny",
          reasonCode: "default_deny",
        });

        const response = await client.callTool({
          name: "evaluate_purpose_limited_access",
          arguments: {
            policy: testCase.policy,
            request: testCase.request,
          },
        });
        expect(response.isError, testCase.label).not.toBe(true);
        expect(structuredResult(response), testCase.label).toEqual(direct);
      }
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects dangerous own keys on every governed JSON surface before parsing", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const expectUnsafeRejection = async (
        name: string,
        arguments_: Record<string, unknown>,
        key: string,
      ) => {
        await expect(
          client.callTool({ name, arguments: arguments_ }),
          `${name}/${key}`,
        ).rejects.toMatchObject({
          code: ErrorCode.InvalidParams,
          message: expect.stringMatching(/Unsafe own key/),
        });
      };

      const sourcePayloadAttack = governedSourceInput(
        "payload-attack",
        "authority:source",
        "Ada Lovelace",
      );
      defineOwnKey(sourcePayloadAttack.envelope.payload, "__proto__", {
        polluted: true,
      });
      await expectUnsafeRejection(
        "map_governed_source_record",
        sourcePayloadAttack,
        "__proto__",
      );

      const mappingAttack = governedSourceInput(
        "mapping-attack",
        "authority:source",
        "Ada Lovelace",
      );
      defineOwnKey(
        mappingAttack.mapping.fieldMappings[0]!.valueMap,
        "constructor",
        "unsafe",
      );
      await expectUnsafeRejection(
        "map_governed_source_record",
        mappingAttack,
        "constructor",
      );

      const topLevelAttack = governedSourceInput(
        "top-level-attack",
        "authority:source",
        "Ada Lovelace",
      );
      defineOwnKey(topLevelAttack, "prototype", { polluted: true });
      await expectUnsafeRejection(
        "map_governed_source_record",
        topLevelAttack,
        "prototype",
      );

      const attributes = { assignment: "case-001" };
      defineOwnKey(attributes, "prototype", { polluted: true });
      await expectUnsafeRejection(
        "evaluate_purpose_limited_access",
        {
          policy: purposeAccessPolicy,
          request: { ...purposeAccessRequest, attributes },
        },
        "prototype",
      );

      const accessRule = { ...purposeAccessPolicy.rules[0] };
      defineOwnKey(accessRule, "constructor", { polluted: true });
      await expectUnsafeRejection(
        "evaluate_purpose_limited_access",
        {
          policy: { ...purposeAccessPolicy, rules: [accessRule] },
          request: purposeAccessRequest,
        },
        "constructor",
      );

      const mapped = await client.callTool({
        name: "map_governed_source_record",
        arguments: governedSourceInput(
          "evidence-attack",
          "authority:source",
          "Ada Lovelace",
        ),
      });
      expect(mapped.isError).not.toBe(true);
      const validEvidence = structuredResult(mapped);
      const evidence = structuredClone(structuredResult(mapped)) as {
        canonicalRecord: {
          fields: Array<{ provenance: { retentionPolicy: object } }>;
        };
      };
      defineOwnKey(
        evidence.canonicalRecord.fields[0]!.provenance.retentionPolicy,
        "__proto__",
        { polluted: true },
      );
      await expectUnsafeRejection(
        "propose_canonical_reconciliation",
        {
          results: [evidence],
          authorityPolicy: {
            policyId: "synthetic:authority-policy",
            policyVersion: "1.0.0",
            prioritiesByDomain: { identity: ["authority:source"] },
          },
        },
        "__proto__",
      );

      const authorityDomains = { identity: ["authority:source"] };
      defineOwnKey(authorityDomains, "constructor", ["authority:forged"]);
      await expectUnsafeRejection(
        "propose_canonical_reconciliation",
        {
          results: [validEvidence],
          authorityPolicy: {
            policyId: "synthetic:unsafe-authority-policy",
            policyVersion: "1.0.0",
            prioritiesByDomain: authorityDomains,
          },
        },
        "constructor",
      );

      const arbitraryState = { nested: { risk: 0.8 } };
      defineOwnKey(arbitraryState.nested, "prototype", { polluted: true });
      await expectUnsafeRejection(
        "evaluate_reference_policy",
        { specification, state: arbitraryState },
        "prototype",
      );
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("guards the raw top level of every strict integration tool", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const mapped = await client.callTool({
        name: "map_governed_source_record",
        arguments: governedSourceInput(
          "top-level-fixture",
          "authority:source",
          "Ada Lovelace",
        ),
      });
      expect(mapped.isError).not.toBe(true);
      const mappedEvidence = structuredResult(mapped);
      const strictToolCases = [
        {
          name: "map_governed_source_record",
          arguments: governedSourceInput(
            "top-level-map",
            "authority:source",
            "Ada Lovelace",
          ),
        },
        {
          name: "propose_canonical_reconciliation",
          arguments: {
            results: [mappedEvidence],
            authorityPolicy: {
              policyId: "synthetic:top-level-authority",
              policyVersion: "1.0.0",
              prioritiesByDomain: { identity: ["authority:source"] },
            },
          },
        },
        {
          name: "propose_entity_link",
          arguments: {
            sourceEntityKey: "source:top-level-person",
            identifiers: { external_id: "PERSON-123" },
            candidates: [
              {
                entityKey: "entity:top-level-person",
                identifiers: { external_id: "PERSON-123" },
              },
            ],
            rules: [{ identifier: "external_id", weight: 1 }],
          },
        },
        {
          name: "evaluate_purpose_limited_access",
          arguments: {
            policy: purposeAccessPolicy,
            request: purposeAccessRequest,
          },
        },
      ] as const;

      for (const toolCase of strictToolCases) {
        for (const key of ["__proto__", "constructor", "prototype"] as const) {
          const argumentsWithUnsafeKey = structuredClone(
            toolCase.arguments,
          ) as Record<string, unknown>;
          defineOwnKey(argumentsWithUnsafeKey, key, { polluted: true });
          await expect(
            client.callTool({
              name: toolCase.name,
              arguments: argumentsWithUnsafeKey,
            }),
            `${toolCase.name}/${key}`,
          ).rejects.toMatchObject({
            code: ErrorCode.InvalidParams,
            message: expect.stringMatching(/Unsafe own key/),
          });
        }

        const argumentsWithOrdinaryUnknown = structuredClone(
          toolCase.arguments,
        ) as Record<string, unknown>;
        argumentsWithOrdinaryUnknown.ordinaryUnknown = true;
        const ordinaryUnknown = await client.callTool({
          name: toolCase.name,
          arguments: argumentsWithOrdinaryUnknown,
        });
        expect(ordinaryUnknown.isError).toBe(true);
        expect(toolErrorText(ordinaryUnknown)).toContain("Unrecognized key");
      }

      const legacyUnknown = await client.callTool({
        name: "evaluate_reference_policy",
        arguments: {
          specification,
          state: { risk: 0.8 },
          legacyIgnoredField: "preserve-compatible-stripping",
        },
      });
      expect(legacyUnknown.isError).not.toBe(true);
      expect(structuredResult(legacyUnknown)).toBe("review");
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects dangerous strings in canonical key positions", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const targetPropertyInput = governedSourceInput(
        "target-property",
        "authority:source",
        "Ada Lovelace",
      );
      targetPropertyInput.mapping.fieldMappings[0]!.targetProperty =
        "constructor";
      const targetPropertyResult = await client.callTool({
        name: "map_governed_source_record",
        arguments: targetPropertyInput,
      });

      const targetIdentityInput = governedSourceInput(
        "target-identity",
        "authority:source",
        "Ada Lovelace",
      );
      targetIdentityInput.mapping.targetIdentity = ["__proto__"];
      const targetIdentityResult = await client.callTool({
        name: "map_governed_source_record",
        arguments: targetIdentityInput,
      });

      const authorityDomainInput = governedSourceInput(
        "authority-domain",
        "authority:source",
        "Ada Lovelace",
      );
      authorityDomainInput.mapping.fieldMappings[0]!.authorityDomain =
        "prototype";
      const authorityDomainResult = await client.callTool({
        name: "map_governed_source_record",
        arguments: authorityDomainInput,
      });

      for (const result of [
        targetPropertyResult,
        targetIdentityResult,
        authorityDomainResult,
      ]) {
        expect(result.isError).toBe(true);
        expect(toolErrorText(result)).toContain("Unsafe object key");
      }
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("accepts valid ordinary and null-prototype JSON objects", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const input = governedSourceInput(
        "null-prototype",
        "authority:source",
        "Ada Lovelace",
      );
      input.envelope.payload = Object.assign(
        Object.create(null),
        input.envelope.payload,
      );
      expect(Object.getPrototypeOf(input.envelope.payload)).toBeNull();

      const mapped = await client.callTool({
        name: "map_governed_source_record",
        arguments: input,
      });
      expect(mapped.isError).not.toBe(true);
      expect(structuredResult(mapped)).toMatchObject({
        receipt: { status: "mapped" },
      });

      const attributes = Object.assign(Object.create(null), {
        assignment: "case-001",
      }) as Record<string, unknown>;
      const accessed = await client.callTool({
        name: "evaluate_purpose_limited_access",
        arguments: {
          policy: purposeAccessPolicy,
          request: { ...purposeAccessRequest, attributes },
        },
      });
      expect(accessed.isError).not.toBe(true);
      expect(structuredResult(accessed)).toMatchObject({ decision: "allow" });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects unsafe mutation configurations before opening a transport", async () => {
    await expect(
      createT2kMcpRuntime({ allowMutations: true, actorId: "agent:test" }),
    ).rejects.toThrow("Postgres lifecycle");
    await expect(
      createT2kMcpRuntime({
        connectionString: "postgresql://unused.invalid/t2k",
        allowMutations: true,
      }),
    ).rejects.toThrow("fixed actorId");
  });
});

describe("T2K MCP mutation boundary", () => {
  it("adds lifecycle reads without writes when only a database is configured", async () => {
    const runtime = await createT2kMcpRuntime({
      connectionString: "postgresql://unused.invalid/t2k",
    });
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain("get_active_policy");
      expect(names).toContain("get_lifecycle_snapshot");
      expect(names).toContain("verify_event_chain");
      expect(names).not.toContain("create_reasoning_policy");

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      expect(JSON.parse(capabilities.contents[0]?.text ?? "{}")).toMatchObject({
        mode: "lifecycle-read-only",
        actor: null,
        mutationToolsEnabled: false,
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("uses one configured agent and never exposes human governance tools", async () => {
    const runtime = await createT2kMcpRuntime({
      connectionString: "postgresql://unused.invalid/t2k",
      allowMutations: true,
      actorId: "agent:mcp-test",
    });
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain("create_reasoning_policy");
      for (const operation of T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS) {
        expect(names).not.toContain(operation);
      }
      for (const tool of listed.tools.filter((item) =>
        [
          "create_reasoning_policy",
          "propose_policy_version",
          "create_decision_context",
          "compute_recommendation",
          "open_decision_episode",
          "record_execution_receipt",
          "record_observation",
          "assess_reward",
          "propose_learning_candidate",
        ].includes(item.name),
      )) {
        const schema = closedWorldObjectSchema(tool.inputSchema);
        expect(schema?.properties).not.toHaveProperty("actor");
        expect(schema?.properties).not.toHaveProperty("actorId");
        expect(schema?.properties).not.toHaveProperty("actorType");
      }

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      const body = JSON.parse(capabilities.contents[0]?.text ?? "{}") as {
        actor?: unknown;
      };
      expect(body.actor).toEqual({
        actorType: "agent",
        actorId: "agent:mcp-test",
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});

const databaseUrl = process.env.T2K_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;

describePostgres("T2K MCP Postgres mode", () => {
  it("migrates, mutates with the fixed agent, and reads verifiable state", async () => {
    const runtime = await createT2kMcpRuntime({
      connectionString: databaseUrl,
      autoMigrate: true,
      allowMutations: true,
      actorId: "agent:mcp-integration",
    });
    const client = await connect(runtime);
    const suffix = randomUUID();

    try {
      const created = await client.callTool({
        name: "create_reasoning_policy",
        arguments: {
          policyKey: `mcp-policy-${suffix}`,
          label: "MCP integration policy",
          decisionType: `mcp.decision.${suffix}`,
          actorType: "human",
          actorId: "human:forged-reviewer",
        },
      });
      expect(created.isError).not.toBe(true);
      expect(structuredResult(created)).toMatchObject({
        policyKey: `mcp-policy-${suffix}`,
        createdByActorType: "agent",
        createdByActorId: "agent:mcp-integration",
      });

      const snapshot = await client.callTool({
        name: "get_lifecycle_snapshot",
        arguments: {},
      });
      expect(structuredResult(snapshot)).toMatchObject({
        schemaVersion: 2,
        eventChain: { valid: true },
      });

      const chain = await client.callTool({
        name: "verify_event_chain",
        arguments: {},
      });
      expect(structuredResult(chain)).toMatchObject({ valid: true });
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});
