import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";
import {
  ReferencePolicyError,
  ReferenceRewardError,
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  evaluateReferenceReward,
  validateOntologyPackManifest,
  type DecisionLearningContract,
  type JsonObject,
  type JsonValue,
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
  operation: (input: Input) => unknown | Promise<unknown>
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
  logger: (message: string, error?: unknown) => void
) {
  server.registerTool(
    "validate_ontology_pack",
    {
      title: "Validate T2K ontology pack",
      description:
        "Validate one ontology-pack manifest against the exact public T2K schema.",
      inputSchema: { manifest: z.unknown() },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, ({ manifest }: { manifest: unknown }) =>
      validateOntologyPackManifest(manifest)
    )
  );

  server.registerTool(
    "compile_ontology_pack_set",
    {
      title: "Compile T2K ontology packs",
      description:
        "Resolve and compile ontology-pack manifests deterministically from explicit roots and context values.",
      inputSchema: {
        manifests: z.array(z.unknown()),
        roots: z.array(
          z.object({ ontologyId: z.string().min(1), version: z.string().min(1) })
        ),
        contextValues: jsonObjectSchema.optional(),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: {
        manifests: unknown[];
        roots: Array<{ ontologyId: string; version: string }>;
        contextValues?: Record<string, unknown>;
      }) => compileOntologyPackSet(input as CompileOntologyPackSetInput)
    )
  );

  server.registerTool(
    "evaluate_reference_policy",
    {
      title: "Evaluate T2K reference policy",
      description:
        "Compute an action from an executable reference-policy specification and a state snapshot.",
      inputSchema: {
        specification: jsonObjectSchema,
        state: jsonObjectSchema,
      },
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
          asJsonObject(input.state)
        )
    )
  );

  server.registerTool(
    "evaluate_reference_replay",
    {
      title: "Evaluate held-out policy replay",
      description:
        "Compute held-out inverse-propensity replay for a candidate and baseline; no caller-supplied verdict is accepted.",
      inputSchema: {
        candidateSpecification: jsonObjectSchema,
        baselineSpecification: jsonObjectSchema,
        episodes: z.array(z.unknown()).min(1),
      },
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
        })
    )
  );

  server.registerTool(
    "evaluate_reference_reward",
    {
      title: "Evaluate governed reward",
      description:
        "Compute a reward vector and guardrail-aware scalar from a declared reward specification and observations.",
      inputSchema: {
        rewardSpec: z.array(z.unknown()).min(1),
        observations: z.array(z.unknown()),
      },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(
      logger,
      (input: { rewardSpec: unknown[]; observations: unknown[] }) =>
        evaluateReferenceReward({
          rewardSpec: input.rewardSpec as RewardDimensionSpec[],
          observations: input.observations as ReferenceRewardObservation[],
        })
    )
  );
}

function registerLifecycleReadTools(
  server: McpServer,
  lifecycle: PostgresReferenceLifecycle,
  logger: (message: string, error?: unknown) => void
) {
  server.registerTool(
    "get_active_policy",
    {
      title: "Get active T2K policy",
      description: "Read the deployed policy bound to a decision type.",
      inputSchema: { decisionType: z.string().min(1) },
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, ({ decisionType }: { decisionType: string }) =>
      lifecycle.getActivePolicy(decisionType)
    )
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
    protectedTool(logger, () => lifecycle.snapshot())
  );

  server.registerTool(
    "verify_event_chain",
    {
      title: "Verify T2K event chain",
      description: "Verify the append-only local lifecycle event hash chain.",
      outputSchema,
      annotations: readOnlyAnnotations,
    },
    protectedTool(logger, () => lifecycle.verifyEventChain())
  );
}

function registerLifecycleMutationTools(
  server: McpServer,
  lifecycle: PostgresReferenceLifecycle,
  actor: ReferenceLifecycleActor,
  logger: (message: string, error?: unknown) => void
) {
  server.registerTool(
    "create_reasoning_policy",
    {
      title: "Create T2K reasoning policy",
      description: "Create a local reasoning-policy family as the configured MCP agent.",
      inputSchema: {
        policyKey: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        decisionType: z.string().min(1),
      },
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
      }) => lifecycle.createPolicy(input, actor)
    )
  );

  server.registerTool(
    "propose_policy_version",
    {
      title: "Propose T2K policy version",
      description:
        "Propose an executable local policy version. Acceptance and deployment remain human-only outside MCP.",
      inputSchema: {
        policyKey: z.string().min(1),
        policyVersion: z.string().min(1),
        learningMode: learningModeSchema,
        specification: jsonObjectSchema,
        rewardSpec: z.array(z.unknown()).min(1),
        parentVersionId: z.string().nullable().optional(),
        rationale: z.string().min(1),
      },
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
          actor
        )
    )
  );

  server.registerTool(
    "create_decision_context",
    {
      title: "Create T2K Decision Context",
      description:
        "Freeze current state, objective, constraints, authority, policy binding, and learning contract.",
      inputSchema: {
        contextKey: z.string().min(1),
        question: z.string().min(1),
        decisionType: z.string().min(1),
        stateSnapshot: jsonObjectSchema,
        objective: jsonObjectSchema,
        constraints: z.array(z.unknown()).optional(),
        requiredAuthority: jsonObjectSchema.optional(),
        learningContract: jsonObjectSchema,
      },
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
          actor
        )
    )
  );

  server.registerTool(
    "compute_recommendation",
    {
      title: "Compute T2K recommendation",
      description:
        "Run the policy frozen in a Decision Context. Human authorization remains outside MCP.",
      inputSchema: {
        contextKey: z.string().min(1),
        recommendationKey: z.string().min(1),
        behaviorProbability: z.number().positive().max(1).optional(),
        rationale: z.string().optional(),
        reasoningTrace: jsonObjectSchema.optional(),
      },
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
          actor
        )
    )
  );

  server.registerTool(
    "open_decision_episode",
    {
      title: "Open T2K decision episode",
      description:
        "Open an episode from an already human-authorized decision and its immutable context binding.",
      inputSchema: {
        episodeKey: z.string().min(1),
        contextKey: z.string().min(1),
        authorizedDecisionId: z.string().min(1),
        policyVersionId: z.string().optional(),
        externalEffect: z.boolean().optional(),
      },
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
      }) => lifecycle.openEpisode(input, actor)
    )
  );

  server.registerTool(
    "record_execution_receipt",
    {
      title: "Record T2K execution receipt",
      description:
        "Record connector evidence, reconciliation state, and rollback contract for an open episode.",
      inputSchema: {
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
      },
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
          actor
        )
    )
  );

  server.registerTool(
    "record_observation",
    {
      title: "Record T2K observation",
      description:
        "Attach provenance-bearing outcome evidence to an open decision episode.",
      inputSchema: {
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
      },
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
          actor
        )
    )
  );

  server.registerTool(
    "assess_reward",
    {
      title: "Assess T2K reward",
      description:
        "Compute the frozen reward contract from recorded observations; the caller cannot provide a verdict.",
      inputSchema: {
        episodeId: z.string().min(1),
        assessmentKey: z.string().min(1),
        attribution: jsonObjectSchema.optional(),
      },
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
          actor
        )
    )
  );

  server.registerTool(
    "propose_learning_candidate",
    {
      title: "Propose T2K learning candidate",
      description:
        "Propose a policy candidate from closed training episodes. Evaluation and promotion remain human-only outside MCP.",
      inputSchema: {
        candidateKey: z.string().min(1),
        policyKey: z.string().min(1),
        sourcePolicyVersionId: z.string().min(1),
        proposedPolicyVersion: z.string().min(1),
        proposedSpecification: jsonObjectSchema,
        proposedRewardSpec: z.array(z.unknown()).min(1).optional(),
        trainingEpisodeIds: z.array(z.string().min(1)).min(1),
        rationale: z.string().min(1),
      },
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
              | RewardDimensionSpec[]
              | undefined,
            trainingEpisodeIds: input.trainingEpisodeIds,
            rationale: input.rationale,
          },
          actor
        )
    )
  );
}

export async function createT2kMcpRuntime(
  options: CreateT2kMcpRuntimeOptions = {}
): Promise<T2kMcpRuntime> {
  if (options.lifecycle && options.connectionString) {
    throw new Error("Provide lifecycle or connectionString, not both.");
  }

  const allowMutations = options.allowMutations ?? false;
  const actorId = options.actorId?.trim();
  const hasLifecycleConfiguration = Boolean(
    options.lifecycle || options.connectionString
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
          logger("T2K MCP could not close its failed migration pool.", closeError);
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
    omittedHumanGovernanceOperations: [
      ...T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS,
    ],
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
    })
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
      }
    );
  }

  registerSemanticTools(server, logger);
  if (lifecycle) registerLifecycleReadTools(server, lifecycle, logger);
  if (lifecycle && actor) {
    registerLifecycleMutationTools(server, lifecycle, actor, logger);
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
