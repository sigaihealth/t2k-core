import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
    await pool.query("DROP SCHEMA IF EXISTS t2k_reference CASCADE");
    lifecycle = new PostgresReferenceLifecycle({ pool });
    await lifecycle.migrate();
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
});
