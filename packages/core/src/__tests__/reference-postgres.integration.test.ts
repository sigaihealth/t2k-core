import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  computeReferenceReconciliationExecutionReceiptDigest,
  computeReferenceReconciliationProposalHash,
  PostgresReferenceLifecycle,
  ReferenceLifecycleConflictError,
  ReferenceLifecycleValidationError,
  type ReferenceLifecycleActor,
  type ReferencePolicyVersionRecord,
} from "../reference-postgres.js";
import type { DecisionLearningContract, RewardDimensionSpec } from "../types.js";

const databaseUrl = process.env.T2K_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;

const proposer: ReferenceLifecycleActor = {
  actorType: "agent",
  actorId: "agent:policy-builder",
};
const reviewer: ReferenceLifecycleActor = {
  actorType: "human",
  actorId: "human:reviewer",
};
const evaluator: ReferenceLifecycleActor = {
  actorType: "human",
  actorId: "human:evaluator",
};
const promoter: ReferenceLifecycleActor = {
  actorType: "human",
  actorId: "human:promoter",
};
const rollbackReviewer: ReferenceLifecycleActor = {
  actorType: "human",
  actorId: "human:rollback-reviewer",
};
const reactivationReviewer: ReferenceLifecycleActor = {
  actorType: "human",
  actorId: "human:reactivation-reviewer",
};
const rewardEngine: ReferenceLifecycleActor = {
  actorType: "system",
  actorId: "system:reward-engine",
};

const rewardSpec: RewardDimensionSpec[] = [
  {
    measureRef: "harborlight.on_time_completion_rate",
    label: "On-time completion rate",
    direction: "maximize",
    weight: 1,
    required: true,
    guardrail: false,
    unit: "ratio",
    observationWindow: "7d",
    aggregation: "latest",
    baselineMethod: "explicit",
    attributionMethod: "human_review",
  },
  {
    measureRef: "harborlight.crew_load_ratio",
    label: "Crew load ratio",
    direction: "range",
    weight: 1,
    required: false,
    guardrail: true,
    unit: "ratio",
    minimum: 0,
    maximum: 0.8,
    observationWindow: "7d",
    aggregation: "latest",
    baselineMethod: "none",
    attributionMethod: "direct",
  },
];

const learningContract: DecisionLearningContract = {
  mode: "supervised_feedback",
  stateSchema: { type: "object", required: ["facts.0.objectValue"] },
  actionSchema: {
    type: "string",
    enum: ["hold", "authorize_overtime", "rebalance_route"],
  },
  rewardSpec,
  observationSchedule: ["7d"],
  terminalConditions: ["observation_complete"],
  explorationPolicy: { enabled: false },
  safetyConstraints: ["reversible_external_effect"],
  promotionCriteria: {
    minimumEpisodes: 20,
    minimumImprovement: 0.05,
    minimumCoverage: 0.2,
  },
};

const evaluation = {
  minimumEpisodes: 20,
  minimumImprovement: 0.05,
  confidenceZ: 1.96,
  minimumCoverage: 0.2,
};

const behaviorSpecification = {
  referencePolicy: {
    rules: [
      {
        all: [{ path: "facts.0.objectValue", operator: "gte", value: 0.6 }],
        action: "rebalance_route",
      },
    ],
    defaultAction: "hold",
    evaluation,
  },
};

const baselineSpecification = {
  referencePolicy: {
    rules: [
      {
        all: [{ path: "facts.0.objectValue", operator: "gte", value: 0.6 }],
        action: "authorize_overtime",
      },
    ],
    defaultAction: "hold",
    evaluation,
  },
};

const candidateSpecification = behaviorSpecification;

interface EpisodeFixture {
  cohort: "training" | "holdout";
  queuePressure: number;
  expectedAction: "hold" | "authorize_overtime" | "rebalance_route";
  observedRate: number;
  baselineRate: number;
}

const behaviorFixtures: EpisodeFixture[] = [
  { cohort: "training", queuePressure: 0.82, expectedAction: "rebalance_route", observedRate: 0.72, baselineRate: 0.4 },
  { cohort: "training", queuePressure: 0.74, expectedAction: "rebalance_route", observedRate: 0.68, baselineRate: 0.4 },
  ...Array.from({ length: 6 }, (_, index) => ({
    cohort: "holdout" as const,
    queuePressure: 0.72 + index * 0.01,
    expectedAction: "rebalance_route" as const,
    observedRate: 0.8,
    baselineRate: 0.4,
  })),
];

const baselineFixtures: EpisodeFixture[] = [
  { cohort: "training", queuePressure: 0.31, expectedAction: "hold", observedRate: 0.4, baselineRate: 0.4 },
  { cohort: "training", queuePressure: 0.22, expectedAction: "hold", observedRate: 0.42, baselineRate: 0.4 },
  ...Array.from({ length: 10 }, (_, index) => ({
    cohort: "holdout" as const,
    queuePressure: 0.61 + index * 0.01,
    expectedAction: "authorize_overtime" as const,
    observedRate: 0.2,
    baselineRate: 0.4,
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    cohort: "holdout" as const,
    queuePressure: 0.21 + index * 0.03,
    expectedAction: "hold" as const,
    observedRate: 0.4,
    baselineRate: 0.4,
  })),
];

describePostgres("Postgres reference lifecycle", () => {
  let pool: Pool;
  let lifecycle: PostgresReferenceLifecycle;
  let baselineVersion: ReferencePolicyVersionRecord;
  const trainingEpisodeIds: string[] = [];
  const holdoutEpisodeIds: string[] = [];

  async function expectAcceptanceActivationIndexes() {
    const result = await pool.query<{
      index_name: string;
      is_unique: boolean;
      predicate: string | null;
    }>(
      `SELECT index_relations.relname AS index_name,
              indexes.indisunique AS is_unique,
              pg_get_expr(indexes.indpred, indexes.indrelid) AS predicate
       FROM pg_index AS indexes
       INNER JOIN pg_class AS index_relations
         ON index_relations.oid = indexes.indexrelid
       INNER JOIN pg_class AS table_relations
         ON table_relations.oid = indexes.indrelid
       INNER JOIN pg_namespace AS namespaces
         ON namespaces.oid = table_relations.relnamespace
       WHERE namespaces.nspname = 't2k_reference'
         AND table_relations.relname = 'reconciliation_activations'
         AND index_relations.relname = ANY($1::text[])
       ORDER BY index_relations.relname`,
      [[
        "t2k_reference_reconciliation_acceptance_proposal_uq",
        "t2k_reference_reconciliation_acceptance_revision_uq",
      ]]
    );
    expect(result.rows).toEqual([
      {
        index_name: "t2k_reference_reconciliation_acceptance_proposal_uq",
        is_unique: true,
        predicate: "(activation_type = 'acceptance'::text)",
      },
      {
        index_name: "t2k_reference_reconciliation_acceptance_revision_uq",
        is_unique: true,
        predicate: "(activation_type = 'acceptance'::text)",
      },
    ]);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
    await pool.query("DROP SCHEMA IF EXISTS t2k_reference CASCADE");
    await pool.query("CREATE SCHEMA t2k_reference");
    await pool.query(
      `CREATE TABLE t2k_reference.schema_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    await pool.query(
      "INSERT INTO t2k_reference.schema_migrations(version) VALUES (1)"
    );
    lifecycle = new PostgresReferenceLifecycle({ pool });
    expect(await Promise.all([lifecycle.migrate(), lifecycle.migrate()])).toEqual([
      2, 2,
    ]);
    expect(
      (
        await pool.query<{ version: number }>(
          "SELECT version FROM t2k_reference.schema_migrations ORDER BY version"
        )
      ).rows.map(({ version }) => version)
    ).toEqual([1, 2]);
    await expectAcceptanceActivationIndexes();
    expect(await lifecycle.migrate()).toBe(2);
    await expectAcceptanceActivationIndexes();
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createVersion(
    version: string,
    specification: typeof behaviorSpecification,
    parentVersionId?: string
  ) {
    const proposed = await lifecycle.createPolicyVersion(
      "harborlight-dispatch",
      {
        policyVersion: version,
        learningMode: "supervised_feedback",
        specification,
        rewardSpec,
        parentVersionId,
        rationale: `Synthetic reference policy ${version}.`,
      },
      proposer
    );
    await expect(
      lifecycle.acceptPolicyVersion(
        "harborlight-dispatch",
        version,
        "Self-review must fail.",
        { actorType: "human", actorId: proposer.actorId }
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    return lifecycle.acceptPolicyVersion(
      "harborlight-dispatch",
      version,
      "An independent human accepted the deterministic rule set.",
      reviewer
    );
  }

  async function persistEpisode(fixture: EpisodeFixture, index: number) {
    const key = `${fixture.cohort}-${String(index + 1).padStart(2, "0")}`;
    const context = await lifecycle.createDecisionContext(
      {
        contextKey: `context:${key}`,
        question: "How should Harborlight respond to dispatch pressure?",
        decisionType: "operations.dispatch_overflow",
        stateSnapshot: { facts: [{ objectValue: fixture.queuePressure }] },
        objective: { maximize: "harborlight.on_time_completion_rate" },
        constraints: ["Actions must be reversible."],
        requiredAuthority: { role: "dispatch_owner" },
        learningContract,
      },
      proposer
    );
    const recommendation = await lifecycle.recommend(
      context.contextKey,
      {
        recommendationKey: `recommendation:${key}`,
        rationale: "Execute the frozen behavior policy over the accepted state.",
      },
      proposer
    );
    expect(recommendation.proposedAction).toBe(fixture.expectedAction);
    if (index === 0) {
      await expect(
        lifecycle.authorizeRecommendation(
          recommendation.id,
          { rationale: "Self-authorization must fail." },
          { actorType: "human", actorId: proposer.actorId }
        )
      ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    }
    const authorization = await lifecycle.authorizeRecommendation(
      recommendation.id,
      { rationale: "The dispatch owner authorizes this reversible synthetic action." },
      reviewer
    );
    const episode = await lifecycle.openEpisode(
      {
        episodeKey: `episode:${key}`,
        contextKey: context.contextKey,
        authorizedDecisionId: authorization.id,
        externalEffect: true,
      },
      proposer
    );
    expect(episode.policyVersionId).toBe(context.policyVersionId);
    if (index === 0) {
      await expect(
        lifecycle.recordExecutionReceipt(
          episode.id,
          {
            receiptKey: `receipt:invalid:${key}`,
            idempotencyKey: `idempotency:invalid:${key}`,
            connectorRef: "synthetic.harborlight.dispatch",
            outcome: "succeeded",
            requestHash: `request:invalid:${key}`,
            responseHash: `response:invalid:${key}`,
            reconciliationStatus: "reconciled",
          },
          proposer
        )
      ).rejects.toBeInstanceOf(ReferenceLifecycleValidationError);
    }
    await lifecycle.recordExecutionReceipt(
      episode.id,
      {
        receiptKey: `receipt:${key}`,
        idempotencyKey: `idempotency:${key}`,
        connectorRef: "synthetic.harborlight.dispatch",
        externalTransactionId: `dispatch-${key}`,
        outcome: "succeeded",
        requestHash: `request:${key}`,
        responseHash: `response:${key}`,
        response: { applied: true },
        rollbackContract: { operation: "restore_prior_dispatch_plan" },
        reconciliationStatus: "reconciled",
      },
      proposer
    );
    await lifecycle.recordObservation(
      episode.id,
      {
        measureRef: rewardSpec[0]!.measureRef,
        observedValue: fixture.observedRate,
        baselineValue: fixture.baselineRate,
        unit: "ratio",
        observationWindow: "7d",
        sourceRefs: [`fixture://harborlight/${key}`],
        provenance: { cohort: fixture.cohort, synthetic: true },
        attributionConfidence: 1,
        observedAt: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
      },
      proposer
    );
    const assessment = await lifecycle.assessReward(
      episode.id,
      {
        assessmentKey: `assessment:${key}`,
        attribution: { method: "deterministic_synthetic_fixture" },
      },
      rewardEngine
    );
    expect(assessment.lifecycleStatus).toBe("complete");
    await lifecycle.closeEpisode(
      episode.id,
      "Receipt reconciliation and the seven-day observation are complete.",
      reviewer
    );
    (fixture.cohort === "training" ? trainingEpisodeIds : holdoutEpisodeIds).push(
      episode.id
    );
  }

  it("serializes migration and refuses a future schema version", async () => {
    await pool.query(
      "INSERT INTO t2k_reference.schema_migrations(version) VALUES (3)"
    );
    try {
      await expect(lifecycle.migrate()).rejects.toBeInstanceOf(
        ReferenceLifecycleConflictError
      );
    } finally {
      await pool.query(
        "DELETE FROM t2k_reference.schema_migrations WHERE version = 3"
      );
    }
    expect(await lifecycle.migrate()).toBe(2);

    await pool.query(
      "DROP INDEX t2k_reference.t2k_reference_reconciliation_acceptance_proposal_uq"
    );
    await pool.query(
      `CREATE INDEX t2k_reference_reconciliation_acceptance_proposal_uq
       ON t2k_reference.reconciliation_activations(source_proposal_id)`
    );
    await pool.query(
      "DELETE FROM t2k_reference.schema_migrations WHERE version = 2"
    );
    await expect(lifecycle.migrate()).rejects.toThrow(
      "missing required indexes"
    );
    expect(
      (
        await pool.query(
          "SELECT 1 FROM t2k_reference.schema_migrations WHERE version = 2"
        )
      ).rowCount
    ).toBe(0);
    await pool.query(
      "DROP INDEX t2k_reference.t2k_reference_reconciliation_acceptance_proposal_uq"
    );
    expect(await lifecycle.migrate()).toBe(2);
    await expectAcceptanceActivationIndexes();

    await pool.query(
      "DROP INDEX t2k_reference.t2k_reference_reconciliation_acceptance_revision_uq"
    );
    expect(await lifecycle.migrate()).toBe(2);
    await expectAcceptanceActivationIndexes();
  });

  it("persists the complete governed loop through promotion and rollback", async () => {
    await lifecycle.createPolicy(
      {
        policyKey: "harborlight-dispatch",
        label: "Harborlight dispatch policy",
        decisionType: "operations.dispatch_overflow",
      },
      proposer
    );

    const behaviorVersion = await createVersion("0.9.0", behaviorSpecification);
    await lifecycle.deployPolicyVersion(
      "harborlight-dispatch",
      behaviorVersion.policyVersion,
      reviewer
    );
    await expect(
      lifecycle.createDecisionContext(
        {
          contextKey: "context:invalid-state-contract",
          question: "Invalid state contract",
          decisionType: "operations.dispatch_overflow",
          stateSnapshot: { facts: [] },
          objective: { maximize: "harborlight.on_time_completion_rate" },
          learningContract,
        },
        proposer
      )
    ).rejects.toThrow("missing required path");
    await expect(
      lifecycle.createDecisionContext(
        {
          contextKey: "context:invalid-reward-contract",
          question: "Invalid reward contract",
          decisionType: "operations.dispatch_overflow",
          stateSnapshot: { facts: [{ objectValue: 0.8 }] },
          objective: { maximize: "harborlight.on_time_completion_rate" },
          learningContract: {
            ...learningContract,
            rewardSpec: [{ ...rewardSpec[0]!, weight: 2 }, rewardSpec[1]!],
          },
        },
        proposer
      )
    ).rejects.toThrow("rewardSpec must match");
    await expect(
      lifecycle.createDecisionContext(
        {
          contextKey: "context:invalid-action-contract",
          question: "Invalid action contract",
          decisionType: "operations.dispatch_overflow",
          stateSnapshot: { facts: [{ objectValue: 0.8 }] },
          objective: { maximize: "harborlight.on_time_completion_rate" },
          learningContract: {
            ...learningContract,
            actionSchema: { type: "string", enum: ["hold"] },
          },
        },
        proposer
      )
    ).rejects.toThrow("outside the learning contract");
    for (const [index, fixture] of behaviorFixtures.entries()) {
      await persistEpisode(fixture, index);
    }

    baselineVersion = await createVersion(
      "1.0.0",
      baselineSpecification,
      behaviorVersion.id
    );
    await lifecycle.deployPolicyVersion(
      "harborlight-dispatch",
      baselineVersion.policyVersion,
      reviewer
    );
    for (const [index, fixture] of baselineFixtures.entries()) {
      await persistEpisode(fixture, behaviorFixtures.length + index);
    }

    expect(trainingEpisodeIds).toHaveLength(4);
    expect(holdoutEpisodeIds).toHaveLength(20);
    expect(trainingEpisodeIds.some((id) => holdoutEpisodeIds.includes(id))).toBe(
      false
    );

    await expect(
      lifecycle.createCandidate(
        {
          candidateKey: "candidate:weakened-evaluation",
          policyKey: "harborlight-dispatch",
          sourcePolicyVersionId: baselineVersion.id,
          proposedPolicyVersion: "1.0.1",
          proposedSpecification: {
            referencePolicy: {
              ...candidateSpecification.referencePolicy,
              evaluation: { ...evaluation, minimumEpisodes: 1 },
            },
          },
          trainingEpisodeIds,
          rationale: "A proposer must not lower its own evidence threshold.",
        },
        proposer
      )
    ).rejects.toThrow("cannot weaken source gates");
    await expect(
      lifecycle.createCandidate(
        {
          candidateKey: "candidate:non-increasing-version",
          policyKey: "harborlight-dispatch",
          sourcePolicyVersionId: baselineVersion.id,
          proposedPolicyVersion: "0.9.9",
          proposedSpecification: candidateSpecification,
          trainingEpisodeIds,
          rationale: "A candidate must advance its source version.",
        },
        proposer
      )
    ).rejects.toThrow("greater than its source version");
    await expect(
      lifecycle.createCandidate(
        {
          candidateKey: "candidate:changed-reward",
          policyKey: "harborlight-dispatch",
          sourcePolicyVersionId: baselineVersion.id,
          proposedPolicyVersion: "1.0.2",
          proposedSpecification: candidateSpecification,
          proposedRewardSpec: [
            { ...rewardSpec[0]!, weight: 2 },
            rewardSpec[1]!,
          ],
          trainingEpisodeIds,
          rationale: "Historical rewards cannot validate a new reward contract.",
        },
        proposer
      )
    ).rejects.toThrow("changed rewardSpec");

    const candidate = await lifecycle.createCandidate(
      {
        candidateKey: "candidate:harborlight-dispatch:1.1.0",
        policyKey: "harborlight-dispatch",
        sourcePolicyVersionId: baselineVersion.id,
        proposedPolicyVersion: "1.1.0",
        proposedSpecification: candidateSpecification,
        trainingEpisodeIds,
        rationale: "Training evidence supports route rebalancing under pressure.",
      },
      proposer
    );

    await expect(
      lifecycle.evaluateCandidate(
        candidate.id,
        {
          evaluationKey: "replay:self-review",
          holdoutEpisodeIds,
        },
        { actorType: "human", actorId: proposer.actorId }
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    await expect(
      lifecycle.evaluateCandidate(
        candidate.id,
        {
          evaluationKey: "replay:overlap",
          holdoutEpisodeIds: [trainingEpisodeIds[0]!, ...holdoutEpisodeIds],
        },
        evaluator
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleValidationError);

    const replay = await lifecycle.evaluateCandidate(
      candidate.id,
      {
        evaluationKey: "replay:harborlight-dispatch:1.1.0",
        holdoutEpisodeIds,
        evidenceRefs: ["fixture://harborlight/holdout-v1"],
      },
      evaluator
    );
    expect(replay.lifecycleStatus).toBe("passed");
    expect(replay.metrics).toMatchObject({
      method: "inverse_propensity_score",
      sampleSize: 20,
      statisticallyWeak: false,
      actionChanges: 16,
      candidate: { matchingEpisodes: 10, coverage: 0.5, guardrailViolations: 0 },
      baseline: { matchingEpisodes: 14, coverage: 0.7, guardrailViolations: 0 },
    });
    expect(replay.metrics.estimatedImprovement).toBeCloseTo(0.55, 8);
    expect(replay.metrics.improvementConfidenceLower).toBeGreaterThan(0.05);

    await expect(
      lifecycle.promoteCandidate(
        candidate.id,
        { reviewRationale: "Evaluator cannot promote." },
        evaluator
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    const promoted = await lifecycle.promoteCandidate(
      candidate.id,
      {
        reviewRationale:
          "Independent replay passed with support and a positive confidence bound.",
        deploy: true,
      },
      promoter
    );
    expect(promoted.policyVersion.policyVersion).toBe("1.1.0");
    expect(
      (await lifecycle.getActivePolicy("operations.dispatch_overflow"))?.version.id
    ).toBe(promoted.policyVersion.id);

    await expect(
      lifecycle.rollbackPromotion(
        promoted.promotion.id,
        "The promoter cannot review their own rollback.",
        promoter
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    const rollback = await lifecycle.rollbackPromotion(
      promoted.promotion.id,
      "Restore the exact parent after the synthetic rollback exercise.",
      rollbackReviewer
    );
    expect(rollback.lifecycleStatus).toBe("rolled_back");
    expect(
      (await lifecycle.getActivePolicy("operations.dispatch_overflow"))?.version.id
    ).toBe(baselineVersion.id);

    const snapshot = await lifecycle.snapshot();
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.episodes).toHaveLength(24);
    expect(snapshot.eventChain).toMatchObject({ valid: true, invalidSequence: null });
    expect(snapshot.rewardAggregates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ episodeCount: 8, guardrailViolations: 0 }),
        expect.objectContaining({ episodeCount: 16, guardrailViolations: 0 }),
      ])
    );

    await expect(
      pool.query(
        "UPDATE t2k_reference.lifecycle_events SET payload = '{}'::jsonb WHERE sequence = 1"
      )
    ).rejects.toThrow("append-only");
  }, 120_000);

  it("persists governed reconciliation lineage and exact rollback", async () => {
    const receiptResult = await pool.query<{ id: string }>(
      `SELECT id
       FROM t2k_reference.execution_receipts
       ORDER BY received_at, id
       LIMIT 1`
    );
    const receiptId = receiptResult.rows[0]?.id;
    expect(receiptId).toBeDefined();
    const alternateReceiptId = receiptId!.replaceAll("-", "").toUpperCase();

    const objectType = "operational_entity";
    const objectKey = "harborlight:dispatch-load";
    const requiredReviewerRole = "canonical_data_steward";
    const mutationRaceContent = {
      entityId: "harborlight:mutation-race",
      classification: "original",
    };
    const mutationRaceEvidence = {
      summary: "Original evidence snapshot.",
      source: { state: "original" },
    };
    const mutationRaceBody = {
      proposalKey: "reconciliation:harborlight:mutation-race:v1",
      objectType,
      objectKey: "harborlight:mutation-race",
      baseRevisionId: null,
      proposedContent: mutationRaceContent,
      evidence: mutationRaceEvidence,
      executionReceiptIds: [] as string[],
      requiredReviewerRole,
      rationale: "Prove immutable capture before the first asynchronous wait.",
    };
    const mutationRaceHash =
      computeReferenceReconciliationProposalHash(mutationRaceBody);
    const heldClients = await Promise.all(
      Array.from({ length: 5 }, () => pool.connect())
    );
    const mutationRacePromise = lifecycle.createReconciliationProposal(
      {
        ...mutationRaceBody,
        idempotencyKey: "reconciliation-proposal:mutation-race:v1",
        proposalHash: mutationRaceHash,
      },
      proposer
    );
    mutationRaceContent.classification = "mutated-after-call";
    mutationRaceEvidence.summary = "Mutated after call.";
    mutationRaceEvidence.source.state = "mutated-after-call";
    for (const client of heldClients) client.release();
    const mutationRaceProposal = await mutationRacePromise;
    expect(mutationRaceProposal.proposedContent).toMatchObject({
      classification: "original",
    });
    expect(mutationRaceProposal.evidence).toEqual({
      summary: "Original evidence snapshot.",
      source: { state: "original" },
    });

    const changedConcurrentBodies = [
      {
        ...mutationRaceBody,
        proposalKey: "reconciliation:harborlight:concurrent:a",
        objectKey: "harborlight:concurrent:a",
        rationale: "Concurrent body A.",
      },
      {
        ...mutationRaceBody,
        proposalKey: "reconciliation:harborlight:concurrent:b",
        objectKey: "harborlight:concurrent:b",
        rationale: "Concurrent body B.",
      },
    ];
    const changedConcurrentResults = await Promise.allSettled(
      changedConcurrentBodies.map((body) =>
        lifecycle.createReconciliationProposal(
          {
            ...body,
            idempotencyKey: "reconciliation-proposal:changed-concurrent",
            proposalHash: computeReferenceReconciliationProposalHash(body),
          },
          proposer
        )
      )
    );
    expect(
      changedConcurrentResults.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1);
    const changedConcurrentRejection = changedConcurrentResults.find(
      ({ status }) => status === "rejected"
    );
    expect(changedConcurrentRejection?.status).toBe("rejected");
    if (changedConcurrentRejection?.status === "rejected") {
      expect(changedConcurrentRejection.reason).toBeInstanceOf(
        ReferenceLifecycleConflictError
      );
    }

    const firstContent = {
      entityId: "harborlight:dispatch-load",
      classification: "constrained",
      crewLoadRatio: 0.74,
    };
    const firstProposalBody = {
      proposalKey: "reconciliation:harborlight:dispatch-load:v1",
      objectType,
      objectKey,
      baseRevisionId: null,
      proposedContent: firstContent,
      evidence: {
        summary: "Normalize the observed dispatch-load entity.",
        sourceKind: "execution_receipt",
      },
      executionReceiptIds: [alternateReceiptId],
      requiredReviewerRole,
      rationale: "Create a canonical entity from persisted execution evidence.",
    };
    const firstProposalHash =
      computeReferenceReconciliationProposalHash(firstProposalBody);

    await expect(
      lifecycle.createReconciliationProposal(
        {
          ...firstProposalBody,
          idempotencyKey: "reconciliation-proposal:harborlight:v1:bad-hash",
          proposalHash: "0".repeat(64),
        },
        proposer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleValidationError);

    const [firstProposal, firstProposalRetry] = await Promise.all([
      lifecycle.createReconciliationProposal(
        {
          ...firstProposalBody,
          idempotencyKey: "reconciliation-proposal:harborlight:v1",
          proposalHash: firstProposalHash,
        },
        proposer
      ),
      lifecycle.createReconciliationProposal(
        {
          ...firstProposalBody,
          idempotencyKey: "reconciliation-proposal:harborlight:v1",
          proposalHash: firstProposalHash,
        },
        proposer
      ),
    ]);
    expect(firstProposalRetry.id).toBe(firstProposal.id);
    expect(firstProposal.executionReceiptIds).toEqual([receiptId]);
    expect(firstProposal.executionReceipts).toHaveLength(1);
    expect(firstProposal.executionReceipts[0]?.receiptId).toBe(receiptId);
    expect(firstProposal.executionReceipts[0]?.receiptSnapshot).toMatchObject({
      id: receiptId,
      receipt_key: expect.any(String),
      decision_episode_id: expect.any(String),
      received_at: expect.any(String),
    });
    expect(firstProposal.executionReceipts[0]?.receiptDigest).toBe(
      computeReferenceReconciliationExecutionReceiptDigest(
        firstProposal.executionReceipts[0]!.receiptSnapshot
      )
    );
    await expect(
      lifecycle.createReconciliationProposal(
        {
          ...firstProposalBody,
          idempotencyKey: "reconciliation-proposal:harborlight:v1",
          proposalHash: firstProposalHash,
        },
        evaluator
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.acceptReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: firstProposalHash,
          dispositionId: "00000000-0000-4000-8000-000000000001",
          expectedActiveRevisionId: null,
          acceptedByRole: "canonical_operator",
          rationale: "Acceptance must not bypass review.",
          idempotencyKey: "reconciliation-accept:harborlight:v1:unreviewed",
        },
        promoter
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: firstProposalHash,
          expectedDispositionVersion: 0,
          decision: "approved",
          reviewerRole: requiredReviewerRole,
          rationale: "The proposer cannot approve their own proposal.",
          idempotencyKey: "reconciliation-review:harborlight:v1:self",
        },
        { actorType: "human", actorId: proposer.actorId }
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey: "harborlight:different-object",
          expectedProposalHash: firstProposalHash,
          expectedDispositionVersion: 0,
          decision: "approved",
          reviewerRole: requiredReviewerRole,
          rationale: "The object identity must match.",
          idempotencyKey: "reconciliation-review:harborlight:v1:mismatch",
        },
        reviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: firstProposalHash,
          expectedDispositionVersion: 0,
          decision: "approved",
          reviewerRole: "unqualified_reviewer",
          rationale: "The required reviewer role must match exactly.",
          idempotencyKey: "reconciliation-review:harborlight:v1:wrong-role",
        },
        reviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleValidationError);

    const firstReviewInput = {
      objectType,
      objectKey,
      expectedProposalHash: firstProposalHash,
      expectedDispositionVersion: 0,
      decision: "approved" as const,
      reviewerRole: requiredReviewerRole,
      rationale: "The receipt supports the proposed normalized entity.",
      idempotencyKey: "reconciliation-review:harborlight:v1",
    };
    const [firstDisposition, firstDispositionRetry] = await Promise.all([
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        firstReviewInput,
        reviewer
      ),
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        firstReviewInput,
        reviewer
      ),
    ]);
    expect(firstDispositionRetry.id).toBe(firstDisposition.id);
    await expect(
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        { ...firstReviewInput, expectedDispositionVersion: 1 },
        reviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.reviewReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: firstProposalHash,
          expectedDispositionVersion: 0,
          decision: "rejected",
          reviewerRole: requiredReviewerRole,
          rationale: "A concurrent second disposition must fail.",
          idempotencyKey: "reconciliation-review:harborlight:v1:stale",
        },
        evaluator
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.acceptReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey: "harborlight:different-object",
          expectedProposalHash: firstProposalHash,
          dispositionId: firstDisposition.id,
          expectedActiveRevisionId: null,
          acceptedByRole: "canonical_operator",
          rationale: "The object identity must match.",
          idempotencyKey: "reconciliation-accept:harborlight:v1:mismatch",
        },
        promoter
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.acceptReconciliationProposal(
        firstProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: firstProposalHash,
          dispositionId: firstDisposition.id,
          expectedActiveRevisionId: null,
          acceptedByRole: "canonical_operator",
          rationale: "Review and activation require distinct human actors.",
          idempotencyKey: "reconciliation-accept:harborlight:v1:reviewer",
        },
        reviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    const firstAcceptanceInput = {
      objectType,
      objectKey,
      expectedProposalHash: firstProposalHash,
      dispositionId: firstDisposition.id,
      expectedActiveRevisionId: null,
      acceptedByRole: "canonical_operator",
      rationale: "Activate the independently approved first revision.",
      idempotencyKey: "reconciliation-accept:harborlight:v1",
    };
    const [firstAcceptance, firstAcceptanceRetry] = await Promise.all([
      lifecycle.acceptReconciliationProposal(
        firstProposal.id,
        firstAcceptanceInput,
        promoter
      ),
      lifecycle.acceptReconciliationProposal(
        firstProposal.id,
        firstAcceptanceInput,
        promoter
      ),
    ]);
    expect(firstAcceptanceRetry.revision.id).toBe(firstAcceptance.revision.id);
    for (const changedRequest of [
      {
        expectedProposalHash: "f".repeat(64),
        dispositionId: firstDisposition.id,
        expectedActiveRevisionId: null,
        rationale: "Activate the independently approved first revision.",
      },
      {
        expectedProposalHash: firstProposalHash,
        dispositionId: "00000000-0000-4000-8000-000000000002",
        expectedActiveRevisionId: null,
        rationale: "Activate the independently approved first revision.",
      },
      {
        expectedProposalHash: firstProposalHash,
        dispositionId: firstDisposition.id,
        expectedActiveRevisionId: firstAcceptance.revision.id,
        rationale: "Activate the independently approved first revision.",
      },
      {
        expectedProposalHash: firstProposalHash,
        dispositionId: firstDisposition.id,
        expectedActiveRevisionId: null,
        rationale: "Changed rationale must not replay as success.",
      },
    ]) {
      await expect(
        lifecycle.acceptReconciliationProposal(
          firstProposal.id,
          {
            objectType,
            objectKey,
            ...changedRequest,
            acceptedByRole: "canonical_operator",
            idempotencyKey: "reconciliation-accept:harborlight:v1",
          },
          promoter
        )
      ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    }
    expect(firstAcceptance.revision).toMatchObject({
      revisionNumber: 1,
      parentRevisionId: null,
      proposalId: firstProposal.id,
      approvalDispositionId: firstDisposition.id,
      content: firstContent,
    });

    const duplicateContentBody = {
      ...firstProposalBody,
      proposalKey: "reconciliation:harborlight:dispatch-load:duplicate",
      baseRevisionId: `{${firstAcceptance.revision.id.toUpperCase()}}`,
    };
    await expect(
      lifecycle.createReconciliationProposal(
        {
          ...duplicateContentBody,
          idempotencyKey: "reconciliation-proposal:harborlight:duplicate",
          proposalHash:
            computeReferenceReconciliationProposalHash(duplicateContentBody),
        },
        proposer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    const secondContent = {
      ...firstContent,
      classification: "balanced",
      crewLoadRatio: 0.62,
    };
    const secondProposalBody = {
      proposalKey: "reconciliation:harborlight:dispatch-load:v2",
      objectType,
      objectKey,
      baseRevisionId: firstAcceptance.revision.id.replaceAll("-", ""),
      proposedContent: secondContent,
      evidence: {
        summary: "A later receipt-backed observation changes the classification.",
        sourceKind: "execution_receipt",
      },
      executionReceiptIds: [receiptId!],
      requiredReviewerRole,
      rationale: "Record a new canonical revision without merging history.",
    };
    const secondProposalHash =
      computeReferenceReconciliationProposalHash(secondProposalBody);
    const secondProposal = await lifecycle.createReconciliationProposal(
      {
        ...secondProposalBody,
        idempotencyKey: "reconciliation-proposal:harborlight:v2",
        proposalHash: secondProposalHash,
      },
      proposer
    );
    expect(secondProposal.baseRevisionId).toBe(firstAcceptance.revision.id);
    const secondDisposition = await lifecycle.reviewReconciliationProposal(
      secondProposal.id,
      {
        objectType,
        objectKey,
        expectedProposalHash: secondProposalHash,
        expectedDispositionVersion: 0,
        decision: "approved",
        reviewerRole: requiredReviewerRole,
        rationale: "The changed canonical content is supported and explicit.",
        idempotencyKey: "reconciliation-review:harborlight:v2",
      },
      evaluator
    );

    await expect(
      lifecycle.acceptReconciliationProposal(
        secondProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: secondProposalHash,
          dispositionId: firstDisposition.id,
          expectedActiveRevisionId: firstAcceptance.revision.id,
          acceptedByRole: "canonical_operator",
          rationale: "A disposition from another proposal must fail.",
          idempotencyKey: "reconciliation-accept:harborlight:v2:wrong-disposition",
        },
        promoter
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.acceptReconciliationProposal(
        secondProposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: secondProposalHash,
          dispositionId: secondDisposition.id,
          expectedActiveRevisionId: null,
          acceptedByRole: "canonical_operator",
          rationale: "A stale active-revision expectation must fail.",
          idempotencyKey: "reconciliation-accept:harborlight:v2:stale",
        },
        promoter
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    const secondAcceptance = await lifecycle.acceptReconciliationProposal(
      secondProposal.id,
      {
        objectType,
        objectKey,
        expectedProposalHash: secondProposalHash,
        dispositionId: secondDisposition.id,
        expectedActiveRevisionId: firstAcceptance.revision.id,
        acceptedByRole: "canonical_operator",
        rationale: "Activate the independently approved second revision.",
        idempotencyKey: "reconciliation-accept:harborlight:v2",
      },
      promoter
    );
    expect(secondAcceptance.revision).toMatchObject({
      revisionNumber: 2,
      parentRevisionId: firstAcceptance.revision.id,
      proposalId: secondProposal.id,
      approvalDispositionId: secondDisposition.id,
      content: secondContent,
    });

    await expect(
      lifecycle.rollbackReconciliationRevision(
        {
          objectType,
          objectKey,
          targetRevisionId: firstAcceptance.revision.id,
          expectedActiveRevisionId: secondAcceptance.revision.id,
          activatedByRole: "canonical_rollback_reviewer",
          rationale: "The accepting actor cannot approve the rollback.",
          idempotencyKey: "reconciliation-rollback:harborlight:self",
        },
        promoter
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    for (const separatedActor of [
      { actorType: "human", actorId: proposer.actorId } as const,
      evaluator,
    ]) {
      await expect(
        lifecycle.rollbackReconciliationRevision(
          {
            objectType,
            objectKey,
            targetRevisionId: firstAcceptance.revision.id,
            expectedActiveRevisionId: secondAcceptance.revision.id,
            activatedByRole: "canonical_rollback_reviewer",
            rationale: "Proposal and review actors cannot perform rollback.",
            idempotencyKey: `reconciliation-rollback:separation:${separatedActor.actorId}`,
          },
          separatedActor
        )
      ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    }

    const rollbackInput = {
      objectType,
      objectKey,
      targetRevisionId: firstAcceptance.revision.id,
      expectedActiveRevisionId: secondAcceptance.revision.id,
      activatedByRole: "canonical_rollback_reviewer",
      rationale: "Restore the exact prior revision and retain both revisions.",
      idempotencyKey: "reconciliation-rollback:harborlight:v2-to-v1",
    };
    const [rollback, rollbackRetry] = await Promise.all([
      lifecycle.rollbackReconciliationRevision(rollbackInput, rollbackReviewer),
      lifecycle.rollbackReconciliationRevision(rollbackInput, rollbackReviewer),
    ]);
    expect(rollbackRetry.activation.id).toBe(rollback.activation.id);
    await expect(
      lifecycle.rollbackReconciliationRevision(
        {
          objectType,
          objectKey,
          targetRevisionId: firstAcceptance.revision.id,
          expectedActiveRevisionId: firstAcceptance.revision.id,
          activatedByRole: "canonical_rollback_reviewer",
          rationale: "Restore the exact prior revision and retain both revisions.",
          idempotencyKey: "reconciliation-rollback:harborlight:v2-to-v1",
        },
        rollbackReviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    await expect(
      lifecycle.rollbackReconciliationRevision(
        {
          objectType,
          objectKey,
          targetRevisionId: firstAcceptance.revision.id,
          expectedActiveRevisionId: secondAcceptance.revision.id,
          activatedByRole: "canonical_rollback_reviewer",
          rationale: "Changed rationale must not replay as success.",
          idempotencyKey: "reconciliation-rollback:harborlight:v2-to-v1",
        },
        rollbackReviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    expect(rollback.revision).toMatchObject({
      id: firstAcceptance.revision.id,
      content: firstContent,
    });

    await expect(
      lifecycle.rollbackReconciliationRevision(
        {
          objectType,
          objectKey,
          targetRevisionId: firstAcceptance.revision.id,
          expectedActiveRevisionId: secondAcceptance.revision.id,
          activatedByRole: "canonical_rollback_reviewer",
          rationale: "The active revision has already changed.",
          idempotencyKey: "reconciliation-rollback:harborlight:stale",
        },
        evaluator
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      lifecycle.reactivateReconciliationRevision(
        {
          objectType,
          objectKey,
          targetRevisionId: secondAcceptance.revision.id,
          expectedActiveRevisionId: firstAcceptance.revision.id,
          activatedByRole: "canonical_reactivation_reviewer",
          rationale: "The latest rollback actor cannot undo their own activation.",
          idempotencyKey: "reconciliation-reactivate:harborlight:self",
        },
        rollbackReviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);
    const reactivationInput = {
      objectType,
      objectKey,
      targetRevisionId: secondAcceptance.revision.id,
      expectedActiveRevisionId: firstAcceptance.revision.id,
      activatedByRole: "canonical_reactivation_reviewer",
      rationale: "Reactivate the exact existing second revision after rollback.",
      idempotencyKey: "reconciliation-reactivate:harborlight:v2",
    };
    const [reactivation, reactivationRetry] = await Promise.all([
      lifecycle.reactivateReconciliationRevision(
        reactivationInput,
        reactivationReviewer
      ),
      lifecycle.reactivateReconciliationRevision(
        reactivationInput,
        reactivationReviewer
      ),
    ]);
    expect(reactivationRetry.activation.id).toBe(reactivation.activation.id);
    expect(reactivation.revision.id).toBe(secondAcceptance.revision.id);
    await expect(
      lifecycle.reactivateReconciliationRevision(
        {
          ...reactivationInput,
          rationale: "Changed reactivation request must conflict.",
        },
        reactivationReviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    const unrelatedProposalBody = {
      proposalKey: "reconciliation:harborlight:unrelated-load:v1",
      objectType,
      objectKey: "harborlight:unrelated-load",
      baseRevisionId: null,
      proposedContent: { entityId: "harborlight:unrelated-load", value: 0.2 },
      evidence: { summary: "Separate canonical object for identity testing." },
      executionReceiptIds: [receiptId!],
      requiredReviewerRole,
      rationale: "Persist an independently governed canonical object.",
    };
    const unrelatedProposalHash =
      computeReferenceReconciliationProposalHash(unrelatedProposalBody);
    const unrelatedProposal = await lifecycle.createReconciliationProposal(
      {
        ...unrelatedProposalBody,
        idempotencyKey: "reconciliation-proposal:harborlight:unrelated:v1",
        proposalHash: unrelatedProposalHash,
      },
      proposer
    );
    const unrelatedDisposition =
      await lifecycle.reviewReconciliationProposal(
        unrelatedProposal.id,
        {
          objectType,
          objectKey: unrelatedProposalBody.objectKey,
          expectedProposalHash: unrelatedProposalHash,
          expectedDispositionVersion: 0,
          decision: "approved",
          reviewerRole: requiredReviewerRole,
          rationale: "The unrelated object has its own evidence and identity.",
          idempotencyKey: "reconciliation-review:harborlight:unrelated:v1",
        },
        evaluator
      );
    const unrelatedAcceptance =
      await lifecycle.acceptReconciliationProposal(
        unrelatedProposal.id,
        {
          objectType,
          objectKey: unrelatedProposalBody.objectKey,
          expectedProposalHash: unrelatedProposalHash,
          dispositionId: unrelatedDisposition.id,
          expectedActiveRevisionId: null,
          acceptedByRole: "canonical_operator",
          rationale: "Activate only the unrelated canonical object.",
          idempotencyKey: "reconciliation-accept:harborlight:unrelated:v1",
        },
        promoter
      );
    await expect(
      lifecycle.rollbackReconciliationRevision(
        {
          objectType,
          objectKey,
          targetRevisionId: unrelatedAcceptance.revision.id,
          expectedActiveRevisionId: secondAcceptance.revision.id,
          activatedByRole: "canonical_rollback_reviewer",
          rationale: "A real revision from another object must not cross identities.",
          idempotencyKey: "reconciliation-rollback:harborlight:cross-object",
        },
        rollbackReviewer
      )
    ).rejects.toBeInstanceOf(ReferenceLifecycleConflictError);

    await expect(
      pool.query(
        `UPDATE t2k_reference.reconciliation_objects
         SET active_revision_id = $2
         WHERE id = $1`,
        [firstAcceptance.revision.canonicalObjectId, firstAcceptance.revision.id]
      )
    ).rejects.toThrow("latest activation");
    await expect(
      pool.query(
        `UPDATE t2k_reference.reconciliation_objects
         SET active_revision_id = $2
         WHERE id = $1`,
        [
          firstAcceptance.revision.canonicalObjectId,
          unrelatedAcceptance.revision.id,
        ]
      )
    ).rejects.toThrow();
    await expect(
      pool.query(
        `UPDATE t2k_reference.reconciliation_objects
         SET object_key = 'cross-spliced-object'
         WHERE id = $1`,
        [firstAcceptance.revision.canonicalObjectId]
      )
    ).rejects.toThrow("identity is immutable");
    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_activations (
           id, canonical_object_id, activated_revision_id,
           previous_revision_id, activation_type, rationale,
           idempotency_key, activated_by_actor_type,
           activated_by_actor_id, activated_by_role
         ) VALUES (
           '10000000-0000-4000-8000-000000000001', $1, $2, $3,
           'reactivation', 'Cross-object splice must fail.',
           'direct-sql:cross-object-activation', 'human',
           'human:direct-sql', 'canonical_operator'
         )`,
        [
          firstAcceptance.revision.canonicalObjectId,
          unrelatedAcceptance.revision.id,
          secondAcceptance.revision.id,
        ]
      )
    ).rejects.toThrow();
    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_activations (
           id, canonical_object_id, activated_revision_id,
           previous_revision_id, activation_type, rationale,
           idempotency_key, activated_by_actor_type,
           activated_by_actor_id, activated_by_role
         ) VALUES (
           '10000000-0000-4000-8000-000000000002', $1, $2, $3,
           'reactivation', 'Pointer and latest activation must agree.',
           'direct-sql:pointer-mismatch', 'human',
           'human:direct-sql', 'canonical_operator'
         )`,
        [
          firstAcceptance.revision.canonicalObjectId,
          firstAcceptance.revision.id,
          secondAcceptance.revision.id,
        ]
      )
    ).rejects.toThrow("latest activation");
    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_revisions (
           id, canonical_object_id, revision_number, content, content_hash,
           parent_revision_id, proposal_id, approval_disposition_id,
           accepted_by_actor_type, accepted_by_actor_id, accepted_by_role
         ) VALUES (
           '20000000-0000-4000-8000-000000000001', $1, 99,
           '{}'::jsonb, $2, $3, $4, $5, 'human',
           'human:direct-sql', 'canonical_operator'
         )`,
        [
          firstAcceptance.revision.canonicalObjectId,
          "a".repeat(64),
          secondAcceptance.revision.id,
          unrelatedProposal.id,
          unrelatedDisposition.id,
        ]
      )
    ).rejects.toThrow();

    const rejectedProposalBody = {
      proposalKey: "reconciliation:harborlight:rejected:v1",
      objectType,
      objectKey: "harborlight:rejected",
      baseRevisionId: null,
      proposedContent: { entityId: "harborlight:rejected", value: 0.9 },
      evidence: { summary: "Evidence intentionally rejected by a human." },
      executionReceiptIds: [] as string[],
      requiredReviewerRole,
      rationale: "Exercise rejected-disposition database enforcement.",
    };
    const rejectedProposalHash =
      computeReferenceReconciliationProposalHash(rejectedProposalBody);
    const rejectedProposal = await lifecycle.createReconciliationProposal(
      {
        ...rejectedProposalBody,
        idempotencyKey: "reconciliation-proposal:rejected:v1",
        proposalHash: rejectedProposalHash,
      },
      proposer
    );
    const rejectedDisposition = await lifecycle.reviewReconciliationProposal(
      rejectedProposal.id,
      {
        objectType,
        objectKey: rejectedProposalBody.objectKey,
        expectedProposalHash: rejectedProposalHash,
        expectedDispositionVersion: 0,
        decision: "rejected",
        reviewerRole: requiredReviewerRole,
        rationale: "The evidence is insufficient for canonical acceptance.",
        idempotencyKey: "reconciliation-review:rejected:v1",
      },
      evaluator
    );
    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_revisions (
           id, canonical_object_id, revision_number, content, content_hash,
           parent_revision_id, proposal_id, approval_disposition_id,
           accepted_by_actor_type, accepted_by_actor_id, accepted_by_role
         ) VALUES (
           '20000000-0000-4000-8000-000000000002', $1, 1, $2, $3,
           NULL, $4, $5, 'human', 'human:direct-sql', 'canonical_operator'
         )`,
        [
          rejectedProposal.canonicalObjectId,
          JSON.stringify(rejectedProposal.proposedContent),
          rejectedProposal.contentHash,
          rejectedProposal.id,
          rejectedDisposition.id,
        ]
      )
    ).rejects.toThrow("approved disposition");

    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_activations (
           id, canonical_object_id, activated_revision_id,
           previous_revision_id, activation_type, source_proposal_id,
           approval_disposition_id, rationale, idempotency_key,
           activated_by_actor_type, activated_by_actor_id, activated_by_role
         ) VALUES (
           '10000000-0000-4000-8000-000000000003', $1, $2, NULL,
           'acceptance', $3, $4, 'Rejected approval must fail.',
           'direct-sql:rejected-activation', 'human',
           'human:direct-sql', 'canonical_operator'
         )`,
        [
          firstAcceptance.revision.canonicalObjectId,
          firstAcceptance.revision.id,
          firstProposal.id,
          rejectedDisposition.id,
        ]
      )
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_activations (
           id, canonical_object_id, activated_revision_id,
           previous_revision_id, activation_type, source_proposal_id,
           approval_disposition_id, rationale, idempotency_key,
           activated_by_actor_type, activated_by_actor_id, activated_by_role
         ) VALUES (
           '10000000-0000-4000-8000-000000000004', $1, $2, NULL,
           'acceptance', $3, $4, 'Duplicate acceptance must fail.',
           'direct-sql:duplicate-acceptance', 'human',
           'human:direct-sql', 'canonical_operator'
         )`,
        [
          secondAcceptance.revision.canonicalObjectId,
          secondAcceptance.revision.id,
          secondProposal.id,
          secondDisposition.id,
        ]
      )
    ).rejects.toThrow(
      /t2k_reference_reconciliation_acceptance_(proposal|revision)_uq/
    );

    const lineage = await lifecycle.getReconciliationLineage(
      objectType,
      objectKey
    );
    expect(lineage?.object.activeRevisionId).toBe(secondAcceptance.revision.id);
    expect(lineage?.activeRevision?.content).toEqual(secondContent);
    expect(lineage?.proposals).toHaveLength(2);
    expect(lineage?.proposals[0]?.executionReceiptIds).toEqual([receiptId]);
    expect(lineage?.proposals[0]?.executionReceipts[0]?.receiptDigest).toBe(
      firstProposal.executionReceipts[0]?.receiptDigest
    );
    expect(lineage?.dispositions).toHaveLength(2);
    expect(lineage?.revisions).toHaveLength(2);
    expect(lineage?.revisions[1]).toMatchObject({
      parentRevisionId: firstAcceptance.revision.id,
      proposalId: secondProposal.id,
      approvalDispositionId: secondDisposition.id,
    });
    expect(lineage?.activations.map((item) => item.activationType)).toEqual([
      "acceptance",
      "acceptance",
      "rollback",
      "reactivation",
    ]);

    await pool.query(
      `ALTER TABLE t2k_reference.reconciliation_proposals
       DISABLE TRIGGER t2k_reference_reconciliation_proposals_append_only`
    );
    try {
      await pool.query(
        `UPDATE t2k_reference.reconciliation_proposals
         SET content_hash = $2
         WHERE id = $1`,
        [firstProposal.id, "0".repeat(64)]
      );
      await expect(
        lifecycle.getReconciliationLineage(objectType, objectKey)
      ).rejects.toThrow("failed its hash check");
      await pool.query(
        `UPDATE t2k_reference.reconciliation_proposals
         SET content_hash = $2, proposal_hash = $3
         WHERE id = $1`,
        [firstProposal.id, firstProposal.contentHash, "e".repeat(64)]
      );
      await expect(
        lifecycle.getReconciliationLineage(objectType, objectKey)
      ).rejects.toThrow("failed its hash check");
    } finally {
      await pool.query(
        `UPDATE t2k_reference.reconciliation_proposals
         SET content_hash = $2, proposal_hash = $3
         WHERE id = $1`,
        [firstProposal.id, firstProposal.contentHash, firstProposal.proposalHash]
      );
      await pool.query(
        `ALTER TABLE t2k_reference.reconciliation_proposals
         ENABLE TRIGGER t2k_reference_reconciliation_proposals_append_only`
      );
    }
    const activationEvents = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload
       FROM t2k_reference.lifecycle_events
       WHERE event_type IN (
         'reconciliation_revision_accepted',
         'reconciliation_revision_rolled_back',
         'reconciliation_revision_reactivated'
       )`
    );
    expect(activationEvents.rows.length).toBeGreaterThanOrEqual(5);
    for (const { payload } of activationEvents.rows) {
      expect(payload.activationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(payload.idempotencyKey).toEqual(expect.any(String));
    }
    expect(await lifecycle.verifyEventChain()).toMatchObject({ valid: true });

    await expect(
      pool.query(
        `UPDATE t2k_reference.reconciliation_proposals
         SET rationale = 'mutated' WHERE id = $1`,
        [firstProposal.id]
      )
    ).rejects.toThrow("append-only");
    await expect(
      pool.query(
        `UPDATE t2k_reference.reconciliation_proposal_receipts
         SET receipt_snapshot = '{}'::jsonb
         WHERE proposal_id = $1`,
        [firstProposal.id]
      )
    ).rejects.toThrow("append-only");
    await expect(
      pool.query(
        `UPDATE t2k_reference.execution_receipts
         SET response = '{}'::jsonb
         WHERE id = $1`,
        [receiptId]
      )
    ).rejects.toThrow("append-only");
    await expect(
      pool.query("TRUNCATE t2k_reference.reconciliation_activations")
    ).rejects.toThrow("append-only");
    await expect(
      pool.query("TRUNCATE t2k_reference.execution_receipts CASCADE")
    ).rejects.toThrow("append-only");
    await expect(
      pool.query(
        "DELETE FROM t2k_reference.reconciliation_revisions WHERE id = $1",
        [secondAcceptance.revision.id]
      )
    ).rejects.toThrow("append-only");
  }, 120_000);

  it("rejects adversarial direct-SQL activation history splices", async () => {
    const objectType = "operational_entity";
    const objectKey = "harborlight:adversarial-activation";
    const requiredReviewerRole = "canonical_data_steward";

    const createApprovedProposal = async (
      suffix: string,
      baseRevisionId: string | null,
      proposedContent: { entityId: string; branch: string }
    ) => {
      const body = {
        proposalKey: `reconciliation:harborlight:adversarial:${suffix}`,
        objectType,
        objectKey,
        baseRevisionId,
        proposedContent,
        evidence: { summary: `Approved ${suffix} branch fixture.` },
        executionReceiptIds: [] as string[],
        requiredReviewerRole,
        rationale: `Create the ${suffix} branch without merging history.`,
      };
      const proposalHash = computeReferenceReconciliationProposalHash(body);
      const proposal = await lifecycle.createReconciliationProposal(
        {
          ...body,
          proposalHash,
          idempotencyKey: `reconciliation-proposal:adversarial:${suffix}`,
        },
        proposer
      );
      const disposition = await lifecycle.reviewReconciliationProposal(
        proposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: proposalHash,
          expectedDispositionVersion: 0,
          decision: "approved",
          reviewerRole: requiredReviewerRole,
          rationale: `Independently approve the ${suffix} branch fixture.`,
          idempotencyKey: `reconciliation-review:adversarial:${suffix}`,
        },
        evaluator
      );
      return { disposition, proposal, proposalHash };
    };

    const acceptApprovedProposal = async (
      suffix: string,
      approved: Awaited<ReturnType<typeof createApprovedProposal>>,
      expectedActiveRevisionId: string | null
    ) =>
      lifecycle.acceptReconciliationProposal(
        approved.proposal.id,
        {
          objectType,
          objectKey,
          expectedProposalHash: approved.proposalHash,
          dispositionId: approved.disposition.id,
          expectedActiveRevisionId,
          acceptedByRole: "canonical_operator",
          rationale: `Activate the approved ${suffix} branch fixture.`,
          idempotencyKey: `reconciliation-accept:adversarial:${suffix}`,
        },
        promoter
      );

    const expectDeferredCommitFailure = async (
      queries: Array<{
        text: string;
        values?: Array<string | number | null>;
      }>,
      expectedMessage: string
    ) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const query of queries) {
          await client.query(query.text, query.values ?? []);
        }
        await expect(client.query("COMMIT")).rejects.toThrow(expectedMessage);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    };

    const rootApproved = await createApprovedProposal(
      "root",
      null,
      { entityId: objectKey, branch: "root" }
    );
    const rootAcceptance = await acceptApprovedProposal(
      "root",
      rootApproved,
      null
    );
    const firstBranchApproved = await createApprovedProposal(
      "first-branch",
      rootAcceptance.revision.id,
      { entityId: objectKey, branch: "first" }
    );
    const firstBranchAcceptance = await acceptApprovedProposal(
      "first-branch",
      firstBranchApproved,
      rootAcceptance.revision.id
    );
    const rollback = await lifecycle.rollbackReconciliationRevision(
      {
        objectType,
        objectKey,
        targetRevisionId: rootAcceptance.revision.id,
        expectedActiveRevisionId: firstBranchAcceptance.revision.id,
        activatedByRole: "canonical_rollback_reviewer",
        rationale: "Return to the root before accepting a sibling branch.",
        idempotencyKey: "reconciliation-rollback:adversarial:first-to-root",
      },
      rollbackReviewer
    );
    expect(rollback.revision.id).toBe(rootAcceptance.revision.id);
    const siblingApproved = await createApprovedProposal(
      "sibling-branch",
      rootAcceptance.revision.id,
      { entityId: objectKey, branch: "sibling" }
    );
    const siblingAcceptance = await acceptApprovedProposal(
      "sibling-branch",
      siblingApproved,
      rootAcceptance.revision.id
    );

    await expectDeferredCommitFailure(
      [
        {
          text: `UPDATE t2k_reference.reconciliation_objects
                 SET active_revision_id = $2
                 WHERE id = $1`,
          values: [
            siblingAcceptance.revision.canonicalObjectId,
            firstBranchAcceptance.revision.id,
          ],
        },
        {
          text: `INSERT INTO t2k_reference.reconciliation_activations (
                   id, canonical_object_id, activated_revision_id,
                   previous_revision_id, activation_type, rationale,
                   idempotency_key, activated_by_actor_type,
                   activated_by_actor_id, activated_by_role
                 ) VALUES (
                   '30000000-0000-4000-8000-000000000001', $1, $2, $3,
                   'reactivation', 'Reject a false predecessor link.',
                   'direct-sql:adversarial:wrong-previous', 'human',
                   'human:direct-sql-governor', 'canonical_operator'
                 )`,
          values: [
            siblingAcceptance.revision.canonicalObjectId,
            firstBranchAcceptance.revision.id,
            rootAcceptance.revision.id,
          ],
        },
      ],
      "immediately preceding activation target"
    );

    await expectDeferredCommitFailure(
      [
        {
          text: `UPDATE t2k_reference.reconciliation_objects
                 SET active_revision_id = $2
                 WHERE id = $1`,
          values: [
            siblingAcceptance.revision.canonicalObjectId,
            firstBranchAcceptance.revision.id,
          ],
        },
        {
          text: `INSERT INTO t2k_reference.reconciliation_activations (
                   id, canonical_object_id, activated_revision_id,
                   previous_revision_id, activation_type, rationale,
                   idempotency_key, activated_by_actor_type,
                   activated_by_actor_id, activated_by_role
                 ) VALUES (
                   '30000000-0000-4000-8000-000000000002', $1, $2, $3,
                   'rollback', 'A sibling is not an ancestor.',
                   'direct-sql:adversarial:sibling-rollback', 'human',
                   'human:direct-sql-governor', 'canonical_operator'
                 )`,
          values: [
            siblingAcceptance.revision.canonicalObjectId,
            firstBranchAcceptance.revision.id,
            siblingAcceptance.revision.id,
          ],
        },
      ],
      "strict ancestor"
    );

    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_activations (
           sequence, id, canonical_object_id, activated_revision_id,
           previous_revision_id, activation_type, rationale,
           idempotency_key, activated_by_actor_type,
           activated_by_actor_id, activated_by_role
         ) VALUES (
           0, '30000000-0000-4000-8000-000000000003', $1, $2, $2,
           'reactivation', 'Explicit backdating must fail.',
           'direct-sql:adversarial:backdated', 'human',
           'human:direct-sql-governor', 'canonical_operator'
         )`,
        [
          siblingAcceptance.revision.canonicalObjectId,
          siblingAcceptance.revision.id,
        ]
      )
    ).rejects.toThrow("latest activation for its object");

    await expect(
      pool.query(
        `INSERT INTO t2k_reference.reconciliation_activations (
           id, canonical_object_id, activated_revision_id,
           previous_revision_id, activation_type, rationale,
           idempotency_key, activated_by_actor_type,
           activated_by_actor_id, activated_by_role
         ) VALUES (
           '30000000-0000-4000-8000-000000000004', $1, $2, $2,
           'reactivation', 'A no-op reactivation must fail.',
           'direct-sql:adversarial:no-op-reactivation', 'human',
           'human:direct-sql-governor', 'canonical_operator'
         )`,
        [
          siblingAcceptance.revision.canonicalObjectId,
          siblingAcceptance.revision.id,
        ]
      )
    ).rejects.toThrow("targets must differ from the previous revision");

    const reactivation = await lifecycle.reactivateReconciliationRevision(
      {
        objectType,
        objectKey,
        targetRevisionId: firstBranchAcceptance.revision.id,
        expectedActiveRevisionId: siblingAcceptance.revision.id,
        activatedByRole: "canonical_reactivation_reviewer",
        rationale: "Govern an explicit roll-forward to the existing sibling.",
        idempotencyKey: "reconciliation-reactivate:adversarial:first-branch",
      },
      reactivationReviewer
    );
    expect(reactivation.revision.id).toBe(firstBranchAcceptance.revision.id);

    const mismatchObjectKey = "harborlight:acceptance-identity";
    const mismatchBody = {
      proposalKey: "reconciliation:harborlight:acceptance-identity:root",
      objectType,
      objectKey: mismatchObjectKey,
      baseRevisionId: null,
      proposedContent: { entityId: mismatchObjectKey, branch: "root" },
      evidence: { summary: "Exercise activation actor and role binding." },
      executionReceiptIds: [] as string[],
      requiredReviewerRole,
      rationale: "Create an approved revision for direct-SQL binding tests.",
    };
    const mismatchProposalHash =
      computeReferenceReconciliationProposalHash(mismatchBody);
    const mismatchProposal = await lifecycle.createReconciliationProposal(
      {
        ...mismatchBody,
        proposalHash: mismatchProposalHash,
        idempotencyKey: "reconciliation-proposal:acceptance-identity:root",
      },
      proposer
    );
    const mismatchDisposition = await lifecycle.reviewReconciliationProposal(
      mismatchProposal.id,
      {
        objectType,
        objectKey: mismatchObjectKey,
        expectedProposalHash: mismatchProposalHash,
        expectedDispositionVersion: 0,
        decision: "approved",
        reviewerRole: requiredReviewerRole,
        rationale: "Approve the direct-SQL actor and role binding fixture.",
        idempotencyKey: "reconciliation-review:acceptance-identity:root",
      },
      evaluator
    );
    const mismatchRevisionId = "40000000-0000-4000-8000-000000000001";
    await pool.query(
      `INSERT INTO t2k_reference.reconciliation_revisions (
         id, canonical_object_id, revision_number, content, content_hash,
         parent_revision_id, proposal_id, approval_disposition_id,
         accepted_by_actor_type, accepted_by_actor_id, accepted_by_role
       ) VALUES (
         $1, $2, 1, $3, $4, NULL, $5, $6,
         'human', $7, 'canonical_operator'
       )`,
      [
        mismatchRevisionId,
        mismatchProposal.canonicalObjectId,
        JSON.stringify(mismatchProposal.proposedContent),
        mismatchProposal.contentHash,
        mismatchProposal.id,
        mismatchDisposition.id,
        promoter.actorId,
      ]
    );

    const acceptanceActivationQueries = (
      activationId: string,
      idempotencyKey: string,
      actorId: string,
      actorRole: string
    ) => [
      {
        text: `UPDATE t2k_reference.reconciliation_objects
               SET active_revision_id = $2
               WHERE id = $1`,
        values: [mismatchProposal.canonicalObjectId, mismatchRevisionId],
      },
      {
        text: `INSERT INTO t2k_reference.reconciliation_activations (
                 id, canonical_object_id, activated_revision_id,
                 previous_revision_id, activation_type, source_proposal_id,
                 approval_disposition_id, rationale, idempotency_key,
                 activated_by_actor_type, activated_by_actor_id,
                 activated_by_role
               ) VALUES (
                 $1, $2, $3, NULL, 'acceptance', $4, $5,
                 'Actor and role must match the revision.', $6,
                 'human', $7, $8
               )`,
        values: [
          activationId,
          mismatchProposal.canonicalObjectId,
          mismatchRevisionId,
          mismatchProposal.id,
          mismatchDisposition.id,
          idempotencyKey,
          actorId,
          actorRole,
        ],
      },
    ];
    await expectDeferredCommitFailure(
      acceptanceActivationQueries(
        "40000000-0000-4000-8000-000000000002",
        "direct-sql:acceptance-identity:actor",
        "human:wrong-acceptance-actor",
        "canonical_operator"
      ),
      "actor and role must match the accepted revision"
    );
    await expectDeferredCommitFailure(
      acceptanceActivationQueries(
        "40000000-0000-4000-8000-000000000003",
        "direct-sql:acceptance-identity:role",
        promoter.actorId,
        "wrong_operator_role"
      ),
      "actor and role must match the accepted revision"
    );

    const adversarialLineage = await lifecycle.getReconciliationLineage(
      objectType,
      objectKey
    );
    expect(adversarialLineage?.object.activeRevisionId).toBe(
      firstBranchAcceptance.revision.id
    );
    expect(
      adversarialLineage?.activations.map((activation) =>
        activation.activationType
      )
    ).toEqual([
      "acceptance",
      "acceptance",
      "rollback",
      "acceptance",
      "reactivation",
    ]);
  }, 120_000);

  it("closes guardrail violations as evidence and fails matching replay", async () => {
    const context = await lifecycle.createDecisionContext(
      {
        contextKey: "context:guardrail-violation",
        question: "Should Harborlight hold under unsafe crew load?",
        decisionType: "operations.dispatch_overflow",
        stateSnapshot: { facts: [{ objectValue: 0.2 }] },
        objective: { maximize: "harborlight.on_time_completion_rate" },
        constraints: ["Crew load must remain inside the declared range."],
        requiredAuthority: { role: "dispatch_owner" },
        learningContract,
      },
      proposer
    );
    const recommendation = await lifecycle.recommend(
      context.contextKey,
      { recommendationKey: "recommendation:guardrail-violation" },
      proposer
    );
    expect(recommendation.proposedAction).toBe("hold");
    const authorization = await lifecycle.authorizeRecommendation(
      recommendation.id,
      { rationale: "The dispatch owner authorizes the synthetic hold." },
      reviewer
    );
    const episode = await lifecycle.openEpisode(
      {
        episodeKey: "episode:guardrail-violation",
        contextKey: context.contextKey,
        authorizedDecisionId: authorization.id,
        externalEffect: false,
      },
      proposer
    );
    await lifecycle.recordObservation(
      episode.id,
      {
        measureRef: rewardSpec[0]!.measureRef,
        observedValue: 0.4,
        baselineValue: 0.4,
        observationWindow: "7d",
        sourceRefs: ["fixture://harborlight/guardrail/objective"],
        observedAt: "2026-03-01T00:00:00.000Z",
      },
      proposer
    );
    await lifecycle.recordObservation(
      episode.id,
      {
        measureRef: rewardSpec[1]!.measureRef,
        observedValue: 0.95,
        baselineValue: null,
        observationWindow: "7d",
        sourceRefs: ["fixture://harborlight/guardrail/crew-load"],
        observedAt: "2026-03-01T00:00:00.000Z",
      },
      proposer
    );
    const assessment = await lifecycle.assessReward(
      episode.id,
      { assessmentKey: "assessment:guardrail-violation" },
      rewardEngine
    );
    expect(assessment).toMatchObject({
      lifecycleStatus: "guardrail_violation",
      scalarReward: null,
      evaluationReward: -1,
    });
    await expect(
      lifecycle.closeEpisode(
        episode.id,
        "Preserve the adverse terminal outcome as evidence.",
        reviewer
      )
    ).resolves.toMatchObject({ lifecycleStatus: "closed" });

    const candidate = await lifecycle.createCandidate(
      {
        candidateKey: "candidate:harborlight-dispatch:1.2.0",
        policyKey: "harborlight-dispatch",
        sourcePolicyVersionId: baselineVersion.id,
        proposedPolicyVersion: "1.2.0",
        proposedSpecification: candidateSpecification,
        trainingEpisodeIds,
        rationale: "Exercise the guardrail replay gate.",
      },
      proposer
    );
    const replay = await lifecycle.evaluateCandidate(
      candidate.id,
      {
        evaluationKey: "replay:guardrail-violation",
        holdoutEpisodeIds: [episode.id],
      },
      evaluator
    );
    expect(replay.lifecycleStatus).toBe("failed");
    expect(replay.metrics.candidate.guardrailViolations).toBe(1);

    const stagedCandidate = await lifecycle.createCandidate(
      {
        candidateKey: "candidate:harborlight-dispatch:1.3.0",
        policyKey: "harborlight-dispatch",
        sourcePolicyVersionId: baselineVersion.id,
        proposedPolicyVersion: "1.3.0",
        proposedSpecification: candidateSpecification,
        trainingEpisodeIds,
        rationale: "Exercise staged promotion deployment.",
      },
      proposer
    );
    await expect(
      lifecycle.evaluateCandidate(
        stagedCandidate.id,
        {
          evaluationKey: "replay:harborlight-dispatch:1.3.0",
          holdoutEpisodeIds,
        },
        evaluator
      )
    ).resolves.toMatchObject({ lifecycleStatus: "passed" });
    const staged = await lifecycle.promoteCandidate(
      stagedCandidate.id,
      {
        reviewRationale: "Accept the candidate without changing the active pointer.",
        deploy: false,
      },
      promoter
    );
    expect(staged.promotion.lifecycleStatus).toBe("accepted");
    expect(
      (await lifecycle.getActivePolicy("operations.dispatch_overflow"))?.version.id
    ).toBe(baselineVersion.id);
    await expect(
      lifecycle.deployPolicyVersion(
        "harborlight-dispatch",
        staged.policyVersion.policyVersion,
        reviewer
      )
    ).rejects.toThrow("deployPromotion");
    await expect(
      lifecycle.deployPromotion(staged.promotion.id, promoter)
    ).resolves.toMatchObject({ lifecycleStatus: "deployed" });
    expect(
      (await lifecycle.getActivePolicy("operations.dispatch_overflow"))?.version.id
    ).toBe(staged.policyVersion.id);
    await lifecycle.rollbackPromotion(
      staged.promotion.id,
      "Restore the exact parent after the staged deployment exercise.",
      rollbackReviewer
    );
    expect(
      (await lifecycle.getActivePolicy("operations.dispatch_overflow"))?.version.id
    ).toBe(baselineVersion.id);

    const snapshot = await lifecycle.snapshot();
    expect(snapshot.rewardAggregates).toContainEqual(
      expect.objectContaining({
        policyVersionId: baselineVersion.id,
        episodeCount: 17,
        guardrailViolations: 1,
      })
    );
    expect(snapshot.eventChain.valid).toBe(true);
  });

  it("does not record v2 when a required reconciliation constraint is missing", async () => {
    await pool.query(
      "DELETE FROM t2k_reference.schema_migrations WHERE version = 2"
    );
    await pool.query(
      `ALTER TABLE t2k_reference.reconciliation_activations
       DROP CONSTRAINT t2k_reference_reconciliation_activation_target_object_fk`
    );
    await expect(lifecycle.migrate()).rejects.toThrow(
      "missing required constraints"
    );
    expect(
      (
        await pool.query(
          "SELECT 1 FROM t2k_reference.schema_migrations WHERE version = 2"
        )
      ).rowCount
    ).toBe(0);
    await pool.query(
      `ALTER TABLE t2k_reference.reconciliation_activations
       ADD CONSTRAINT t2k_reference_reconciliation_activation_target_object_fk
       FOREIGN KEY (activated_revision_id, canonical_object_id)
       REFERENCES t2k_reference.reconciliation_revisions(
         id, canonical_object_id
       )`
    );
    expect(await lifecycle.migrate()).toBe(2);
  });
});
