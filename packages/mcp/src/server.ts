import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";
import {
  ReferencePolicyError,
  ReferenceRewardError,
  SOURCE_AUTHENTICATION_STATES,
  evaluatePurposeLimitedAccess,
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  evaluateReferenceReward,
  executeSourceMapping,
  reconcileCanonicalRecords,
  resolveEntityCandidates,
  validateOntologyPackManifest,
  type AcceptedIdempotencyRecord,
  type CanonicalAuthorityPolicy,
  type DecisionLearningContract,
  type EntityResolutionInput,
  type ExecuteSourceMappingResult,
  type FederatedSourceEnvelope,
  type JsonObject,
  type JsonValue,
  type OntologyPackSourceMapping,
  type PurposeLimitedAccessPolicy,
  type PurposeLimitedAccessRequest,
  type ReferenceReplayEpisode,
  type ReferenceRewardObservation,
  type RewardDimensionSpec,
} from "@t2kai/core";
import {
  compileOntologyPackSet,
  type CompileOntologyPackSetInput,
} from "@t2kai/core/compiler";
import {
  PostgresReferenceLifecycle,
  ReferenceLifecycleError,
  type ReferenceLifecycleActor,
} from "@t2kai/core/postgres";
import * as z from "zod/v4";

const packageManifest = createRequire(import.meta.url)("../package.json") as {
  version?: unknown;
};
if (typeof packageManifest.version !== "string" || !packageManifest.version) {
  throw new Error("@t2kai/mcp package version is missing.");
}
export const T2K_MCP_VERSION = packageManifest.version;

export const T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS = [
  "accept_policy_version",
  "deploy_policy_version",
  "authorize_recommendation",
  "close_decision_episode",
  "evaluate_learning_candidate",
  "promote_learning_candidate",
  "deploy_promotion",
  "rollback_promotion",
] as const;

const SEMANTIC_TOOL_NAMES = [
  "validate_ontology_pack",
  "compile_ontology_pack_set",
  "evaluate_reference_policy",
  "evaluate_reference_replay",
  "evaluate_reference_reward",
  "map_governed_source_record",
  "propose_canonical_reconciliation",
  "propose_entity_link",
  "evaluate_purpose_limited_access",
] as const;

const LIFECYCLE_READ_TOOL_NAMES = [
  "get_active_policy",
  "get_lifecycle_snapshot",
  "verify_event_chain",
] as const;

const LIFECYCLE_MUTATION_TOOL_NAMES = [
  "create_reasoning_policy",
  "propose_policy_version",
  "create_decision_context",
  "compute_recommendation",
  "open_decision_episode",
  "record_execution_receipt",
  "record_observation",
  "assess_reward",
  "propose_learning_candidate",
] as const;

const outputSchema = { result: z.unknown() };
const jsonObjectSchema = z.record(z.string(), z.unknown());
const learningModeSchema = z.enum([
  "none",
  "supervised_feedback",
  "contextual_bandit",
  "sequential_rl",
  "optimization",
]);

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "String must not be blank.");
const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export const T2K_MCP_PUBLIC_INPUT_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 50_000,
  maxCollectionEntries: 10_000,
  maxPropertyKeyLength: 8_192,
  maxStringLength: 1_000_000,
  maxTotalTextCharacters: 2_000_000,
});

interface UnsafeInputSurface {
  message: string;
  path: Array<string | number>;
}

function findUnsafeInputSurface(
  value: unknown,
  path: Array<string | number> = [],
  state: {
    ancestors: WeakSet<object>;
    nodes: number;
    textCharacters: number;
  } = { ancestors: new WeakSet<object>(), nodes: 0, textCharacters: 0 },
): UnsafeInputSurface | null {
  state.nodes += 1;
  if (state.nodes > T2K_MCP_PUBLIC_INPUT_LIMITS.maxNodes) {
    return {
      path,
      message: `MCP arguments exceed the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxNodes} node limit.`,
    };
  }
  if (path.length > T2K_MCP_PUBLIC_INPUT_LIMITS.maxDepth) {
    return {
      path,
      message: `MCP arguments exceed the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxDepth} level nesting limit.`,
    };
  }
  if (
    typeof value === "string" &&
    value.length > T2K_MCP_PUBLIC_INPUT_LIMITS.maxStringLength
  ) {
    return {
      path,
      message: `MCP string exceeds the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxStringLength} character limit.`,
    };
  }
  if (typeof value === "string") {
    state.textCharacters += value.length;
    if (
      state.textCharacters >
      T2K_MCP_PUBLIC_INPUT_LIMITS.maxTotalTextCharacters
    ) {
      return {
        path,
        message: `MCP argument text exceeds the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxTotalTextCharacters} total character limit.`,
      };
    }
  }
  if (value === null || typeof value !== "object") return null;
  if (state.ancestors.has(value)) {
    return {
      path,
      message: "Cyclic input objects are not valid MCP JSON arguments.",
    };
  }

  const keys = Reflect.ownKeys(value);
  const collectionEntries = Array.isArray(value)
    ? value.length
    : keys.length;
  if (
    collectionEntries > T2K_MCP_PUBLIC_INPUT_LIMITS.maxCollectionEntries
  ) {
    return {
      path,
      message: `MCP collection exceeds the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxCollectionEntries} entry limit.`,
    };
  }

  state.ancestors.add(value);
  try {
    for (const key of keys) {
      if (typeof key === "symbol") {
        return {
          path,
          message:
            "Symbol-keyed input properties are not valid MCP JSON arguments.",
        };
      }
      const isArrayStructuralKey =
        Array.isArray(value) && (key === "length" || /^\d+$/.test(key));
      if (!isArrayStructuralKey) {
        if (
          key.length > T2K_MCP_PUBLIC_INPUT_LIMITS.maxPropertyKeyLength
        ) {
          return {
            path,
            message: `MCP property key exceeds the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxPropertyKeyLength} character limit.`,
          };
        }
        state.textCharacters += key.length;
        if (
          state.textCharacters >
          T2K_MCP_PUBLIC_INPUT_LIMITS.maxTotalTextCharacters
        ) {
          return {
            path,
            message: `MCP argument text exceeds the ${T2K_MCP_PUBLIC_INPUT_LIMITS.maxTotalTextCharacters} total character limit.`,
          };
        }
      }
      const segment =
        Array.isArray(value) && /^\d+$/.test(key) ? Number(key) : key;
      const propertyPath = [...path, segment];
      if (unsafeObjectKeys.has(key)) {
        return {
          path: propertyPath,
          message: `Unsafe own key "${key}" is not allowed in MCP arguments.`,
        };
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        return {
          path: propertyPath,
          message:
            "Unreadable input properties are not valid MCP JSON arguments.",
        };
      }
      if (!("value" in descriptor)) {
        return {
          path: propertyPath,
          message:
            "Accessor input properties are not valid MCP JSON arguments.",
        };
      }

      const nestedIssue = findUnsafeInputSurface(
        descriptor.value,
        propertyPath,
        state,
      );
      if (nestedIssue) return nestedIssue;
    }
  } finally {
    state.ancestors.delete(value);
  }
  return null;
}

function guardedObjectInputSchema<T extends z.ZodRawShape>(
  shape: T,
  options: { strict?: boolean } = {},
) {
  const runtimeSchema = options.strict
    ? z.object(shape).strict()
    : z.object(shape);
  // MCP advertises a closed-world contract even for legacy tools whose
  // runtime compatibility behavior still strips unknown caller fields.
  const advertisedSchema = z.object(shape).strict();
  const { $schema: _schema, ...advertisedJsonSchema } = z.toJSONSchema(
    advertisedSchema,
    { target: "draft-7", io: "input" },
  );

  const guardedSchema = z
    .preprocess((value, context) => {
      const unsafeSurface = findUnsafeInputSurface(value);
      if (unsafeSurface) {
        context.addIssue({
          code: "custom",
          path: unsafeSurface.path,
          message: unsafeSurface.message,
        });
      }
      return value;
    }, runtimeSchema)
    .meta(advertisedJsonSchema);

  // The MCP SDK only advertises schemas it recognizes as object-shaped. A
  // Zod preprocess is a pipe even when its output is an object, so provide the
  // already-advertised shape marker without changing Zod's raw-input parser.
  Object.defineProperty(guardedSchema._zod.def, "shape", {
    configurable: false,
    enumerable: false,
    value: shape,
    writable: false,
  });
  return guardedSchema;
}

function installRawToolCallOwnKeyGuard(server: McpServer) {
  const guardedCallToolRequestSchema = z.preprocess((value) => {
    const unsafeSurface = findUnsafeInputSurface(value);
    if (unsafeSurface) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `${unsafeSurface.message} Path: ${JSON.stringify(unsafeSurface.path)}.`,
      );
    }
    return value;
  }, CallToolRequestSchema);
  Object.defineProperty(guardedCallToolRequestSchema._zod.def, "shape", {
    configurable: false,
    enumerable: false,
    value: CallToolRequestSchema._zod.def.shape,
    writable: false,
  });

  const protocol = server.server;
  const originalSetRequestHandler = protocol.setRequestHandler;
  const invokeSetRequestHandler = originalSetRequestHandler as unknown as (
    requestSchema: unknown,
    handler: unknown,
  ) => void;
  protocol.setRequestHandler = ((requestSchema: unknown, handler: unknown) => {
    invokeSetRequestHandler.call(
      protocol,
      requestSchema === CallToolRequestSchema
        ? (guardedCallToolRequestSchema as unknown as typeof CallToolRequestSchema)
        : requestSchema,
      handler,
    );
  }) as typeof protocol.setRequestHandler;

  return () => {
    protocol.setRequestHandler = originalSetRequestHandler;
  };
}

const safeObjectKeySchema = z
  .string()
  .max(T2K_MCP_PUBLIC_INPUT_LIMITS.maxPropertyKeyLength)
  .refine(
    (value) => !unsafeObjectKeys.has(value),
    "Unsafe object key is not allowed.",
  );
const safeNonBlankObjectKeySchema = nonBlankStringSchema.refine(
  (value) => !unsafeObjectKeys.has(value),
  "Unsafe object key is not allowed.",
);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const strictJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.array(strictJsonValueSchema),
    z.record(safeObjectKeySchema, strictJsonValueSchema),
  ]),
);
const strictJsonObjectSchema = z.record(
  safeObjectKeySchema,
  strictJsonValueSchema,
);
const normalizedNonBlankStringSchema = nonBlankStringSchema.overwrite(
  (value) => value.trim(),
);
const uniqueNonBlankStringsSchema = z
  .array(nonBlankStringSchema)
  .refine(
    (values) => new Set(values).size === values.length,
    "Values must be unique.",
  );
const normalizedUniqueNonBlankStringsSchema = z
  .array(normalizedNonBlankStringSchema)
  .refine(
    (values) => new Set(values).size === values.length,
    "Values must be unique after trimming.",
  );
const nonEmptyUniqueStringsSchema = uniqueNonBlankStringsSchema.min(1);
const nonEmptyNormalizedUniqueStringsSchema =
  normalizedUniqueNonBlankStringsSchema.min(1);
const sourceAuthenticationStateSchema = z.enum(SOURCE_AUTHENTICATION_STATES);
const sourceNormalizationSchema = z.enum([
  "trim",
  "collapse_whitespace",
  "lowercase",
  "uppercase",
  "digits_only",
  "iso_date",
]);
const sourceConflictPolicySchema = z.enum([
  "preserve_all",
  "prefer_authority",
  "require_review",
]);
const sourceFieldMappingSchema = z
  .object({
    sourcePath: nonBlankStringSchema,
    targetProperty: safeNonBlankObjectKeySchema,
    required: z.boolean(),
    normalizations: z.array(sourceNormalizationSchema),
    valueMap: z.record(
      safeObjectKeySchema,
      z.union([z.null(), z.string(), z.number().finite(), z.boolean()]),
    ),
    authorityDomain: safeNonBlankObjectKeySchema,
    conflictPolicy: sourceConflictPolicySchema,
  })
  .strict();
const sourceMappingSchema = z
  .object({
    id: nonBlankStringSchema,
    mappingVersion: nonBlankStringSchema.optional(),
    sourceType: nonBlankStringSchema,
    sourceLocator: nonBlankStringSchema,
    sourceSystem: nonBlankStringSchema.optional(),
    sourceLocatorMatch: z.enum(["exact", "prefix"]).optional(),
    acceptedAuthorityRefs: nonEmptyNormalizedUniqueStringsSchema.optional(),
    sourceSchemaVersion: nonBlankStringSchema.optional(),
    fields: z.string().optional(),
    object: nonBlankStringSchema,
    properties: z.string().optional(),
    transform: z.string().optional(),
    fieldMappings: z.array(sourceFieldMappingSchema).min(1).optional(),
    targetIdentity: z
      .array(safeNonBlankObjectKeySchema)
      .min(1)
      .refine(
        (values) => new Set(values).size === values.length,
        "Values must be unique.",
      )
      .optional(),
    idempotencyPath: nonBlankStringSchema.optional(),
    eventTimePath: nonBlankStringSchema.optional(),
    observedTimePath: nonBlankStringSchema.optional(),
    authority: nonBlankStringSchema,
    riskTier: z.string().optional(),
    reviewStatus: nonBlankStringSchema,
    driftPolicy: z
      .enum(["reject", "quarantine", "allow_with_review"])
      .optional(),
    lateArrivalPolicy: z
      .enum(["reject", "quarantine", "accept_with_review"])
      .optional(),
    humanCheckpoint: z.enum(["always", "on_issue", "none"]).optional(),
    replayable: z.boolean().optional(),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (mapping.fieldMappings !== undefined) {
      for (const field of [
        "mappingVersion",
        "sourceSchemaVersion",
        "targetIdentity",
        "driftPolicy",
        "lateArrivalPolicy",
        "humanCheckpoint",
        "replayable",
      ] as const) {
        if (mapping[field] === undefined) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `An executable mapping requires ${field}.`,
          });
        }
      }
    }
    if (mapping.replayable && !mapping.idempotencyPath) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyPath"],
        message: "A replayable mapping requires idempotencyPath.",
      });
    }
  });
const federatedSourceEnvelopeSchema = z
  .object({
    sourceSystem: nonBlankStringSchema,
    sourceLocator: nonBlankStringSchema,
    sourceRecordKey: nonBlankStringSchema,
    sourceSchemaVersion: nonBlankStringSchema,
    payload: strictJsonObjectSchema,
    eventTime: nonBlankStringSchema,
    observedTime: nonBlankStringSchema,
    authenticationState: sourceAuthenticationStateSchema,
    authorityRef: nonBlankStringSchema,
    dataClassification: nonBlankStringSchema,
    purposeTags: nonEmptyUniqueStringsSchema,
    retentionPolicy: strictJsonObjectSchema,
    contentHash: sha256Schema.optional(),
  })
  .strict();
const acceptedIdempotencyRecordSchema = z
  .object({
    idempotencyKey: sha256Schema,
    sourcePayloadHash: sha256Schema,
    canonicalOutputHash: sha256Schema,
  })
  .strict();
const governedSourceMappingToolInputSchema = guardedObjectInputSchema(
  {
    mapping: sourceMappingSchema,
    envelope: federatedSourceEnvelopeSchema,
    expectedMappingHash: sha256Schema.optional(),
    latestAcceptedEventTime: nonBlankStringSchema.nullable().optional(),
    acceptedIdempotencyRecords: z
      .array(acceptedIdempotencyRecordSchema)
      .max(T2K_MCP_PUBLIC_INPUT_LIMITS.maxCollectionEntries)
      .optional(),
  },
  { strict: true },
);

const sourceMappingIssueSchema = z
  .object({
    code: nonBlankStringSchema,
    severity: z.enum(["error", "review", "warning"]),
    message: nonBlankStringSchema,
    sourcePath: z.string().nullable(),
    targetProperty: z.string().nullable(),
  })
  .strict();
const canonicalFieldProvenanceSchema = z
  .object({
    sourceSystem: z.string(),
    sourceLocator: z.string(),
    sourceRecordKey: z.string(),
    sourceSchemaVersion: z.string(),
    sourcePath: z.string(),
    sourceValueHash: sha256Schema,
    sourcePayloadHash: sha256Schema,
    mappingId: z.string(),
    mappingHash: sha256Schema,
    eventTime: z.string(),
    observedTime: z.string(),
    authenticationState: sourceAuthenticationStateSchema,
    authorityRef: z.string(),
    authorityDomain: safeNonBlankObjectKeySchema,
    dataClassification: z.string(),
    purposeTags: z.array(z.string()),
    retentionPolicy: strictJsonObjectSchema,
  })
  .strict();
const canonicalFieldValueSchema = z
  .object({
    propertyRef: safeNonBlankObjectKeySchema,
    value: strictJsonValueSchema,
    conflictPolicy: sourceConflictPolicySchema,
    provenance: canonicalFieldProvenanceSchema,
  })
  .strict();
const federatedCanonicalRecordSchema = z
  .object({
    objectRef: z.string(),
    identity: z.record(safeNonBlankObjectKeySchema, strictJsonValueSchema),
    fields: z.array(canonicalFieldValueSchema),
  })
  .strict();
const sourceMappingReceiptSchema = z
  .object({
    receiptVersion: z.literal("t2k.source-mapping-receipt.v1"),
    status: z.enum(["mapped", "quarantined", "rejected", "duplicate"]),
    sourceSystem: z.string(),
    sourceLocator: z.string(),
    sourceRecordKey: z.string(),
    sourceSchemaVersion: z.string(),
    authenticationState: sourceAuthenticationStateSchema,
    authorityRef: z.string(),
    dataClassification: z.string(),
    purposeTags: z.array(z.string()),
    retentionPolicy: strictJsonObjectSchema,
    mappingId: z.string(),
    mappingVersion: z.string(),
    mappingHash: sha256Schema,
    sourcePayloadHash: sha256Schema,
    canonicalOutputHash: sha256Schema,
    idempotencyKey: sha256Schema,
    eventTime: z.string(),
    observedTime: z.string(),
    lateArrival: z.boolean(),
    duplicate: z.boolean(),
    humanReviewRequired: z.boolean(),
    driftPolicy: z.enum(["reject", "quarantine", "allow_with_review"]),
    lateArrivalPolicy: z.enum(["reject", "quarantine", "accept_with_review"]),
    issues: z.array(sourceMappingIssueSchema),
    receiptHash: sha256Schema,
  })
  .strict();
const executeSourceMappingResultSchema = z
  .object({
    canonicalRecord: federatedCanonicalRecordSchema,
    receipt: sourceMappingReceiptSchema,
  })
  .strict();
const canonicalAuthorityPolicySchema = z
  .object({
    policyId: nonBlankStringSchema,
    policyVersion: nonBlankStringSchema,
    prioritiesByDomain: z.record(
      safeNonBlankObjectKeySchema,
      nonEmptyUniqueStringsSchema,
    ),
  })
  .strict();
const canonicalReconciliationToolInputSchema = guardedObjectInputSchema(
  {
    results: z.array(executeSourceMappingResultSchema).min(1),
    authorityPolicy: canonicalAuthorityPolicySchema,
  },
  { strict: true },
);

const entityIdentifierValueSchema = z.union([
  nonBlankStringSchema,
  z.number().finite(),
]);
const entityIdentifiersSchema = z
  .record(safeNonBlankObjectKeySchema, entityIdentifierValueSchema)
  .refine(
    (identifiers) => Object.keys(identifiers).length > 0,
    "At least one identifier is required.",
  );
const entityCandidateSchema = z
  .object({
    entityKey: nonBlankStringSchema,
    identifiers: entityIdentifiersSchema,
  })
  .strict();
const entityRuleSchema = z
  .object({
    identifier: safeNonBlankObjectKeySchema,
    weight: z.number().finite().positive(),
    requiredForAutomaticMatch: z.boolean().optional(),
    caseInsensitive: z.boolean().optional(),
  })
  .strict();
const entityLinkToolInputSchema = guardedObjectInputSchema(
  {
    sourceEntityKey: nonBlankStringSchema,
    identifiers: entityIdentifiersSchema,
    candidates: z
      .array(entityCandidateSchema)
      .refine(
        (candidates) =>
          new Set(candidates.map((candidate) => candidate.entityKey)).size ===
          candidates.length,
        "Candidate entity keys must be unique.",
      ),
    rules: z
      .array(entityRuleSchema)
      .min(1)
      .refine(
        (rules) =>
          new Set(rules.map((rule) => rule.identifier)).size === rules.length,
        "Rule identifiers must be unique.",
      ),
    automaticMatchThreshold: z.number().finite().positive().max(1).optional(),
    reviewThreshold: z.number().finite().positive().max(1).optional(),
    ambiguityMargin: z.number().finite().positive().max(1).optional(),
  },
  { strict: true },
);

const purposeAccessRuleSchema = z
  .object({
    ruleId: nonBlankStringSchema,
    effect: z.enum(["allow", "deny"]),
    roles: nonEmptyUniqueStringsSchema.optional(),
    purposes: nonEmptyUniqueStringsSchema.optional(),
    subjectRelationships: nonEmptyUniqueStringsSchema.optional(),
    dataCategories: nonEmptyUniqueStringsSchema.optional(),
    jurisdictions: nonEmptyUniqueStringsSchema.optional(),
    attributeEquals: strictJsonObjectSchema
      .refine(
        (attributes) => Object.keys(attributes).length > 0,
        "attributeEquals must not be empty.",
      )
      .optional(),
    effectiveFrom: nonBlankStringSchema.optional(),
    effectiveTo: nonBlankStringSchema.optional(),
    reason: nonBlankStringSchema,
  })
  .strict();
const purposeAccessPolicySchema = z
  .object({
    policyId: nonBlankStringSchema,
    policyVersion: nonBlankStringSchema,
    defaultEffect: z.literal("deny"),
    rules: z
      .array(purposeAccessRuleSchema)
      .refine(
        (rules) =>
          new Set(rules.map((rule) => rule.ruleId)).size === rules.length,
        "Rule IDs must be unique.",
      ),
  })
  .strict();
const purposeAccessRequestSchema = z
  .object({
    requestKey: nonBlankStringSchema,
    principalId: nonBlankStringSchema,
    principalRoles: nonEmptyUniqueStringsSchema,
    purpose: nonBlankStringSchema,
    subjectRef: nonBlankStringSchema,
    subjectRelationship: nonBlankStringSchema,
    dataCategories: nonEmptyUniqueStringsSchema,
    jurisdiction: nonBlankStringSchema,
    requestedAt: nonBlankStringSchema,
    sourceRecordRefs: nonEmptyUniqueStringsSchema,
    attributes: strictJsonObjectSchema.optional(),
  })
  .strict();
const purposeLimitedAccessToolInputSchema = guardedObjectInputSchema(
  {
    policy: purposeAccessPolicySchema,
    request: purposeAccessRequestSchema,
  },
  { strict: true },
);

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export interface T2kMcpCapabilities {
  mode: "semantic-only" | "lifecycle-read-only" | "agent-mutation";
  transport: "stdio";
  databaseConfigured: boolean;
  mutationToolsEnabled: boolean;
  actor: ReferenceLifecycleActor | null;
  tools: string[];
  omittedHumanGovernanceOperations: string[];
  inputLimits: typeof T2K_MCP_PUBLIC_INPUT_LIMITS;
}

export interface CreateT2kMcpRuntimeOptions {
  lifecycle?: PostgresReferenceLifecycle;
  connectionString?: string;
  allowMutations?: boolean;
  actorId?: string;
  autoMigrate?: boolean;
  serverName?: string;
  serverVersion?: string;
  logger?: (message: string, error?: unknown) => void;
}

export interface T2kMcpRuntime {
  server: McpServer;
  capabilities: T2kMcpCapabilities;
  close(): Promise<void>;
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function successResult(value: unknown): CallToolResult {
  const result = normalizeJson(value);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: { result },
  };
}

function safeErrorMessage(error: unknown) {
  if (
    error instanceof ReferenceLifecycleError ||
    error instanceof ReferencePolicyError ||
    error instanceof ReferenceRewardError
  ) {
    return error.message;
  }
  return "The T2K operation failed. Inspect the server log for details.";
}

function protectedTool<Input>(
  logger: (message: string, error?: unknown) => void,
  operation: (input: Input) => unknown | Promise<unknown>,
) {
  return async (input: Input): Promise<CallToolResult> => {
    try {
      return successResult(await operation(input));
    } catch (error) {
      logger("T2K MCP tool execution failed.", error);
      return {
        content: [{ type: "text", text: safeErrorMessage(error) }],
        isError: true,
      };
    }
  };
}

function requireTrimmed(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function asJsonObject(value: Record<string, unknown>): JsonObject {
  return value as unknown as JsonObject;
}

function registerSemanticTools(
  server: McpServer,
  logger: (message: string, error?: unknown) => void,
) {
  server.registerTool(
    "validate_ontology_pack",
    {
      title: "Validate T2K ontology pack",
      description:
        "Validate one ontology-pack manifest against the exact public T2K schema.",
      inputSchema: guardedObjectInputSchema({ manifest: z.unknown() }),
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, ({ manifest }: { manifest: unknown }) =>
      validateOntologyPackManifest(manifest),
    ),
  );

  server.registerTool(
    "compile_ontology_pack_set",
    {
      title: "Compile T2K ontology packs",
      description:
        "Resolve and compile ontology-pack manifests deterministically from explicit roots and context values.",
      inputSchema: guardedObjectInputSchema({
        manifests: z.array(z.unknown()).max(128),
        roots: z.array(
          z.object({
            ontologyId: z.string().min(1),
            version: z.string().min(1),
          }),
        ).max(64),
        mode: z.enum(["authoring", "deployment"]).optional(),
        contextValues: jsonObjectSchema.optional(),
      }),
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        manifests: unknown[];
        roots: Array<{ ontologyId: string; version: string }>;
        mode?: "authoring" | "deployment";
        contextValues?: Record<string, unknown>;
      }) => compileOntologyPackSet(input as CompileOntologyPackSetInput),
    ),
  );

  server.registerTool(
    "evaluate_reference_policy",
    {
      title: "Evaluate T2K reference policy",
      description:
        "Compute an action from an executable reference-policy specification and a state snapshot.",
      inputSchema: guardedObjectInputSchema({
        specification: jsonObjectSchema,
        state: jsonObjectSchema,
      }),
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        specification: Record<string, unknown>;
        state: Record<string, unknown>;
      }) =>
        evaluateReferencePolicy(
          asJsonObject(input.specification),
          asJsonObject(input.state),
        ),
    ),
  );

  server.registerTool(
    "evaluate_reference_replay",
    {
      title: "Evaluate held-out policy replay",
      description:
        "Compute held-out inverse-propensity replay for a candidate and baseline; no caller-supplied verdict is accepted.",
      inputSchema: guardedObjectInputSchema({
        candidateSpecification: jsonObjectSchema,
        baselineSpecification: jsonObjectSchema,
        episodes: z
          .array(z.unknown())
          .min(1)
          .max(T2K_MCP_PUBLIC_INPUT_LIMITS.maxCollectionEntries),
      }),
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        candidateSpecification: Record<string, unknown>;
        baselineSpecification: Record<string, unknown>;
        episodes: unknown[];
      }) =>
        evaluateReferenceReplay({
          candidateSpecification: asJsonObject(input.candidateSpecification),
          baselineSpecification: asJsonObject(input.baselineSpecification),
          episodes: input.episodes as ReferenceReplayEpisode[],
        }),
    ),
  );

  server.registerTool(
    "evaluate_reference_reward",
    {
      title: "Evaluate governed reward",
      description:
        "Compute a reward vector and guardrail-aware scalar from a declared reward specification and observations.",
      inputSchema: guardedObjectInputSchema({
        rewardSpec: z.array(z.unknown()).min(1).max(256),
        observations: z
          .array(z.unknown())
          .max(T2K_MCP_PUBLIC_INPUT_LIMITS.maxCollectionEntries),
        evidenceMode: z.enum(["legacy", "strict"]).optional(),
      }),
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        rewardSpec: unknown[];
        observations: unknown[];
        evidenceMode?: "legacy" | "strict";
      }) =>
        evaluateReferenceReward({
          rewardSpec: input.rewardSpec as RewardDimensionSpec[],
          observations: input.observations as ReferenceRewardObservation[],
          evidenceMode: input.evidenceMode,
        }),
    ),
  );

  server.registerTool(
    "map_governed_source_record",
    {
      title: "Map governed source record",
      description:
        "Deterministically map one supplied source envelope with an explicit governed mapping. Returns a canonical-record proposal and receipt only; it does not fetch, persist, authenticate, or accept the proposed facts as truth.",
      inputSchema: governedSourceMappingToolInputSchema,
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: z.infer<typeof governedSourceMappingToolInputSchema>) =>
        executeSourceMapping({
          mapping: input.mapping as OntologyPackSourceMapping,
          envelope: input.envelope as FederatedSourceEnvelope,
          expectedMappingHash: input.expectedMappingHash,
          latestAcceptedEventTime: input.latestAcceptedEventTime,
          acceptedIdempotencyRecords: input.acceptedIdempotencyRecords as
            AcceptedIdempotencyRecord[] | undefined,
        }),
    ),
  );

  server.registerTool(
    "propose_canonical_reconciliation",
    {
      title: "Propose canonical reconciliation",
      description:
        "Produce a deterministic, non-mutating reconciliation proposal from supplied mapping results and an explicit authority policy. Alternatives and evidence remain preserved; no source value is accepted, persisted, or promoted to truth.",
      inputSchema: canonicalReconciliationToolInputSchema,
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: z.infer<typeof canonicalReconciliationToolInputSchema>) =>
        reconcileCanonicalRecords({
          results: input.results as ExecuteSourceMappingResult[],
          authorityPolicy: input.authorityPolicy as CanonicalAuthorityPolicy,
        }),
    ),
  );

  server.registerTool(
    "propose_entity_link",
    {
      title: "Propose entity link",
      description:
        "Score supplied candidate identifiers and return a reversible entity-link proposal. It never creates, mutates, or merges entities; ambiguous evidence routes to review.",
      inputSchema: entityLinkToolInputSchema,
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, (input: z.infer<typeof entityLinkToolInputSchema>) =>
      resolveEntityCandidates(input as EntityResolutionInput),
    ),
  );

  server.registerTool(
    "evaluate_purpose_limited_access",
    {
      title: "Evaluate purpose-limited access",
      description:
        "Evaluate a supplied default-deny purpose-access policy and return a deterministic receipt. The result is not authentication, authorization enforcement, a credential, or permission to disclose data.",
      inputSchema: purposeLimitedAccessToolInputSchema,
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: z.infer<typeof purposeLimitedAccessToolInputSchema>) =>
        evaluatePurposeLimitedAccess(
          input.policy as PurposeLimitedAccessPolicy,
          input.request as PurposeLimitedAccessRequest,
        ),
    ),
  );
}

function registerLifecycleReadTools(
  server: McpServer,
  lifecycle: PostgresReferenceLifecycle,
  logger: (message: string, error?: unknown) => void,
) {
  server.registerTool(
    "get_active_policy",
    {
      title: "Get active T2K policy",
      description: "Read the deployed policy bound to a decision type.",
      inputSchema: guardedObjectInputSchema({
        decisionType: z.string().min(1),
      }),
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, ({ decisionType }: { decisionType: string }) =>
      lifecycle.getActivePolicy(decisionType),
    ),
  );

  server.registerTool(
    "get_lifecycle_snapshot",
    {
      title: "Get T2K lifecycle snapshot",
      description:
        "Read the local reference lifecycle state, reward aggregates, and event-chain status.",
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, () => lifecycle.snapshot()),
  );

  server.registerTool(
    "verify_event_chain",
    {
      title: "Verify T2K event chain",
      description: "Verify the append-only local lifecycle event hash chain.",
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, () => lifecycle.verifyEventChain()),
  );
}

function registerLifecycleMutationTools(
  server: McpServer,
  lifecycle: PostgresReferenceLifecycle,
  actor: ReferenceLifecycleActor,
  logger: (message: string, error?: unknown) => void,
) {
  server.registerTool(
    "create_reasoning_policy",
    {
      title: "Create T2K reasoning policy",
      description:
        "Create a local reasoning-policy family as the configured MCP agent.",
      inputSchema: guardedObjectInputSchema({
        policyKey: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        decisionType: z.string().min(1),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        policyKey: string;
        label: string;
        description?: string;
        decisionType: string;
      }) => lifecycle.createPolicy(input, actor),
    ),
  );

  server.registerTool(
    "propose_policy_version",
    {
      title: "Propose T2K policy version",
      description:
        "Propose an executable local policy version. Acceptance and deployment remain human-only outside MCP.",
      inputSchema: guardedObjectInputSchema({
        policyKey: z.string().min(1),
        policyVersion: z.string().min(1),
        learningMode: learningModeSchema,
        specification: jsonObjectSchema,
        rewardSpec: z.array(z.unknown()).min(1),
        parentVersionId: z.string().nullable().optional(),
        rationale: z.string().min(1),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        policyKey: string;
        policyVersion: string;
        learningMode:
          | "none"
          | "supervised_feedback"
          | "contextual_bandit"
          | "sequential_rl"
          | "optimization";
        specification: Record<string, unknown>;
        rewardSpec: unknown[];
        parentVersionId?: string | null;
        rationale: string;
      }) =>
        lifecycle.createPolicyVersion(
          input.policyKey,
          {
            policyVersion: input.policyVersion,
            learningMode: input.learningMode,
            specification: asJsonObject(input.specification),
            rewardSpec: input.rewardSpec as RewardDimensionSpec[],
            parentVersionId: input.parentVersionId,
            rationale: input.rationale,
          },
          actor,
        ),
    ),
  );

  server.registerTool(
    "create_decision_context",
    {
      title: "Create T2K Decision Context",
      description:
        "Freeze current state, objective, constraints, authority, policy binding, and learning contract.",
      inputSchema: guardedObjectInputSchema({
        contextKey: z.string().min(1),
        question: z.string().min(1),
        decisionType: z.string().min(1),
        stateSnapshot: jsonObjectSchema,
        objective: jsonObjectSchema,
        constraints: z.array(z.unknown()).optional(),
        requiredAuthority: jsonObjectSchema.optional(),
        learningContract: jsonObjectSchema,
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        contextKey: string;
        question: string;
        decisionType: string;
        stateSnapshot: Record<string, unknown>;
        objective: Record<string, unknown>;
        constraints?: unknown[];
        requiredAuthority?: Record<string, unknown>;
        learningContract: Record<string, unknown>;
      }) =>
        lifecycle.createDecisionContext(
          {
            contextKey: input.contextKey,
            question: input.question,
            decisionType: input.decisionType,
            stateSnapshot: asJsonObject(input.stateSnapshot),
            objective: asJsonObject(input.objective),
            constraints: input.constraints as JsonValue[] | undefined,
            requiredAuthority: input.requiredAuthority
              ? asJsonObject(input.requiredAuthority)
              : undefined,
            learningContract:
              input.learningContract as unknown as DecisionLearningContract,
          },
          actor,
        ),
    ),
  );

  server.registerTool(
    "compute_recommendation",
    {
      title: "Compute T2K recommendation",
      description:
        "Run the policy frozen in a Decision Context. Human authorization remains outside MCP.",
      inputSchema: guardedObjectInputSchema({
        contextKey: z.string().min(1),
        recommendationKey: z.string().min(1),
        behaviorProbability: z.number().positive().max(1).optional(),
        rationale: z.string().optional(),
        reasoningTrace: jsonObjectSchema.optional(),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        contextKey: string;
        recommendationKey: string;
        behaviorProbability?: number;
        rationale?: string;
        reasoningTrace?: Record<string, unknown>;
      }) =>
        lifecycle.recommend(
          input.contextKey,
          {
            recommendationKey: input.recommendationKey,
            behaviorProbability: input.behaviorProbability,
            rationale: input.rationale,
            reasoningTrace: input.reasoningTrace
              ? asJsonObject(input.reasoningTrace)
              : undefined,
          },
          actor,
        ),
    ),
  );

  server.registerTool(
    "open_decision_episode",
    {
      title: "Open T2K decision episode",
      description:
        "Open an episode from an already human-authorized decision and its immutable context binding.",
      inputSchema: guardedObjectInputSchema({
        episodeKey: z.string().min(1),
        contextKey: z.string().min(1),
        authorizedDecisionId: z.string().min(1),
        policyVersionId: z.string().optional(),
        externalEffect: z.boolean().optional(),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        episodeKey: string;
        contextKey: string;
        authorizedDecisionId: string;
        policyVersionId?: string;
        externalEffect?: boolean;
      }) => lifecycle.openEpisode(input, actor),
    ),
  );

  server.registerTool(
    "record_execution_receipt",
    {
      title: "Record T2K execution receipt",
      description:
        "Record connector evidence, reconciliation state, and rollback contract for an open episode.",
      inputSchema: guardedObjectInputSchema({
        episodeId: z.string().min(1),
        receiptKey: z.string().min(1),
        idempotencyKey: z.string().min(1),
        connectorRef: z.string().min(1),
        externalTransactionId: z.string().nullable().optional(),
        outcome: z.enum(["succeeded", "failed", "unknown"]),
        requestHash: z.string().min(1),
        responseHash: z.string().min(1),
        response: jsonObjectSchema.optional(),
        error: jsonObjectSchema.optional(),
        rollbackContract: jsonObjectSchema.optional(),
        reconciliationStatus: z.enum(["pending", "reconciled", "mismatch"]),
        receivedAt: z.string().optional(),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        episodeId: string;
        receiptKey: string;
        idempotencyKey: string;
        connectorRef: string;
        externalTransactionId?: string | null;
        outcome: "succeeded" | "failed" | "unknown";
        requestHash: string;
        responseHash: string;
        response?: Record<string, unknown>;
        error?: Record<string, unknown>;
        rollbackContract?: Record<string, unknown>;
        reconciliationStatus: "pending" | "reconciled" | "mismatch";
        receivedAt?: string;
      }) =>
        lifecycle.recordExecutionReceipt(
          input.episodeId,
          {
            receiptKey: input.receiptKey,
            idempotencyKey: input.idempotencyKey,
            connectorRef: input.connectorRef,
            externalTransactionId: input.externalTransactionId,
            outcome: input.outcome,
            requestHash: input.requestHash,
            responseHash: input.responseHash,
            response: input.response ? asJsonObject(input.response) : undefined,
            error: input.error ? asJsonObject(input.error) : undefined,
            rollbackContract: input.rollbackContract
              ? asJsonObject(input.rollbackContract)
              : undefined,
            reconciliationStatus: input.reconciliationStatus,
            receivedAt: input.receivedAt,
          },
          actor,
        ),
    ),
  );

  server.registerTool(
    "record_observation",
    {
      title: "Record T2K observation",
      description:
        "Attach provenance-bearing outcome evidence to an open decision episode.",
      inputSchema: guardedObjectInputSchema({
        episodeId: z.string().min(1),
        measureRef: z.string().min(1),
        observedValue: z.unknown(),
        baselineValue: z.unknown().nullable().optional(),
        unit: z.string().nullable().optional(),
        observationWindow: z.string().min(1),
        sourceRefs: z.array(z.string().min(1)).optional(),
        provenance: jsonObjectSchema.optional(),
        attributionConfidence: z.number().min(0).max(1).nullable().optional(),
        observedAt: z.string().min(1),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        episodeId: string;
        measureRef: string;
        observedValue: unknown;
        baselineValue?: unknown;
        unit?: string | null;
        observationWindow: string;
        sourceRefs?: string[];
        provenance?: Record<string, unknown>;
        attributionConfidence?: number | null;
        observedAt: string;
      }) =>
        lifecycle.recordObservation(
          input.episodeId,
          {
            measureRef: input.measureRef,
            observedValue: input.observedValue as JsonValue,
            baselineValue: input.baselineValue as JsonValue | null | undefined,
            unit: input.unit,
            observationWindow: input.observationWindow,
            sourceRefs: input.sourceRefs,
            provenance: input.provenance
              ? asJsonObject(input.provenance)
              : undefined,
            attributionConfidence: input.attributionConfidence,
            observedAt: input.observedAt,
          },
          actor,
        ),
    ),
  );

  server.registerTool(
    "assess_reward",
    {
      title: "Assess T2K reward",
      description:
        "Compute the frozen reward contract from recorded observations; the caller cannot provide a verdict.",
      inputSchema: guardedObjectInputSchema({
        episodeId: z.string().min(1),
        assessmentKey: z.string().min(1),
        attribution: jsonObjectSchema.optional(),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        episodeId: string;
        assessmentKey: string;
        attribution?: Record<string, unknown>;
      }) =>
        lifecycle.assessReward(
          input.episodeId,
          {
            assessmentKey: input.assessmentKey,
            attribution: input.attribution
              ? asJsonObject(input.attribution)
              : undefined,
          },
          actor,
        ),
    ),
  );

  server.registerTool(
    "propose_learning_candidate",
    {
      title: "Propose T2K learning candidate",
      description:
        "Propose a policy candidate from closed training episodes. Evaluation and promotion remain human-only outside MCP.",
      inputSchema: guardedObjectInputSchema({
        candidateKey: z.string().min(1),
        policyKey: z.string().min(1),
        sourcePolicyVersionId: z.string().min(1),
        proposedPolicyVersion: z.string().min(1),
        proposedSpecification: jsonObjectSchema,
        proposedRewardSpec: z.array(z.unknown()).min(1).optional(),
        trainingEpisodeIds: z.array(z.string().min(1)).min(1),
        rationale: z.string().min(1),
      }),
      outputSchema,
      annotations: mutationAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        candidateKey: string;
        policyKey: string;
        sourcePolicyVersionId: string;
        proposedPolicyVersion: string;
        proposedSpecification: Record<string, unknown>;
        proposedRewardSpec?: unknown[];
        trainingEpisodeIds: string[];
        rationale: string;
      }) =>
        lifecycle.createCandidate(
          {
            candidateKey: input.candidateKey,
            policyKey: input.policyKey,
            sourcePolicyVersionId: input.sourcePolicyVersionId,
            proposedPolicyVersion: input.proposedPolicyVersion,
            proposedSpecification: asJsonObject(input.proposedSpecification),
            proposedRewardSpec: input.proposedRewardSpec as
              RewardDimensionSpec[] | undefined,
            trainingEpisodeIds: input.trainingEpisodeIds,
            rationale: input.rationale,
          },
          actor,
        ),
    ),
  );
}

export async function createT2kMcpRuntime(
  options: CreateT2kMcpRuntimeOptions = {},
): Promise<T2kMcpRuntime> {
  if (options.lifecycle && options.connectionString) {
    throw new Error("Provide lifecycle or connectionString, not both.");
  }

  const allowMutations = options.allowMutations ?? false;
  const actorId = options.actorId?.trim();
  const hasLifecycleConfiguration = Boolean(
    options.lifecycle || options.connectionString,
  );
  if (allowMutations && !hasLifecycleConfiguration) {
    throw new Error("Mutation tools require a configured Postgres lifecycle.");
  }
  if (allowMutations && !actorId) {
    throw new Error("Mutation tools require a fixed actorId.");
  }
  if (options.autoMigrate && !hasLifecycleConfiguration) {
    throw new Error("autoMigrate requires a configured Postgres lifecycle.");
  }

  const logger = options.logger ?? (() => undefined);
  const ownsLifecycle = Boolean(options.connectionString);
  const lifecycle =
    options.lifecycle ??
    (options.connectionString
      ? new PostgresReferenceLifecycle({
          connectionString: options.connectionString,
          applicationName: "t2k-mcp",
        })
      : undefined);

  if (options.autoMigrate && lifecycle) {
    try {
      await lifecycle.migrate();
    } catch (error) {
      if (ownsLifecycle) {
        try {
          await lifecycle.close();
        } catch (closeError) {
          logger(
            "T2K MCP could not close its failed migration pool.",
            closeError,
          );
        }
      }
      throw error;
    }
  }

  const actor = allowMutations
    ? ({
        actorType: "agent",
        actorId: requireTrimmed(actorId, "actorId"),
      } satisfies ReferenceLifecycleActor)
    : null;
  const tools = [
    ...SEMANTIC_TOOL_NAMES,
    ...(lifecycle ? LIFECYCLE_READ_TOOL_NAMES : []),
    ...(allowMutations ? LIFECYCLE_MUTATION_TOOL_NAMES : []),
  ];
  const capabilities: T2kMcpCapabilities = {
    mode: allowMutations
      ? "agent-mutation"
      : lifecycle
        ? "lifecycle-read-only"
        : "semantic-only",
    transport: "stdio",
    databaseConfigured: Boolean(lifecycle),
    mutationToolsEnabled: allowMutations,
    actor,
    tools: [...tools],
    omittedHumanGovernanceOperations: [...T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS],
    inputLimits: T2K_MCP_PUBLIC_INPUT_LIMITS,
  };
  const server = new McpServer({
    name: options.serverName ?? "t2k-mcp",
    version: options.serverVersion ?? T2K_MCP_VERSION,
  });

  server.registerResource(
    "t2k-capabilities",
    "t2k://capabilities",
    {
      title: "T2K MCP capabilities",
      description:
        "The enabled server mode, tools, configured agent identity, and deliberately omitted human-governance operations.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(capabilities, null, 2),
        },
      ],
    }),
  );

  if (lifecycle) {
    server.registerResource(
      "t2k-lifecycle-snapshot",
      "t2k://lifecycle/snapshot",
      {
        title: "T2K lifecycle snapshot",
        description:
          "Current local reference lifecycle state and event-chain verification.",
        mimeType: "application/json",
      },
      async (uri) => {
        let body: unknown;
        try {
          body = await lifecycle.snapshot();
        } catch (error) {
          logger("T2K MCP lifecycle resource read failed.", error);
          body = { error: safeErrorMessage(error) };
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(body, null, 2),
            },
          ],
        };
      },
    );
  }

  const restoreSetRequestHandler = installRawToolCallOwnKeyGuard(server);
  try {
    registerSemanticTools(server, logger);
    if (lifecycle) registerLifecycleReadTools(server, lifecycle, logger);
    if (lifecycle && actor) {
      registerLifecycleMutationTools(server, lifecycle, actor, logger);
    }
  } finally {
    restoreSetRequestHandler();
  }

  let closed = false;
  return {
    server,
    capabilities,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await server.close();
      } finally {
        if (ownsLifecycle && lifecycle) await lifecycle.close();
      }
    },
  };
}
