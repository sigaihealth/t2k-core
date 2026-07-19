import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

import {
  aggregatePolicyRewards,
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  parseReferencePolicySpecification,
  type PolicyRewardAggregate,
  type ReferenceReplayResult,
} from "./reference-policy.js";
import {
  evaluateReferenceReward,
  type ReferenceRewardEvaluation,
} from "./reference-reward.js";
import {
  REFERENCE_LIFECYCLE_SCHEMA_SQL,
  REFERENCE_LIFECYCLE_SCHEMA_VERSION,
} from "./reference-postgres-schema.js";
import type {
  DecisionLearningContract,
  DecisionLearningMode,
  JsonObject,
  JsonValue,
  RewardDimensionSpec,
} from "./types.js";

const GENESIS_EVENT_HASH = "0".repeat(64);
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export type ReferenceActorType = "human" | "agent" | "system";

export interface ReferenceLifecycleActor {
  actorType: ReferenceActorType;
  actorId: string;
}

export interface PostgresReferenceLifecycleOptions {
  connectionString?: string;
  pool?: Pool;
  applicationName?: string;
  maxConnections?: number;
  ssl?: PoolConfig["ssl"];
}

export interface ReferencePolicyRecord {
  id: string;
  policyKey: string;
  label: string;
  description: string;
  decisionType: string;
  lifecycleStatus: "active" | "retired";
  activeVersionId: string | null;
  createdByActorType: ReferenceActorType;
  createdByActorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferencePolicyVersionRecord {
  id: string;
  policyId: string;
  policyVersion: string;
  learningMode: DecisionLearningMode;
  specification: JsonObject;
  rewardSpec: RewardDimensionSpec[];
  lifecycleStatus: "draft" | "accepted" | "deployed" | "rolled_back";
  contentHash: string;
  parentVersionId: string | null;
  rationale: string;
  evaluationSummary: JsonObject;
  proposedByActorType: ReferenceActorType;
  proposedByActorId: string;
  reviewedByActorId: string | null;
  reviewedAt: string | null;
  deployedAt: string | null;
  createdAt: string;
}

export interface ReferenceActivePolicyRecord {
  policy: ReferencePolicyRecord;
  version: ReferencePolicyVersionRecord;
}

export interface ReferenceDecisionContextRecord {
  id: string;
  contextKey: string;
  question: string;
  decisionType: string;
  stateSnapshot: JsonObject;
  objective: JsonObject;
  constraints: JsonValue[];
  requiredAuthority: JsonObject;
  learningContract: DecisionLearningContract;
  policyVersionId: string;
  policyContentHash: string;
  contextHash: string;
  createdByActorType: ReferenceActorType;
  createdByActorId: string;
  createdAt: string;
}

export interface ReferenceRecommendationRecord {
  id: string;
  decisionContextId: string;
  recommendationKey: string;
  policyVersionId: string;
  proposedAction: string;
  behaviorProbability: number;
  rationale: string;
  reasoningTrace: JsonObject;
  proposedByActorType: ReferenceActorType;
  proposedByActorId: string;
  createdAt: string;
}

export interface ReferenceAuthorizationRecord {
  id: string;
  recommendationId: string;
  selectedAction: string;
  rationale: string;
  conditions: JsonValue[];
  authorizedByActorId: string;
  authorizedAt: string;
}

export interface ReferenceEpisodeRecord {
  id: string;
  episodeKey: string;
  decisionContextId: string;
  authorizedDecisionId: string;
  policyVersionId: string;
  learningMode: DecisionLearningMode;
  stateSnapshot: JsonObject;
  learningContract: DecisionLearningContract;
  lifecycleStatus: "open" | "closed";
  externalEffect: boolean;
  openedByActorType: ReferenceActorType;
  openedByActorId: string;
  closedByActorId: string | null;
  openedAt: string;
  closedAt: string | null;
  closureRationale: string | null;
}

export interface ReferenceExecutionReceiptRecord {
  id: string;
  decisionEpisodeId: string;
  receiptKey: string;
  idempotencyKey: string;
  connectorRef: string;
  externalTransactionId: string | null;
  action: string;
  outcome: "succeeded" | "failed" | "unknown";
  requestHash: string;
  responseHash: string;
  response: JsonObject;
  error: JsonObject;
  rollbackContract: JsonObject;
  reconciliationStatus: "pending" | "reconciled" | "mismatch";
  recordedByActorType: ReferenceActorType;
  recordedByActorId: string;
  receivedAt: string;
}

export interface ReferenceObservationRecord {
  id: string;
  decisionEpisodeId: string;
  measureRef: string;
  observedValue: JsonValue;
  baselineValue: JsonValue | null;
  unit: string | null;
  observationWindow: string;
  sourceRefs: string[];
  provenance: JsonObject;
  attributionConfidence: number | null;
  recordedByActorType: ReferenceActorType;
  recordedByActorId: string;
  observedAt: string;
  createdAt: string;
}

export interface ReferenceRewardAssessmentRecord {
  id: string;
  decisionEpisodeId: string;
  assessmentKey: string;
  rewardSpecHash: string;
  dimensions: ReferenceRewardEvaluation["dimensions"];
  scalarReward: number | null;
  evaluationReward: number | null;
  attribution: JsonObject;
  lifecycleStatus: ReferenceRewardEvaluation["lifecycleStatus"];
  assessedByActorType: ReferenceActorType;
  assessedByActorId: string;
  assessedAt: string;
}

export interface ReferenceLearningCandidateRecord {
  id: string;
  candidateKey: string;
  policyId: string;
  sourcePolicyVersionId: string;
  proposedPolicyVersion: string;
  proposedSpecification: JsonObject;
  proposedRewardSpec: RewardDimensionSpec[];
  trainingEpisodeIds: string[];
  rationale: string;
  lifecycleStatus: "proposed" | "promoted" | "rejected";
  proposedByActorType: ReferenceActorType;
  proposedByActorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferencePolicyEvaluationRecord {
  id: string;
  learningCandidateId: string;
  evaluationKey: string;
  evaluationType: "historical_replay";
  baselinePolicyVersionId: string;
  holdoutEpisodeIds: string[];
  lifecycleStatus: "passed" | "failed" | "needs_review";
  metrics: ReferenceReplayResult;
  evidenceRefs: string[];
  evaluatedByActorId: string;
  notes: string;
  createdAt: string;
}

export interface ReferencePolicyPromotionRecord {
  id: string;
  learningCandidateId: string;
  promotedPolicyVersionId: string;
  previousActiveVersionId: string;
  lifecycleStatus: "accepted" | "deployed" | "rolled_back";
  reviewRationale: string;
  promotedByActorId: string;
  deployedAt: string | null;
  rolledBackByActorId: string | null;
  rolledBackAt: string | null;
  rollbackRationale: string | null;
  createdAt: string;
}

export interface ReferenceLifecycleEventRecord {
  sequence: number;
  id: string;
  eventType: string;
  objectType: string;
  objectId: string;
  actorType: ReferenceActorType;
  actorId: string;
  payload: JsonObject;
  previousHash: string;
  eventHash: string;
  createdAt: string;
}

export interface ReferenceLifecycleSnapshot {
  schemaVersion: number;
  policies: ReferencePolicyRecord[];
  policyVersions: ReferencePolicyVersionRecord[];
  contexts: ReferenceDecisionContextRecord[];
  episodes: ReferenceEpisodeRecord[];
  candidates: ReferenceLearningCandidateRecord[];
  evaluations: ReferencePolicyEvaluationRecord[];
  promotions: ReferencePolicyPromotionRecord[];
  rewardAggregates: PolicyRewardAggregate[];
  eventChain: ReferenceEventChainVerification;
}

export interface ReferenceEventChainVerification {
  valid: boolean;
  eventCount: number;
  headHash: string;
  invalidSequence: number | null;
}

export class ReferenceLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceLifecycleError";
  }
}

export class ReferenceLifecycleValidationError extends ReferenceLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceLifecycleValidationError";
  }
}

export class ReferenceLifecycleConflictError extends ReferenceLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceLifecycleConflictError";
  }
}

export class ReferenceLifecycleNotFoundError extends ReferenceLifecycleError {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceLifecycleNotFoundError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function semanticHash(value: unknown) {
  const normalized = JSON.parse(json(value));
  return createHash("sha256")
    .update(JSON.stringify(stableValue(normalized)))
    .digest("hex");
}

function compareSemanticVersions(left: string, right: string) {
  const leftMatch = SEMVER_PATTERN.exec(left);
  const rightMatch = SEMVER_PATTERN.exec(right);
  if (!leftMatch || !rightMatch) {
    throw new ReferenceLifecycleValidationError(
      "Policy versions must use semantic versioning."
    );
  }
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  const leftPrerelease = leftMatch[4];
  const rightPrerelease = rightMatch[4];
  if (!leftPrerelease && !rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;
  const leftParts = leftPrerelease.split(".");
  const rightParts = rightPrerelease.split(".");
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Math.sign(Number(leftPart) - Number(rightPart));
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart) < 0 ? -1 : 1;
  }
  return 0;
}

function json(value: unknown) {
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (item === undefined) {
        throw new ReferenceLifecycleValidationError(
          "Lifecycle values must not contain undefined."
        );
      }
      if (typeof item === "number" && !Number.isFinite(item)) {
        throw new ReferenceLifecycleValidationError(
          "Lifecycle values must contain only finite numbers."
        );
      }
      if (["bigint", "function", "symbol"].includes(typeof item)) {
        throw new ReferenceLifecycleValidationError(
          "Lifecycle values must be JSON-serializable."
        );
      }
      return item;
    });
    if (serialized === undefined) {
      throw new ReferenceLifecycleValidationError(
        "Lifecycle values must be JSON-serializable."
      );
    }
    return serialized;
  } catch (error) {
    if (error instanceof ReferenceLifecycleValidationError) throw error;
    throw new ReferenceLifecycleValidationError(
      "Lifecycle values must be acyclic JSON data."
    );
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReferenceLifecycleValidationError(`${label} is required.`);
  }
  return value.trim();
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReferenceLifecycleValidationError(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function requireActor(actor: ReferenceLifecycleActor) {
  if (!actor || !["human", "agent", "system"].includes(actor.actorType)) {
    throw new ReferenceLifecycleValidationError(
      "actor.actorType must be human, agent, or system."
    );
  }
  return {
    actorType: actor.actorType,
    actorId: requireText(actor.actorId, "actor.actorId"),
  };
}

function requireHuman(actor: ReferenceLifecycleActor, operation: string) {
  const validated = requireActor(actor);
  if (validated.actorType !== "human") {
    throw new ReferenceLifecycleValidationError(
      `${operation} requires an explicit human actor.`
    );
  }
  return validated;
}

function requireDifferentActor(
  actorId: string,
  priorActorId: string,
  message: string
) {
  if (actorId === priorActorId) {
    throw new ReferenceLifecycleConflictError(message);
  }
}

function requireProbability(value: number | undefined) {
  const probability = value ?? 1;
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) {
    throw new ReferenceLifecycleValidationError(
      "behaviorProbability must be in (0, 1]."
    );
  }
  return probability;
}

function requireTimestamp(value: string, label: string) {
  const timestamp = requireText(value, label);
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw new ReferenceLifecycleValidationError(`${label} must be an ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function requireUniqueIds(values: string[], label: string) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ReferenceLifecycleValidationError(`${label} requires at least one id.`);
  }
  const normalized = values.map((value, index) =>
    requireText(value, `${label}[${index}]`)
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new ReferenceLifecycleValidationError(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function stringArrayField(
  object: JsonObject,
  field: string,
  label: string
): string[] | null {
  const value = object[field];
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new ReferenceLifecycleValidationError(
      `${label}.${field} must be a non-empty string array.`
    );
  }
  return value.map((item) => (item as string).trim());
}

function allowedActions(actionSchema: JsonObject) {
  const allowed = stringArrayField(
    actionSchema,
    "allowed",
    "learningContract.actionSchema"
  );
  const enumeration = stringArrayField(
    actionSchema,
    "enum",
    "learningContract.actionSchema"
  );
  if (allowed && enumeration) {
    const allowedSet = new Set(allowed);
    if (
      allowedSet.size !== new Set(enumeration).size ||
      enumeration.some((action) => !allowedSet.has(action))
    ) {
      throw new ReferenceLifecycleValidationError(
        "learningContract.actionSchema.allowed and enum must agree."
      );
    }
  }
  return allowed ?? enumeration;
}

function assertStateContract(state: JsonObject, stateSchema: JsonObject) {
  const required = stringArrayField(
    stateSchema,
    "required",
    "learningContract.stateSchema"
  );
  for (const path of required ?? []) {
    if (valueAtPath(state, path) === undefined) {
      throw new ReferenceLifecycleValidationError(
        `stateSnapshot is missing required path ${path}.`
      );
    }
  }
}

function assertPolicyActionContract(
  specification: JsonObject,
  actionSchema: JsonObject
) {
  const allowed = allowedActions(actionSchema);
  if (!allowed) return;
  const allowedSet = new Set(allowed);
  const policy = parseReferencePolicySpecification(specification);
  const outputs = [policy.defaultAction, ...policy.rules.map((rule) => rule.action)];
  const unsupported = outputs.filter((action) => !allowedSet.has(action));
  if (unsupported.length > 0) {
    throw new ReferenceLifecycleValidationError(
      `The deployed policy can emit actions outside the learning contract: ${[
        ...new Set(unsupported),
      ].join(", ")}.`
    );
  }
}

function assertCandidateEvaluationNotWeaker(
  candidateSpecification: JsonObject,
  sourceSpecification: JsonObject
) {
  const candidate = parseReferencePolicySpecification(candidateSpecification);
  const source = parseReferencePolicySpecification(sourceSpecification);
  const weakened = [
    candidate.evaluation.minimumEpisodes < source.evaluation.minimumEpisodes
      ? "minimumEpisodes"
      : null,
    candidate.evaluation.minimumImprovement <
    source.evaluation.minimumImprovement
      ? "minimumImprovement"
      : null,
    candidate.evaluation.confidenceZ < source.evaluation.confidenceZ
      ? "confidenceZ"
      : null,
    candidate.evaluation.minimumCoverage < source.evaluation.minimumCoverage
      ? "minimumCoverage"
      : null,
  ].filter((field): field is string => field !== null);
  if (weakened.length > 0) {
    throw new ReferenceLifecycleValidationError(
      `Candidate evaluation cannot weaken source gates: ${weakened.join(", ")}.`
    );
  }
}

function requireLearningContract(value: DecisionLearningContract) {
  const contract = requireObject(value, "learningContract") as unknown as DecisionLearningContract;
  if (
    ![
      "none",
      "supervised_feedback",
      "contextual_bandit",
      "sequential_rl",
      "optimization",
    ].includes(contract.mode)
  ) {
    throw new ReferenceLifecycleValidationError(
      "learningContract.mode is not supported."
    );
  }
  const stateSchema = requireObject(
    contract.stateSchema,
    "learningContract.stateSchema"
  );
  const actionSchema = requireObject(
    contract.actionSchema,
    "learningContract.actionSchema"
  );
  stringArrayField(stateSchema, "required", "learningContract.stateSchema");
  allowedActions(actionSchema);
  if (!Array.isArray(contract.rewardSpec) || contract.rewardSpec.length === 0) {
    throw new ReferenceLifecycleValidationError(
      "learningContract.rewardSpec requires at least one dimension."
    );
  }
  evaluateReferenceReward({ rewardSpec: contract.rewardSpec, observations: [] });
  for (const [field, fieldValue] of [
    ["observationSchedule", contract.observationSchedule],
    ["terminalConditions", contract.terminalConditions],
  ] as const) {
    if (
      !Array.isArray(fieldValue) ||
      fieldValue.some((item) => typeof item !== "string" || !item.trim())
    ) {
      throw new ReferenceLifecycleValidationError(
        `learningContract.${field} must be a string array.`
      );
    }
  }
  if (!Array.isArray(contract.safetyConstraints)) {
    throw new ReferenceLifecycleValidationError(
      "learningContract.safetyConstraints must be an array."
    );
  }
  requireObject(
    contract.explorationPolicy,
    "learningContract.explorationPolicy"
  );
  requireObject(contract.promotionCriteria, "learningContract.promotionCriteria");
  return contract;
}

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function camelizeRow<T>(row: QueryResultRow): T {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    record[camelKey(key)] = value instanceof Date ? value.toISOString() : value;
  }
  return record as T;
}

function postgresError(error: unknown, fallback: string): never {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "23505") {
      throw new ReferenceLifecycleConflictError(fallback);
    }
    if (error.code === "23503" || error.code === "23514") {
      throw new ReferenceLifecycleValidationError(fallback);
    }
  }
  throw error;
}

async function one<Row extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[],
  notFoundMessage: string
) {
  const result = await client.query<Row>(text, values);
  if (!result.rows[0]) {
    throw new ReferenceLifecycleNotFoundError(notFoundMessage);
  }
  return result.rows[0];
}

export class PostgresReferenceLifecycle {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(options: PostgresReferenceLifecycleOptions) {
    if (options.pool && options.connectionString) {
      throw new ReferenceLifecycleValidationError(
        "Provide either pool or connectionString, not both."
      );
    }
    if (!options.pool && !options.connectionString) {
      throw new ReferenceLifecycleValidationError(
        "Postgres connectionString or pool is required."
      );
    }
    this.ownsPool = !options.pool;
    this.pool =
      options.pool ??
      new Pool({
        connectionString: options.connectionString,
        application_name: options.applicationName ?? "t2k-reference-lifecycle",
        max: options.maxConnections ?? 5,
        ssl: options.ssl,
      });
  }

  async migrate() {
    await this.pool.query(REFERENCE_LIFECYCLE_SCHEMA_SQL);
    return REFERENCE_LIFECYCLE_SCHEMA_VERSION;
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendEvent(
    client: PoolClient,
    input: {
      eventType: string;
      objectType: string;
      objectId: string;
      actor: ReferenceLifecycleActor;
      payload?: JsonObject;
    }
  ) {
    const actor = requireActor(input.actor);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('t2k_reference.lifecycle_events'))"
    );
    const previous = await client.query<{ event_hash: string }>(
      `SELECT event_hash
       FROM t2k_reference.lifecycle_events
       ORDER BY sequence DESC
       LIMIT 1`
    );
    const previousHash = previous.rows[0]?.event_hash ?? GENESIS_EVENT_HASH;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = input.payload ?? {};
    const eventBody = {
      id,
      eventType: input.eventType,
      objectType: input.objectType,
      objectId: input.objectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      payload,
      createdAt,
    };
    const eventHash = createHash("sha256")
      .update(previousHash)
      .update(JSON.stringify(stableValue(eventBody)))
      .digest("hex");
    await client.query(
      `INSERT INTO t2k_reference.lifecycle_events (
         id, event_type, object_type, object_id, actor_type, actor_id,
         payload, previous_hash, event_hash, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        input.eventType,
        input.objectType,
        input.objectId,
        actor.actorType,
        actor.actorId,
        json(payload),
        previousHash,
        eventHash,
        createdAt,
      ]
    );
  }

  async createPolicy(
    input: {
      policyKey: string;
      label: string;
      description?: string;
      decisionType: string;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    return this.transaction(async (client) => {
      const id = randomUUID();
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.reasoning_policies (
             id, policy_key, label, description, decision_type,
             created_by_actor_type, created_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            id,
            requireText(input.policyKey, "policyKey"),
            requireText(input.label, "label"),
            input.description?.trim() ?? "",
            requireText(input.decisionType, "decisionType"),
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "policy_created",
          objectType: "reasoning_policy",
          objectId: id,
          actor,
          payload: { policyKey: input.policyKey, decisionType: input.decisionType },
        });
        return camelizeRow<ReferencePolicyRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "policyKey or decisionType already exists.");
      }
    });
  }

  async createPolicyVersion(
    policyKey: string,
    input: {
      policyVersion: string;
      learningMode: DecisionLearningMode;
      specification: JsonObject;
      rewardSpec: RewardDimensionSpec[];
      parentVersionId?: string | null;
      rationale: string;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    const normalizedPolicyKey = requireText(policyKey, "policyKey");
    const version = requireText(input.policyVersion, "policyVersion");
    if (!SEMVER_PATTERN.test(version)) {
      throw new ReferenceLifecycleValidationError(
        "policyVersion must be a semantic version."
      );
    }
    const specification = requireObject(input.specification, "specification");
    parseReferencePolicySpecification(specification);
    if (!Array.isArray(input.rewardSpec) || input.rewardSpec.length === 0) {
      throw new ReferenceLifecycleValidationError("rewardSpec is required.");
    }
    evaluateReferenceReward({ rewardSpec: input.rewardSpec, observations: [] });
    return this.transaction(async (client) => {
      const policy = await one<{ id: string }>(
        client,
        `SELECT id FROM t2k_reference.reasoning_policies
         WHERE policy_key = $1 AND lifecycle_status = 'active'
         FOR UPDATE`,
        [normalizedPolicyKey],
        "Reasoning policy not found."
      );
      let parentContentHash: string | null = null;
      if (input.parentVersionId) {
        const parent = await one<{
          content_hash: string;
          policy_version: string;
        }>(
          client,
          `SELECT content_hash, policy_version
           FROM t2k_reference.reasoning_policy_versions
           WHERE id = $1 AND policy_id = $2`,
          [input.parentVersionId, policy.id],
          "parentVersionId does not belong to this policy."
        );
        if (compareSemanticVersions(version, parent.policy_version) <= 0) {
          throw new ReferenceLifecycleValidationError(
            "A child policy version must be greater than its parent version."
          );
        }
        parentContentHash = parent.content_hash;
      }
      const id = randomUUID();
      const contentHash = semanticHash({
        policyKey: normalizedPolicyKey,
        policyVersion: version,
        learningMode: input.learningMode,
        specification,
        rewardSpec: input.rewardSpec,
        parentContentHash,
      });
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.reasoning_policy_versions (
             id, policy_id, policy_version, learning_mode, specification,
             reward_spec, content_hash, parent_version_id, rationale,
             proposed_by_actor_type, proposed_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            policy.id,
            version,
            input.learningMode,
            json(specification),
            json(input.rewardSpec),
            contentHash,
            input.parentVersionId ?? null,
            requireText(input.rationale, "rationale"),
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "policy_version_proposed",
          objectType: "reasoning_policy_version",
          objectId: id,
          actor,
          payload: { policyId: policy.id, policyVersion: version, contentHash },
        });
        return camelizeRow<ReferencePolicyVersionRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "This policy version or semantic content already exists.");
      }
    });
  }

  async acceptPolicyVersion(
    policyKey: string,
    policyVersion: string,
    rationale: string,
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Policy acceptance");
    return this.transaction(async (client) => {
      const row = await one<{
        id: string;
        lifecycle_status: string;
        proposed_by_actor_id: string;
      }>(
        client,
        `SELECT versions.id, versions.lifecycle_status, versions.proposed_by_actor_id
         FROM t2k_reference.reasoning_policy_versions AS versions
         INNER JOIN t2k_reference.reasoning_policies AS policies
           ON policies.id = versions.policy_id
         WHERE policies.policy_key = $1 AND versions.policy_version = $2
         FOR UPDATE OF versions`,
        [requireText(policyKey, "policyKey"), requireText(policyVersion, "policyVersion")],
        "Policy version not found."
      );
      if (row.lifecycle_status !== "draft") {
        throw new ReferenceLifecycleConflictError(
          "Only a draft policy version can be accepted."
        );
      }
      requireDifferentActor(
        actor.actorId,
        row.proposed_by_actor_id,
        "The policy proposer cannot accept the same version."
      );
      const result = await client.query(
        `UPDATE t2k_reference.reasoning_policy_versions
         SET lifecycle_status = 'accepted', reviewed_by_actor_id = $2,
             reviewed_at = NOW(), evaluation_summary = $3
         WHERE id = $1
         RETURNING *`,
        [
          row.id,
          actor.actorId,
          json({ reviewRationale: requireText(rationale, "rationale") }),
        ]
      );
      await this.appendEvent(client, {
        eventType: "policy_version_accepted",
        objectType: "reasoning_policy_version",
        objectId: row.id,
        actor,
        payload: { rationale },
      });
      return camelizeRow<ReferencePolicyVersionRecord>(result.rows[0]!);
    });
  }

  async deployPolicyVersion(
    policyKey: string,
    policyVersion: string,
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Policy deployment");
    return this.transaction(async (client) => {
      const policy = await one<{ id: string; active_version_id: string | null }>(
        client,
        `SELECT id, active_version_id
         FROM t2k_reference.reasoning_policies
         WHERE policy_key = $1
         FOR UPDATE`,
        [requireText(policyKey, "policyKey")],
        "Reasoning policy not found."
      );
      const version = await one<{ id: string; lifecycle_status: string }>(
        client,
        `SELECT id, lifecycle_status
         FROM t2k_reference.reasoning_policy_versions
         WHERE policy_id = $1 AND policy_version = $2
         FOR UPDATE`,
        [policy.id, requireText(policyVersion, "policyVersion")],
        "Policy version not found."
      );
      if (version.lifecycle_status !== "accepted") {
        throw new ReferenceLifecycleConflictError(
          "Only an accepted policy version can be deployed."
        );
      }
      const stagedPromotion = await client.query<{ id: string }>(
        `SELECT id FROM t2k_reference.policy_promotions
         WHERE promoted_policy_version_id = $1 AND lifecycle_status = 'accepted'
         LIMIT 1`,
        [version.id]
      );
      if (stagedPromotion.rows[0]) {
        throw new ReferenceLifecycleConflictError(
          "A staged candidate version must be deployed through deployPromotion()."
        );
      }
      if (policy.active_version_id) {
        await client.query(
          `UPDATE t2k_reference.reasoning_policy_versions
           SET lifecycle_status = 'accepted'
           WHERE id = $1 AND lifecycle_status = 'deployed'`,
          [policy.active_version_id]
        );
      }
      const updated = await client.query(
        `UPDATE t2k_reference.reasoning_policy_versions
         SET lifecycle_status = 'deployed', deployed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [version.id]
      );
      await client.query(
        `UPDATE t2k_reference.reasoning_policies
         SET active_version_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [policy.id, version.id]
      );
      await this.appendEvent(client, {
        eventType: "policy_version_deployed",
        objectType: "reasoning_policy_version",
        objectId: version.id,
        actor,
        payload: { previousActiveVersionId: policy.active_version_id },
      });
      return camelizeRow<ReferencePolicyVersionRecord>(updated.rows[0]!);
    });
  }

  async getActivePolicy(decisionType: string) {
    const result = await this.pool.query(
      `SELECT
         row_to_json(policies.*) AS policy,
         row_to_json(versions.*) AS version
       FROM t2k_reference.reasoning_policies AS policies
       INNER JOIN t2k_reference.reasoning_policy_versions AS versions
         ON versions.id = policies.active_version_id
       WHERE policies.decision_type = $1 AND policies.lifecycle_status = 'active'
       LIMIT 1`,
      [requireText(decisionType, "decisionType")]
    );
    if (!result.rows[0]) return null;
    return {
      policy: camelizeRow<ReferencePolicyRecord>(result.rows[0].policy),
      version: camelizeRow<ReferencePolicyVersionRecord>(result.rows[0].version),
    } satisfies ReferenceActivePolicyRecord;
  }

  async createDecisionContext(
    input: {
      contextKey: string;
      question: string;
      decisionType: string;
      stateSnapshot: JsonObject;
      objective: JsonObject;
      constraints?: JsonValue[];
      requiredAuthority?: JsonObject;
      learningContract: DecisionLearningContract;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    const decisionType = requireText(input.decisionType, "decisionType");
    const stateSnapshot = requireObject(input.stateSnapshot, "stateSnapshot");
    const objective = requireObject(input.objective, "objective");
    const learningContract = requireLearningContract(input.learningContract);
    return this.transaction(async (client) => {
      const active = await one<{
        policy_id: string;
        policy_version_id: string;
        policy_version: string;
        content_hash: string;
        specification: JsonObject;
        learning_mode: DecisionLearningMode;
        reward_spec: RewardDimensionSpec[];
      }>(
        client,
        `SELECT policies.id AS policy_id, versions.id AS policy_version_id,
                versions.policy_version, versions.content_hash, versions.specification,
                versions.learning_mode, versions.reward_spec
         FROM t2k_reference.reasoning_policies AS policies
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = policies.active_version_id
         WHERE policies.decision_type = $1
           AND policies.lifecycle_status = 'active'
           AND versions.lifecycle_status = 'deployed'
         FOR SHARE OF policies, versions`,
        [decisionType],
        "No deployed policy exists for this decisionType."
      );
      if (learningContract.mode !== active.learning_mode) {
        throw new ReferenceLifecycleValidationError(
          "Decision Context learning mode must match the deployed policy version."
        );
      }
      if (
        semanticHash(learningContract.rewardSpec) !==
        semanticHash(active.reward_spec)
      ) {
        throw new ReferenceLifecycleValidationError(
          "Decision Context rewardSpec must match the deployed policy version."
        );
      }
      assertStateContract(stateSnapshot, learningContract.stateSchema);
      assertPolicyActionContract(
        active.specification,
        learningContract.actionSchema
      );
      if (learningContract.mode === "contextual_bandit") {
        const maximumProbability = Number(
          (learningContract.explorationPolicy as JsonObject).maximumProbability ?? 0
        );
        if (maximumProbability > 0.25) {
          throw new ReferenceLifecycleValidationError(
            "Contextual-bandit exploration probability cannot exceed 0.25."
          );
        }
      }
      const id = randomUUID();
      const contextKey = requireText(input.contextKey, "contextKey");
      const constraints = input.constraints ?? [];
      const requiredAuthority = input.requiredAuthority ?? {};
      const contextHash = semanticHash({
        contextKey,
        question: input.question,
        decisionType,
        stateSnapshot,
        objective,
        constraints,
        requiredAuthority,
        learningContract,
        activePolicy: {
          policyVersionId: active.policy_version_id,
          policyVersion: active.policy_version,
          contentHash: active.content_hash,
          specification: active.specification,
        },
      });
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.decision_contexts (
             id, context_key, question, decision_type, state_snapshot, objective,
             constraints, required_authority, learning_contract, policy_version_id,
             policy_content_hash, context_hash, created_by_actor_type,
             created_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            id,
            contextKey,
            requireText(input.question, "question"),
            decisionType,
            json(stateSnapshot),
            json(objective),
            json(constraints),
            json(requiredAuthority),
            json(learningContract),
            active.policy_version_id,
            active.content_hash,
            contextHash,
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "decision_context_created",
          objectType: "decision_context",
          objectId: id,
          actor,
          payload: {
            contextKey,
            contextHash,
            policyVersionId: active.policy_version_id,
            policyContentHash: active.content_hash,
          },
        });
        return camelizeRow<ReferenceDecisionContextRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "contextKey or immutable context content already exists.");
      }
    });
  }

  async recommend(
    contextKey: string,
    input: {
      recommendationKey: string;
      behaviorProbability?: number;
      rationale?: string;
      reasoningTrace?: JsonObject;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    return this.transaction(async (client) => {
      const context = await one<{
        id: string;
        state_snapshot: JsonObject;
        learning_contract: DecisionLearningContract;
        policy_version_id: string;
        policy_content_hash: string;
        specification: JsonObject;
      }>(
        client,
        `SELECT contexts.id, contexts.state_snapshot, contexts.learning_contract,
                contexts.policy_version_id,
                contexts.policy_content_hash, versions.specification
         FROM t2k_reference.decision_contexts AS contexts
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = contexts.policy_version_id
         WHERE contexts.context_key = $1`,
        [requireText(contextKey, "contextKey")],
        "Decision Context not found."
      );
      const proposedAction = evaluateReferencePolicy(
        context.specification,
        context.state_snapshot
      );
      const allowed = allowedActions(context.learning_contract.actionSchema);
      if (allowed && !allowed.includes(proposedAction)) {
        throw new ReferenceLifecycleConflictError(
          "The frozen policy produced an action outside the frozen learning contract."
        );
      }
      const id = randomUUID();
      const behaviorProbability = requireProbability(input.behaviorProbability);
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.recommendations (
             id, decision_context_id, recommendation_key, policy_version_id,
             proposed_action, behavior_probability, rationale, reasoning_trace,
             proposed_by_actor_type, proposed_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            id,
            context.id,
            requireText(input.recommendationKey, "recommendationKey"),
            context.policy_version_id,
            proposedAction,
            behaviorProbability,
            input.rationale?.trim() || "Computed by the deployed T2K reference policy.",
            json({
              ...(input.reasoningTrace ?? {}),
              policyContentHash: context.policy_content_hash,
            }),
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "recommendation_computed",
          objectType: "recommendation",
          objectId: id,
          actor,
          payload: {
            decisionContextId: context.id,
            policyVersionId: context.policy_version_id,
            proposedAction,
            behaviorProbability,
          },
        });
        return camelizeRow<ReferenceRecommendationRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "recommendationKey already exists.");
      }
    });
  }

  async authorizeRecommendation(
    recommendationId: string,
    input: { rationale: string; conditions?: JsonValue[] },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Decision authorization");
    return this.transaction(async (client) => {
      const recommendation = await one<{
        id: string;
        proposed_action: string;
        proposed_by_actor_id: string;
      }>(
        client,
        `SELECT id, proposed_action, proposed_by_actor_id
         FROM t2k_reference.recommendations
         WHERE id = $1
         FOR UPDATE`,
        [requireText(recommendationId, "recommendationId")],
        "Recommendation not found."
      );
      requireDifferentActor(
        actor.actorId,
        recommendation.proposed_by_actor_id,
        "The recommendation author cannot authorize the same decision."
      );
      const id = randomUUID();
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.authorized_decisions (
             id, recommendation_id, selected_action, rationale, conditions,
             authorized_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            id,
            recommendation.id,
            recommendation.proposed_action,
            requireText(input.rationale, "rationale"),
            json(input.conditions ?? []),
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "decision_authorized",
          objectType: "authorized_decision",
          objectId: id,
          actor,
          payload: {
            recommendationId: recommendation.id,
            selectedAction: recommendation.proposed_action,
          },
        });
        return camelizeRow<ReferenceAuthorizationRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "This recommendation is already authorized.");
      }
    });
  }

  async openEpisode(
    input: {
      episodeKey: string;
      contextKey: string;
      authorizedDecisionId: string;
      policyVersionId?: string;
      externalEffect?: boolean;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    return this.transaction(async (client) => {
      const binding = await one<{
        context_id: string;
        policy_version_id: string;
        state_snapshot: JsonObject;
        learning_contract: DecisionLearningContract;
        learning_mode: DecisionLearningMode;
        authorization_id: string;
      }>(
        client,
        `SELECT contexts.id AS context_id, contexts.policy_version_id,
                contexts.state_snapshot, contexts.learning_contract,
                versions.learning_mode, authorizations.id AS authorization_id
         FROM t2k_reference.decision_contexts AS contexts
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = contexts.policy_version_id
         INNER JOIN t2k_reference.recommendations AS recommendations
           ON recommendations.decision_context_id = contexts.id
         INNER JOIN t2k_reference.authorized_decisions AS authorizations
           ON authorizations.recommendation_id = recommendations.id
         WHERE contexts.context_key = $1 AND authorizations.id = $2`,
        [
          requireText(input.contextKey, "contextKey"),
          requireText(input.authorizedDecisionId, "authorizedDecisionId"),
        ],
        "The Decision Context and authorization binding was not found."
      );
      if (
        input.policyVersionId &&
        input.policyVersionId !== binding.policy_version_id
      ) {
        throw new ReferenceLifecycleConflictError(
          "policyVersionId does not match the immutable Decision Context binding."
        );
      }
      const id = randomUUID();
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.decision_episodes (
             id, episode_key, decision_context_id, authorized_decision_id,
             policy_version_id, learning_mode, state_snapshot, learning_contract,
             external_effect, opened_by_actor_type, opened_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            requireText(input.episodeKey, "episodeKey"),
            binding.context_id,
            binding.authorization_id,
            binding.policy_version_id,
            binding.learning_mode,
            json(binding.state_snapshot),
            json(binding.learning_contract),
            input.externalEffect ?? true,
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "decision_episode_opened",
          objectType: "decision_episode",
          objectId: id,
          actor,
          payload: {
            contextId: binding.context_id,
            policyVersionId: binding.policy_version_id,
            authorizationId: binding.authorization_id,
          },
        });
        return camelizeRow<ReferenceEpisodeRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "episodeKey or authorization binding already exists.");
      }
    });
  }

  async recordExecutionReceipt(
    episodeId: string,
    input: {
      receiptKey: string;
      idempotencyKey: string;
      connectorRef: string;
      externalTransactionId?: string | null;
      outcome: "succeeded" | "failed" | "unknown";
      requestHash: string;
      responseHash: string;
      response?: JsonObject;
      error?: JsonObject;
      rollbackContract?: JsonObject;
      reconciliationStatus: "pending" | "reconciled" | "mismatch";
      receivedAt?: string;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    return this.transaction(async (client) => {
      const episode = await one<{
        id: string;
        lifecycle_status: string;
        external_effect: boolean;
        selected_action: string;
      }>(
        client,
        `SELECT episodes.id, episodes.lifecycle_status, episodes.external_effect,
                authorizations.selected_action
         FROM t2k_reference.decision_episodes AS episodes
         INNER JOIN t2k_reference.authorized_decisions AS authorizations
           ON authorizations.id = episodes.authorized_decision_id
         WHERE episodes.id = $1
         FOR UPDATE OF episodes`,
        [requireText(episodeId, "episodeId")],
        "Decision Episode not found."
      );
      if (episode.lifecycle_status !== "open") {
        throw new ReferenceLifecycleConflictError(
          "Execution receipts can only be recorded for an open episode."
        );
      }
      const rollbackContract = input.rollbackContract ?? {};
      if (
        episode.external_effect &&
        Object.keys(requireObject(rollbackContract, "rollbackContract")).length === 0
      ) {
        throw new ReferenceLifecycleValidationError(
          "External-effect execution requires a rollbackContract."
        );
      }
      const id = randomUUID();
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.execution_receipts (
             id, decision_episode_id, receipt_key, idempotency_key, connector_ref,
             external_transaction_id, action, outcome, request_hash, response_hash,
             response, error, rollback_contract, reconciliation_status,
             recorded_by_actor_type, recorded_by_actor_id, received_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                     $14, $15, $16, $17)
           RETURNING *`,
          [
            id,
            episode.id,
            requireText(input.receiptKey, "receiptKey"),
            requireText(input.idempotencyKey, "idempotencyKey"),
            requireText(input.connectorRef, "connectorRef"),
            input.externalTransactionId?.trim() || null,
            episode.selected_action,
            input.outcome,
            requireText(input.requestHash, "requestHash"),
            requireText(input.responseHash, "responseHash"),
            json(input.response ?? {}),
            json(input.error ?? {}),
            json(rollbackContract),
            input.reconciliationStatus,
            actor.actorType,
            actor.actorId,
            input.receivedAt
              ? requireTimestamp(input.receivedAt, "receivedAt")
              : new Date().toISOString(),
          ]
        );
        await this.appendEvent(client, {
          eventType: "execution_receipt_recorded",
          objectType: "execution_receipt",
          objectId: id,
          actor,
          payload: {
            episodeId: episode.id,
            outcome: input.outcome,
            reconciliationStatus: input.reconciliationStatus,
          },
        });
        return camelizeRow<ReferenceExecutionReceiptRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "receiptKey or idempotencyKey already exists.");
      }
    });
  }

  async recordObservation(
    episodeId: string,
    input: {
      measureRef: string;
      observedValue: JsonValue;
      baselineValue?: JsonValue | null;
      unit?: string | null;
      observationWindow: string;
      sourceRefs?: string[];
      provenance?: JsonObject;
      attributionConfidence?: number | null;
      observedAt: string;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    return this.transaction(async (client) => {
      const episode = await one<{
        id: string;
        lifecycle_status: string;
        learning_contract: DecisionLearningContract;
      }>(
        client,
        `SELECT id, lifecycle_status, learning_contract
         FROM t2k_reference.decision_episodes
         WHERE id = $1
         FOR UPDATE`,
        [requireText(episodeId, "episodeId")],
        "Decision Episode not found."
      );
      if (episode.lifecycle_status !== "open") {
        throw new ReferenceLifecycleConflictError(
          "Observations can only be recorded for an open episode."
        );
      }
      const measureRef = requireText(input.measureRef, "measureRef");
      const observationWindow = requireText(
        input.observationWindow,
        "observationWindow"
      );
      const dimension = episode.learning_contract.rewardSpec.find(
        (item) =>
          item.measureRef === measureRef &&
          item.observationWindow === observationWindow
      );
      if (!dimension) {
        throw new ReferenceLifecycleValidationError(
          "The measure and window are not declared by the frozen reward contract."
        );
      }
      if (input.observedValue === undefined) {
        throw new ReferenceLifecycleValidationError("observedValue is required.");
      }
      const sourceRefs = (input.sourceRefs ?? []).map((value, index) =>
        requireText(value, `sourceRefs[${index}]`)
      );
      const provenance = input.provenance ?? {};
      if (sourceRefs.length === 0 && Object.keys(provenance).length === 0) {
        throw new ReferenceLifecycleValidationError(
          "Observation requires sourceRefs or structured provenance."
        );
      }
      const confidence = input.attributionConfidence ?? null;
      if (
        confidence !== null &&
        (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      ) {
        throw new ReferenceLifecycleValidationError(
          "attributionConfidence must be between 0 and 1."
        );
      }
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO t2k_reference.episode_observations (
           id, decision_episode_id, measure_ref, observed_value, baseline_value,
           unit, observation_window, source_refs, provenance,
           attribution_confidence, recorded_by_actor_type, recorded_by_actor_id,
           observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          id,
          episode.id,
          measureRef,
          json(input.observedValue),
          input.baselineValue === undefined || input.baselineValue === null
            ? null
            : json(input.baselineValue),
          input.unit?.trim() || dimension.unit || null,
          observationWindow,
          json(sourceRefs),
          json(provenance),
          confidence,
          actor.actorType,
          actor.actorId,
          requireTimestamp(input.observedAt, "observedAt"),
        ]
      );
      await this.appendEvent(client, {
        eventType: "episode_observation_recorded",
        objectType: "episode_observation",
        objectId: id,
        actor,
        payload: { episodeId: episode.id, measureRef, observationWindow },
      });
      return camelizeRow<ReferenceObservationRecord>(result.rows[0]!);
    });
  }

  async assessReward(
    episodeId: string,
    input: { assessmentKey: string; attribution?: JsonObject },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    return this.transaction(async (client) => {
      const episode = await one<{
        id: string;
        lifecycle_status: string;
        learning_contract: DecisionLearningContract;
      }>(
        client,
        `SELECT id, lifecycle_status, learning_contract
         FROM t2k_reference.decision_episodes
         WHERE id = $1
         FOR UPDATE`,
        [requireText(episodeId, "episodeId")],
        "Decision Episode not found."
      );
      if (episode.lifecycle_status !== "open") {
        throw new ReferenceLifecycleConflictError(
          "Reward can only be assessed for an open episode."
        );
      }
      const observationResult = await client.query(
        `SELECT * FROM t2k_reference.episode_observations
         WHERE decision_episode_id = $1
         ORDER BY observed_at ASC, id ASC`,
        [episode.id]
      );
      const observations = observationResult.rows.map((row) =>
        camelizeRow<ReferenceObservationRecord>(row)
      );
      const reward = evaluateReferenceReward({
        rewardSpec: episode.learning_contract.rewardSpec,
        observations,
      });
      const id = randomUUID();
      const rewardSpecHash = semanticHash(episode.learning_contract.rewardSpec);
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.reward_assessments (
             id, decision_episode_id, assessment_key, reward_spec_hash,
             dimensions, scalar_reward, evaluation_reward, attribution,
             lifecycle_status, assessed_by_actor_type, assessed_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            episode.id,
            requireText(input.assessmentKey, "assessmentKey"),
            rewardSpecHash,
            json(reward.dimensions),
            reward.scalarReward,
            reward.evaluationReward,
            json(input.attribution ?? {}),
            reward.lifecycleStatus,
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "reward_assessment_computed",
          objectType: "reward_assessment",
          objectId: id,
          actor,
          payload: {
            episodeId: episode.id,
            lifecycleStatus: reward.lifecycleStatus,
            scalarReward: reward.scalarReward,
            evaluationReward: reward.evaluationReward,
            rewardSpecHash,
          },
        });
        return camelizeRow<ReferenceRewardAssessmentRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "assessmentKey already exists for this episode.");
      }
    });
  }

  async closeEpisode(
    episodeId: string,
    rationale: string,
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Episode closure");
    return this.transaction(async (client) => {
      const episode = await one<{
        id: string;
        lifecycle_status: string;
        external_effect: boolean;
      }>(
        client,
        `SELECT id, lifecycle_status, external_effect
         FROM t2k_reference.decision_episodes
         WHERE id = $1
         FOR UPDATE`,
        [requireText(episodeId, "episodeId")],
        "Decision Episode not found."
      );
      if (episode.lifecycle_status !== "open") {
        throw new ReferenceLifecycleConflictError(
          "Only an open episode can be closed."
        );
      }
      if (episode.external_effect) {
        const receipts = await client.query<{
          outcome: string;
          reconciliation_status: string;
        }>(
          `SELECT outcome, reconciliation_status
           FROM t2k_reference.execution_receipts
           WHERE decision_episode_id = $1`,
          [episode.id]
        );
        if (
          !receipts.rows.some(
            (receipt) =>
              receipt.outcome === "succeeded" &&
              receipt.reconciliation_status === "reconciled"
          )
        ) {
          throw new ReferenceLifecycleConflictError(
            "External-effect episodes require a succeeded, reconciled receipt."
          );
        }
        if (
          receipts.rows.some(
            (receipt) =>
              receipt.outcome === "unknown" ||
              receipt.reconciliation_status === "pending" ||
              receipt.reconciliation_status === "mismatch"
          )
        ) {
          throw new ReferenceLifecycleConflictError(
            "Every connector receipt must be resolved before episode closure."
          );
        }
      }
      const assessment = await one<{
        lifecycle_status: string;
        scalar_reward: number | null;
        evaluation_reward: number | null;
        assessed_by_actor_id: string;
      }>(
        client,
        `SELECT lifecycle_status, scalar_reward, evaluation_reward,
                assessed_by_actor_id
         FROM t2k_reference.reward_assessments
         WHERE decision_episode_id = $1
         ORDER BY assessed_at DESC, id DESC
         LIMIT 1`,
        [episode.id],
        "Episode closure requires a reward assessment."
      );
      if (
        !["complete", "guardrail_violation"].includes(
          assessment.lifecycle_status
        ) ||
        assessment.evaluation_reward === null
      ) {
        throw new ReferenceLifecycleConflictError(
          "Episode closure requires complete reward evidence or a terminal guardrail violation."
        );
      }
      requireDifferentActor(
        actor.actorId,
        assessment.assessed_by_actor_id,
        "The reward assessor cannot close the same episode."
      );
      const result = await client.query(
        `UPDATE t2k_reference.decision_episodes
         SET lifecycle_status = 'closed', closed_by_actor_id = $2,
             closed_at = NOW(), closure_rationale = $3
         WHERE id = $1
         RETURNING *`,
        [episode.id, actor.actorId, requireText(rationale, "rationale")]
      );
      await this.appendEvent(client, {
        eventType: "decision_episode_closed",
        objectType: "decision_episode",
        objectId: episode.id,
        actor,
        payload: {
          scalarReward: assessment.scalar_reward,
          evaluationReward: assessment.evaluation_reward,
          rewardStatus: assessment.lifecycle_status,
          rationale,
        },
      });
      return camelizeRow<ReferenceEpisodeRecord>(result.rows[0]!);
    });
  }

  async createCandidate(
    input: {
      candidateKey: string;
      policyKey: string;
      sourcePolicyVersionId: string;
      proposedPolicyVersion: string;
      proposedSpecification: JsonObject;
      proposedRewardSpec?: RewardDimensionSpec[];
      trainingEpisodeIds: string[];
      rationale: string;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireActor(actorInput);
    const trainingEpisodeIds = requireUniqueIds(
      input.trainingEpisodeIds,
      "trainingEpisodeIds"
    );
    const proposedVersion = requireText(
      input.proposedPolicyVersion,
      "proposedPolicyVersion"
    );
    if (!SEMVER_PATTERN.test(proposedVersion)) {
      throw new ReferenceLifecycleValidationError(
        "proposedPolicyVersion must be a semantic version."
      );
    }
    const proposedSpecification = requireObject(
      input.proposedSpecification,
      "proposedSpecification"
    );
    parseReferencePolicySpecification(proposedSpecification);
    return this.transaction(async (client) => {
      const source = await one<{
        policy_id: string;
        source_id: string;
        source_policy_version: string;
        specification: JsonObject;
        reward_spec: RewardDimensionSpec[];
      }>(
        client,
        `SELECT policies.id AS policy_id, versions.id AS source_id,
                versions.policy_version AS source_policy_version,
                versions.specification, versions.reward_spec
         FROM t2k_reference.reasoning_policies AS policies
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.policy_id = policies.id
         WHERE policies.policy_key = $1 AND versions.id = $2`,
        [
          requireText(input.policyKey, "policyKey"),
          requireText(input.sourcePolicyVersionId, "sourcePolicyVersionId"),
        ],
        "Source policy version not found."
      );
      assertCandidateEvaluationNotWeaker(
        proposedSpecification,
        source.specification
      );
      if (
        compareSemanticVersions(proposedVersion, source.source_policy_version) <= 0
      ) {
        throw new ReferenceLifecycleValidationError(
          "A candidate policy version must be greater than its source version."
        );
      }
      const training = await client.query<{ id: string }>(
        `SELECT episodes.id
         FROM t2k_reference.decision_episodes AS episodes
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = episodes.policy_version_id
         INNER JOIN LATERAL (
           SELECT evaluation_reward, lifecycle_status
           FROM t2k_reference.reward_assessments
           WHERE decision_episode_id = episodes.id
           ORDER BY assessed_at DESC, id DESC
           LIMIT 1
         ) AS assessments ON TRUE
         WHERE episodes.id = ANY($1::uuid[])
           AND versions.policy_id = $2
           AND episodes.lifecycle_status = 'closed'
           AND assessments.lifecycle_status IN ('complete', 'guardrail_violation')
           AND assessments.evaluation_reward IS NOT NULL`,
        [trainingEpisodeIds, source.policy_id]
      );
      if (training.rows.length !== trainingEpisodeIds.length) {
        throw new ReferenceLifecycleValidationError(
          "Every training episode must be closed, rewarded, and belong to the source policy family."
        );
      }
      const proposedRewardSpec = input.proposedRewardSpec ?? source.reward_spec;
      evaluateReferenceReward({ rewardSpec: proposedRewardSpec, observations: [] });
      if (semanticHash(proposedRewardSpec) !== semanticHash(source.reward_spec)) {
        throw new ReferenceLifecycleValidationError(
          "Reference replay cannot promote a changed rewardSpec from historical rewards."
        );
      }
      const id = randomUUID();
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.learning_candidates (
             id, candidate_key, policy_id, source_policy_version_id,
             proposed_policy_version, proposed_specification, proposed_reward_spec,
             training_episode_ids, rationale, proposed_by_actor_type,
             proposed_by_actor_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9, $10, $11)
           RETURNING *`,
          [
            id,
            requireText(input.candidateKey, "candidateKey"),
            source.policy_id,
            source.source_id,
            proposedVersion,
            json(proposedSpecification),
            json(proposedRewardSpec),
            trainingEpisodeIds,
            requireText(input.rationale, "rationale"),
            actor.actorType,
            actor.actorId,
          ]
        );
        await this.appendEvent(client, {
          eventType: "learning_candidate_proposed",
          objectType: "learning_candidate",
          objectId: id,
          actor,
          payload: {
            sourcePolicyVersionId: source.source_id,
            proposedPolicyVersion: proposedVersion,
            trainingEpisodeIds,
          },
        });
        return camelizeRow<ReferenceLearningCandidateRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "candidateKey or proposed policy version already exists.");
      }
    });
  }

  async evaluateCandidate(
    candidateId: string,
    input: {
      evaluationKey: string;
      holdoutEpisodeIds: string[];
      evidenceRefs?: string[];
      notes?: string;
    },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Policy evaluation");
    const holdoutEpisodeIds = requireUniqueIds(
      input.holdoutEpisodeIds,
      "holdoutEpisodeIds"
    );
    return this.transaction(async (client) => {
      const candidate = await one<{
        id: string;
        policy_id: string;
        source_policy_version_id: string;
        proposed_specification: JsonObject;
        training_episode_ids: string[];
        proposed_by_actor_id: string;
        baseline_specification: JsonObject;
      }>(
        client,
        `SELECT candidates.id, candidates.policy_id,
                candidates.source_policy_version_id,
                candidates.proposed_specification, candidates.training_episode_ids,
                candidates.proposed_by_actor_id,
                versions.specification AS baseline_specification
         FROM t2k_reference.learning_candidates AS candidates
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = candidates.source_policy_version_id
         WHERE candidates.id = $1 AND candidates.lifecycle_status = 'proposed'
         FOR UPDATE OF candidates`,
        [requireText(candidateId, "candidateId")],
        "Proposed learning candidate not found."
      );
      requireDifferentActor(
        actor.actorId,
        candidate.proposed_by_actor_id,
        "The candidate proposer cannot evaluate the same candidate."
      );
      const trainingIds = new Set(candidate.training_episode_ids);
      if (holdoutEpisodeIds.some((id) => trainingIds.has(id))) {
        throw new ReferenceLifecycleValidationError(
          "Training and holdout episodes must be disjoint."
        );
      }
      const evidence = await client.query<{
        id: string;
        state_snapshot: JsonObject;
        learning_mode: DecisionLearningMode;
        logged_action: string;
        behavior_probability: number;
        evaluation_reward: number | null;
        lifecycle_status: string;
      }>(
        `SELECT episodes.id, episodes.state_snapshot, episodes.learning_mode,
                authorizations.selected_action AS logged_action,
                recommendations.behavior_probability,
                assessments.evaluation_reward, assessments.lifecycle_status
         FROM t2k_reference.decision_episodes AS episodes
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = episodes.policy_version_id
         INNER JOIN t2k_reference.authorized_decisions AS authorizations
           ON authorizations.id = episodes.authorized_decision_id
         INNER JOIN t2k_reference.recommendations AS recommendations
           ON recommendations.id = authorizations.recommendation_id
         INNER JOIN LATERAL (
           SELECT evaluation_reward, lifecycle_status
           FROM t2k_reference.reward_assessments
           WHERE decision_episode_id = episodes.id
           ORDER BY assessed_at DESC, id DESC
           LIMIT 1
         ) AS assessments ON TRUE
         WHERE episodes.id = ANY($1::uuid[])
           AND versions.policy_id = $2
           AND episodes.lifecycle_status = 'closed'`,
        [holdoutEpisodeIds, candidate.policy_id]
      );
      if (
        evidence.rows.length !== holdoutEpisodeIds.length ||
        evidence.rows.some(
          (row) =>
            !["complete", "guardrail_violation"].includes(
              row.lifecycle_status
            ) || row.evaluation_reward === null
        )
      ) {
        throw new ReferenceLifecycleValidationError(
          "Every holdout episode must be closed, rewarded, and belong to the source policy family."
        );
      }
      const evidenceById = new Map(evidence.rows.map((row) => [row.id, row]));
      const orderedEvidence = holdoutEpisodeIds.map(
        (episodeId) => evidenceById.get(episodeId)!
      );
      const replay = evaluateReferenceReplay({
        candidateSpecification: candidate.proposed_specification,
        baselineSpecification: candidate.baseline_specification,
        episodes: orderedEvidence.map((row) => ({
          episodeId: row.id,
          state: row.state_snapshot,
          loggedAction: row.logged_action,
          scalarReward: row.evaluation_reward!,
          learningMode: row.learning_mode,
          behaviorProbability: row.behavior_probability,
          guardrailViolation: row.lifecycle_status === "guardrail_violation",
        })),
      });
      const id = randomUUID();
      try {
        const result = await client.query(
          `INSERT INTO t2k_reference.policy_evaluations (
             id, learning_candidate_id, evaluation_key,
             baseline_policy_version_id, holdout_episode_ids, lifecycle_status,
             metrics, evidence_refs, evaluated_by_actor_id, notes
           ) VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            id,
            candidate.id,
            requireText(input.evaluationKey, "evaluationKey"),
            candidate.source_policy_version_id,
            holdoutEpisodeIds,
            replay.status,
            json(replay),
            json(input.evidenceRefs ?? []),
            actor.actorId,
            input.notes?.trim() ?? "",
          ]
        );
        await this.appendEvent(client, {
          eventType: "policy_replay_computed",
          objectType: "policy_evaluation",
          objectId: id,
          actor,
          payload: {
            candidateId: candidate.id,
            status: replay.status,
            sampleSize: replay.sampleSize,
            estimatedImprovement: replay.estimatedImprovement,
            improvementConfidenceLower: replay.improvementConfidenceLower,
          },
        });
        return camelizeRow<ReferencePolicyEvaluationRecord>(result.rows[0]!);
      } catch (error) {
        postgresError(error, "evaluationKey already exists.");
      }
    });
  }

  async promoteCandidate(
    candidateId: string,
    input: { reviewRationale: string; deploy?: boolean },
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Candidate promotion");
    return this.transaction(async (client) => {
      const candidate = await one<{
        id: string;
        policy_id: string;
        source_policy_version_id: string;
        proposed_policy_version: string;
        proposed_specification: JsonObject;
        proposed_reward_spec: RewardDimensionSpec[];
        rationale: string;
        lifecycle_status: string;
        proposed_by_actor_id: string;
        learning_mode: DecisionLearningMode;
        parent_content_hash: string;
        policy_key: string;
      }>(
        client,
        `SELECT candidates.*, versions.learning_mode,
                versions.content_hash AS parent_content_hash,
                policies.policy_key
         FROM t2k_reference.learning_candidates AS candidates
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = candidates.source_policy_version_id
         INNER JOIN t2k_reference.reasoning_policies AS policies
           ON policies.id = candidates.policy_id
         WHERE candidates.id = $1
         FOR UPDATE OF candidates`,
        [requireText(candidateId, "candidateId")],
        "Learning candidate not found."
      );
      if (candidate.lifecycle_status !== "proposed") {
        throw new ReferenceLifecycleConflictError(
          "Only a proposed candidate can be promoted."
        );
      }
      requireDifferentActor(
        actor.actorId,
        candidate.proposed_by_actor_id,
        "The candidate proposer cannot promote the same candidate."
      );
      const evaluations = await client.query<{
        id: string;
        lifecycle_status: string;
        evaluated_by_actor_id: string;
        metrics: JsonObject;
      }>(
        `SELECT id, lifecycle_status, evaluated_by_actor_id, metrics
         FROM t2k_reference.policy_evaluations
         WHERE learning_candidate_id = $1
         ORDER BY created_at ASC`,
        [candidate.id]
      );
      if (!evaluations.rows.some((row) => row.lifecycle_status === "passed")) {
        throw new ReferenceLifecycleConflictError(
          "Promotion requires at least one computed passing evaluation."
        );
      }
      if (evaluations.rows.some((row) => row.lifecycle_status === "failed")) {
        throw new ReferenceLifecycleConflictError(
          "Promotion is blocked while any evaluation has failed."
        );
      }
      for (const evaluation of evaluations.rows) {
        requireDifferentActor(
          actor.actorId,
          evaluation.evaluated_by_actor_id,
          "The policy evaluator cannot promote the same candidate."
        );
      }
      const policy = await one<{ active_version_id: string | null }>(
        client,
        `SELECT active_version_id
         FROM t2k_reference.reasoning_policies
         WHERE id = $1
         FOR UPDATE`,
        [candidate.policy_id],
        "Reasoning policy not found."
      );
      if (policy.active_version_id !== candidate.source_policy_version_id) {
        throw new ReferenceLifecycleConflictError(
          "The candidate is stale because its source is no longer the active policy."
        );
      }
      const deploy = input.deploy ?? true;
      const versionId = randomUUID();
      const contentHash = semanticHash({
        policyKey: candidate.policy_key,
        policyVersion: candidate.proposed_policy_version,
        learningMode: candidate.learning_mode,
        specification: candidate.proposed_specification,
        rewardSpec: candidate.proposed_reward_spec,
        parentContentHash: candidate.parent_content_hash,
      });
      const evaluationSummary = {
        candidateId: candidate.id,
        evaluationIds: evaluations.rows.map((row) => row.id),
        reviewRationale: input.reviewRationale,
      };
      let versionResult;
      try {
        versionResult = await client.query(
          `INSERT INTO t2k_reference.reasoning_policy_versions (
             id, policy_id, policy_version, learning_mode, specification,
             reward_spec, lifecycle_status, content_hash, parent_version_id,
             rationale, evaluation_summary, proposed_by_actor_type,
             proposed_by_actor_id, reviewed_by_actor_id, reviewed_at, deployed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                     $12, $13, $14, NOW(), $15)
           RETURNING *`,
          [
            versionId,
            candidate.policy_id,
            candidate.proposed_policy_version,
            candidate.learning_mode,
            json(candidate.proposed_specification),
            json(candidate.proposed_reward_spec),
            deploy ? "deployed" : "accepted",
            contentHash,
            candidate.source_policy_version_id,
            candidate.rationale,
            json(evaluationSummary),
            "system",
            `candidate:${candidate.id}`,
            actor.actorId,
            deploy ? new Date().toISOString() : null,
          ]
        );
      } catch (error) {
        postgresError(error, "The promoted policy version already exists.");
      }
      if (deploy) {
        await client.query(
          `UPDATE t2k_reference.reasoning_policy_versions
           SET lifecycle_status = 'accepted'
           WHERE id = $1 AND lifecycle_status = 'deployed'`,
          [candidate.source_policy_version_id]
        );
        await client.query(
          `UPDATE t2k_reference.reasoning_policies
           SET active_version_id = $2, updated_at = NOW()
           WHERE id = $1`,
          [candidate.policy_id, versionId]
        );
      }
      await client.query(
        `UPDATE t2k_reference.learning_candidates
         SET lifecycle_status = 'promoted', updated_at = NOW()
         WHERE id = $1`,
        [candidate.id]
      );
      const promotionId = randomUUID();
      const promotionResult = await client.query(
        `INSERT INTO t2k_reference.policy_promotions (
           id, learning_candidate_id, promoted_policy_version_id,
           previous_active_version_id, lifecycle_status, review_rationale,
           promoted_by_actor_id, deployed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          promotionId,
          candidate.id,
          versionId,
          candidate.source_policy_version_id,
          deploy ? "deployed" : "accepted",
          requireText(input.reviewRationale, "reviewRationale"),
          actor.actorId,
          deploy ? new Date().toISOString() : null,
        ]
      );
      await this.appendEvent(client, {
        eventType: deploy ? "candidate_promoted_and_deployed" : "candidate_promoted",
        objectType: "policy_promotion",
        objectId: promotionId,
        actor,
        payload: {
          candidateId: candidate.id,
          fromPolicyVersionId: candidate.source_policy_version_id,
          toPolicyVersionId: versionId,
          contentHash,
        },
      });
      return {
        promotion: camelizeRow<ReferencePolicyPromotionRecord>(
          promotionResult.rows[0]!
        ),
        policyVersion: camelizeRow<ReferencePolicyVersionRecord>(
          versionResult.rows[0]!
        ),
      };
    });
  }

  async deployPromotion(
    promotionId: string,
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Promotion deployment");
    return this.transaction(async (client) => {
      const promotion = await one<{
        id: string;
        lifecycle_status: string;
        promoted_policy_version_id: string;
        previous_active_version_id: string;
        policy_id: string;
        active_version_id: string | null;
        version_status: string;
      }>(
        client,
        `SELECT promotions.id, promotions.lifecycle_status,
                promotions.promoted_policy_version_id,
                promotions.previous_active_version_id,
                versions.policy_id, versions.lifecycle_status AS version_status,
                policies.active_version_id
         FROM t2k_reference.policy_promotions AS promotions
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = promotions.promoted_policy_version_id
         INNER JOIN t2k_reference.reasoning_policies AS policies
           ON policies.id = versions.policy_id
         WHERE promotions.id = $1
         FOR UPDATE OF promotions, versions, policies`,
        [requireText(promotionId, "promotionId")],
        "Policy promotion not found."
      );
      if (
        promotion.lifecycle_status !== "accepted" ||
        promotion.version_status !== "accepted"
      ) {
        throw new ReferenceLifecycleConflictError(
          "Only an accepted staged promotion can be deployed."
        );
      }
      if (promotion.active_version_id !== promotion.previous_active_version_id) {
        throw new ReferenceLifecycleConflictError(
          "The staged promotion is stale because its source is no longer active."
        );
      }
      await client.query(
        `UPDATE t2k_reference.reasoning_policy_versions
         SET lifecycle_status = 'accepted'
         WHERE id = $1 AND lifecycle_status = 'deployed'`,
        [promotion.previous_active_version_id]
      );
      await client.query(
        `UPDATE t2k_reference.reasoning_policy_versions
         SET lifecycle_status = 'deployed', deployed_at = NOW()
         WHERE id = $1`,
        [promotion.promoted_policy_version_id]
      );
      await client.query(
        `UPDATE t2k_reference.reasoning_policies
         SET active_version_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [promotion.policy_id, promotion.promoted_policy_version_id]
      );
      const result = await client.query(
        `UPDATE t2k_reference.policy_promotions
         SET lifecycle_status = 'deployed', deployed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [promotion.id]
      );
      await this.appendEvent(client, {
        eventType: "staged_promotion_deployed",
        objectType: "policy_promotion",
        objectId: promotion.id,
        actor,
        payload: {
          fromPolicyVersionId: promotion.previous_active_version_id,
          toPolicyVersionId: promotion.promoted_policy_version_id,
        },
      });
      return camelizeRow<ReferencePolicyPromotionRecord>(result.rows[0]!);
    });
  }

  async rollbackPromotion(
    promotionId: string,
    rationale: string,
    actorInput: ReferenceLifecycleActor
  ) {
    const actor = requireHuman(actorInput, "Policy rollback");
    return this.transaction(async (client) => {
      const promotion = await one<{
        id: string;
        lifecycle_status: string;
        promoted_policy_version_id: string;
        previous_active_version_id: string;
        promoted_by_actor_id: string;
        policy_id: string;
        active_version_id: string | null;
      }>(
        client,
        `SELECT promotions.id, promotions.lifecycle_status,
                promotions.promoted_policy_version_id,
                promotions.previous_active_version_id,
                promotions.promoted_by_actor_id, versions.policy_id,
                policies.active_version_id
         FROM t2k_reference.policy_promotions AS promotions
         INNER JOIN t2k_reference.reasoning_policy_versions AS versions
           ON versions.id = promotions.promoted_policy_version_id
         INNER JOIN t2k_reference.reasoning_policies AS policies
           ON policies.id = versions.policy_id
         WHERE promotions.id = $1
         FOR UPDATE OF promotions, policies`,
        [requireText(promotionId, "promotionId")],
        "Policy promotion not found."
      );
      if (promotion.lifecycle_status !== "deployed") {
        throw new ReferenceLifecycleConflictError(
          "Only a deployed promotion can be rolled back."
        );
      }
      if (promotion.active_version_id !== promotion.promoted_policy_version_id) {
        throw new ReferenceLifecycleConflictError(
          "The promoted version is no longer active and cannot be rolled back."
        );
      }
      requireDifferentActor(
        actor.actorId,
        promotion.promoted_by_actor_id,
        "The promotion reviewer cannot roll back their own promotion."
      );
      await client.query(
        `UPDATE t2k_reference.reasoning_policy_versions
         SET lifecycle_status = 'rolled_back'
         WHERE id = $1`,
        [promotion.promoted_policy_version_id]
      );
      await client.query(
        `UPDATE t2k_reference.reasoning_policy_versions
         SET lifecycle_status = 'deployed', deployed_at = NOW()
         WHERE id = $1`,
        [promotion.previous_active_version_id]
      );
      await client.query(
        `UPDATE t2k_reference.reasoning_policies
         SET active_version_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [promotion.policy_id, promotion.previous_active_version_id]
      );
      const result = await client.query(
        `UPDATE t2k_reference.policy_promotions
         SET lifecycle_status = 'rolled_back', rolled_back_by_actor_id = $2,
             rolled_back_at = NOW(), rollback_rationale = $3
         WHERE id = $1
         RETURNING *`,
        [promotion.id, actor.actorId, requireText(rationale, "rationale")]
      );
      await this.appendEvent(client, {
        eventType: "policy_promotion_rolled_back",
        objectType: "policy_promotion",
        objectId: promotion.id,
        actor,
        payload: {
          restoredPolicyVersionId: promotion.previous_active_version_id,
          rolledBackPolicyVersionId: promotion.promoted_policy_version_id,
          rationale,
        },
      });
      return camelizeRow<ReferencePolicyPromotionRecord>(result.rows[0]!);
    });
  }

  async verifyEventChain(): Promise<ReferenceEventChainVerification> {
    const result = await this.pool.query(
      `SELECT * FROM t2k_reference.lifecycle_events ORDER BY sequence ASC`
    );
    let previousHash = GENESIS_EVENT_HASH;
    for (const row of result.rows) {
      const event = camelizeRow<ReferenceLifecycleEventRecord>(row);
      const expected = createHash("sha256")
        .update(previousHash)
        .update(
          JSON.stringify(
            stableValue({
              id: event.id,
              eventType: event.eventType,
              objectType: event.objectType,
              objectId: event.objectId,
              actorType: event.actorType,
              actorId: event.actorId,
              payload: event.payload,
              createdAt: event.createdAt,
            })
          )
        )
        .digest("hex");
      if (event.previousHash !== previousHash || event.eventHash !== expected) {
        return {
          valid: false,
          eventCount: result.rows.length,
          headHash: previousHash,
          invalidSequence: Number(event.sequence),
        };
      }
      previousHash = event.eventHash;
    }
    return {
      valid: true,
      eventCount: result.rows.length,
      headHash: previousHash,
      invalidSequence: null,
    };
  }

  async snapshot(): Promise<ReferenceLifecycleSnapshot> {
    const [policies, versions, contexts, episodes, candidates, evaluations, promotions] =
      await Promise.all([
        this.pool.query(
          "SELECT * FROM t2k_reference.reasoning_policies ORDER BY created_at"
        ),
        this.pool.query(
          "SELECT * FROM t2k_reference.reasoning_policy_versions ORDER BY created_at"
        ),
        this.pool.query(
          "SELECT * FROM t2k_reference.decision_contexts ORDER BY created_at"
        ),
        this.pool.query(
          "SELECT * FROM t2k_reference.decision_episodes ORDER BY opened_at"
        ),
        this.pool.query(
          "SELECT * FROM t2k_reference.learning_candidates ORDER BY created_at"
        ),
        this.pool.query(
          "SELECT * FROM t2k_reference.policy_evaluations ORDER BY created_at"
        ),
        this.pool.query(
          "SELECT * FROM t2k_reference.policy_promotions ORDER BY created_at"
        ),
      ]);
    const rewardRows = await this.pool.query<{
      policy_version_id: string;
      evaluation_reward: number;
      lifecycle_status: string;
    }>(
      `SELECT episodes.policy_version_id, assessments.evaluation_reward,
              assessments.lifecycle_status
       FROM t2k_reference.decision_episodes AS episodes
       INNER JOIN LATERAL (
         SELECT evaluation_reward, lifecycle_status
         FROM t2k_reference.reward_assessments
         WHERE decision_episode_id = episodes.id
         ORDER BY assessed_at DESC, id DESC
         LIMIT 1
       ) AS assessments ON TRUE
       WHERE episodes.lifecycle_status = 'closed'
         AND assessments.lifecycle_status IN ('complete', 'guardrail_violation')
         AND assessments.evaluation_reward IS NOT NULL`
    );
    return {
      schemaVersion: REFERENCE_LIFECYCLE_SCHEMA_VERSION,
      policies: policies.rows.map((row) => camelizeRow<ReferencePolicyRecord>(row)),
      policyVersions: versions.rows.map((row) =>
        camelizeRow<ReferencePolicyVersionRecord>(row)
      ),
      contexts: contexts.rows.map((row) =>
        camelizeRow<ReferenceDecisionContextRecord>(row)
      ),
      episodes: episodes.rows.map((row) =>
        camelizeRow<ReferenceEpisodeRecord>(row)
      ),
      candidates: candidates.rows.map((row) =>
        camelizeRow<ReferenceLearningCandidateRecord>(row)
      ),
      evaluations: evaluations.rows.map((row) =>
        camelizeRow<ReferencePolicyEvaluationRecord>(row)
      ),
      promotions: promotions.rows.map((row) =>
        camelizeRow<ReferencePolicyPromotionRecord>(row)
      ),
      rewardAggregates: aggregatePolicyRewards(
        rewardRows.rows.map((row) => ({
          policyVersionId: row.policy_version_id,
          scalarReward: row.evaluation_reward,
          guardrailViolation: row.lifecycle_status === "guardrail_violation",
        }))
      ),
      eventChain: await this.verifyEventChain(),
    };
  }
}

export {
  REFERENCE_LIFECYCLE_SCHEMA_SQL,
  REFERENCE_LIFECYCLE_SCHEMA_VERSION,
};
