import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateOntologyPackManifest } from "@t2kai/core";
import { compileOntologyPackSet } from "@t2kai/core/compiler";
import { PostgresReferenceLifecycle } from "@t2kai/core/postgres";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "ontology-pack.json"), "utf8")
);
const validation = validateOntologyPackManifest(manifest);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));

const compilation = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }],
});
assert.equal(compilation.status, "valid", JSON.stringify(compilation.diagnostics));

const decisionTemplate = manifest.decisionTemplates.find(
  (template) => template.id === "route_overflow"
);
assert.ok(decisionTemplate?.learningContract, "The demo requires a learning contract.");

const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const policyKey = `harborlight-dispatch-${runId}`;
const runtimeDecisionType = `${decisionTemplate.decisionType}.${runId}`;
const connectionString =
  process.env.T2K_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.T2K_TEST_DATABASE_URL ??
  "postgresql://t2k:t2k@127.0.0.1:55432/t2k_reference";

const proposer = { actorType: "agent", actorId: "agent:policy-builder" };
const reviewer = { actorType: "human", actorId: "human:dispatch-owner" };
const evaluator = { actorType: "human", actorId: "human:policy-evaluator" };
const promoter = { actorType: "human", actorId: "human:policy-promoter" };
const rollbackReviewer = {
  actorType: "human",
  actorId: "human:rollback-reviewer",
};
const rewardEngine = { actorType: "system", actorId: "system:reward-engine" };

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

const behaviorFixtures = [
  { cohort: "training", pressure: 0.82, action: "rebalance_route", rate: 0.72 },
  { cohort: "training", pressure: 0.74, action: "rebalance_route", rate: 0.68 },
  ...Array.from({ length: 6 }, (_, index) => ({
    cohort: "holdout",
    pressure: 0.72 + index * 0.01,
    action: "rebalance_route",
    rate: 0.8,
  })),
];
const baselineFixtures = [
  { cohort: "training", pressure: 0.31, action: "hold", rate: 0.4 },
  { cohort: "training", pressure: 0.22, action: "hold", rate: 0.42 },
  ...Array.from({ length: 10 }, (_, index) => ({
    cohort: "holdout",
    pressure: 0.61 + index * 0.01,
    action: "authorize_overtime",
    rate: 0.2,
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    cohort: "holdout",
    pressure: 0.21 + index * 0.03,
    action: "hold",
    rate: 0.4,
  })),
];

const lifecycle = new PostgresReferenceLifecycle({ connectionString });
const trainingEpisodeIds = [];
const holdoutEpisodeIds = [];
let receiptCount = 0;

const sha256 = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function createAcceptedVersion(version, specification, parentVersionId) {
  const proposed = await lifecycle.createPolicyVersion(
    policyKey,
    {
      policyVersion: version,
      learningMode: decisionTemplate.learningContract.mode,
      specification,
      rewardSpec: decisionTemplate.learningContract.rewardSpec,
      parentVersionId,
      rationale: `Synthetic Harborlight policy ${version}.`,
    },
    proposer
  );
  return lifecycle.acceptPolicyVersion(
    policyKey,
    version,
    "An independent human accepted the deterministic policy.",
    reviewer
  );
}

async function persistEpisode(fixture, index) {
  const key = `${runId}:${fixture.cohort}:${String(index + 1).padStart(2, "0")}`;
  const context = await lifecycle.createDecisionContext(
    {
      contextKey: `context:${key}`,
      question: decisionTemplate.question,
      decisionType: runtimeDecisionType,
      stateSnapshot: { facts: [{ objectValue: fixture.pressure }] },
      objective: { maximize: decisionTemplate.successMeasure },
      constraints: decisionTemplate.policies,
      requiredAuthority: { role: decisionTemplate.authority },
      learningContract: decisionTemplate.learningContract,
    },
    proposer
  );
  const recommendation = await lifecycle.recommend(
    context.contextKey,
    { recommendationKey: `recommendation:${key}` },
    proposer
  );
  assert.equal(recommendation.proposedAction, fixture.action);

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
  const request = { action: fixture.action, pressure: fixture.pressure };
  const response = { applied: true, synthetic: true };
  await lifecycle.recordExecutionReceipt(
    episode.id,
    {
      receiptKey: `receipt:${key}`,
      idempotencyKey: `idempotency:${key}`,
      connectorRef: "synthetic.harborlight.dispatch",
      externalTransactionId: `dispatch-${key}`,
      outcome: "succeeded",
      requestHash: sha256(request),
      responseHash: sha256(response),
      response,
      rollbackContract: { operation: "restore_prior_dispatch_plan" },
      reconciliationStatus: "reconciled",
    },
    proposer
  );
  receiptCount += 1;

  await lifecycle.recordObservation(
    episode.id,
    {
      measureRef: decisionTemplate.learningContract.rewardSpec[0].measureRef,
      observedValue: fixture.rate,
      baselineValue: 0.4,
      unit: "ratio",
      observationWindow: "7d",
      sourceRefs: [`fixture://harborlight/${key}`],
      provenance: { cohort: fixture.cohort, synthetic: true },
      attributionConfidence: 1,
      observedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
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
  assert.equal(assessment.lifecycleStatus, "complete");
  await lifecycle.closeEpisode(
    episode.id,
    "The receipt and seven-day observation are complete.",
    reviewer
  );
  (fixture.cohort === "training" ? trainingEpisodeIds : holdoutEpisodeIds).push(
    episode.id
  );
}

try {
  const schemaVersion = await lifecycle.migrate();
  await lifecycle.createPolicy(
    {
      policyKey,
      label: "Harborlight dispatch policy",
      description: "Synthetic governed dispatch learning loop.",
      decisionType: runtimeDecisionType,
    },
    proposer
  );

  const behaviorVersion = await createAcceptedVersion("0.9.0", behaviorSpecification);
  await lifecycle.deployPolicyVersion(policyKey, "0.9.0", reviewer);
  for (const [index, fixture] of behaviorFixtures.entries()) {
    await persistEpisode(fixture, index);
  }

  const baselineVersion = await createAcceptedVersion(
    "1.0.0",
    baselineSpecification,
    behaviorVersion.id
  );
  await lifecycle.deployPolicyVersion(policyKey, "1.0.0", reviewer);
  for (const [index, fixture] of baselineFixtures.entries()) {
    await persistEpisode(fixture, behaviorFixtures.length + index);
  }

  assert.equal(trainingEpisodeIds.length, 4);
  assert.equal(holdoutEpisodeIds.length, 20);
  assert.equal(trainingEpisodeIds.some((id) => holdoutEpisodeIds.includes(id)), false);

  const candidate = await lifecycle.createCandidate(
    {
      candidateKey: `candidate:${runId}:1.1.0`,
      policyKey,
      sourcePolicyVersionId: baselineVersion.id,
      proposedPolicyVersion: "1.1.0",
      proposedSpecification: behaviorSpecification,
      trainingEpisodeIds,
      rationale: "Training evidence supports route rebalancing under pressure.",
    },
    proposer
  );
  const replay = await lifecycle.evaluateCandidate(
    candidate.id,
    {
      evaluationKey: `replay:${runId}:1.1.0`,
      holdoutEpisodeIds,
      evidenceRefs: [`fixture://harborlight/${runId}/holdout`],
    },
    evaluator
  );
  assert.equal(replay.lifecycleStatus, "passed");

  const promoted = await lifecycle.promoteCandidate(
    candidate.id,
    {
      reviewRationale: "Replay passed with support and a positive confidence bound.",
      deploy: true,
    },
    promoter
  );
  const activeAfterPromotion = await lifecycle.getActivePolicy(runtimeDecisionType);
  assert.equal(activeAfterPromotion?.version.id, promoted.policyVersion.id);

  const rollback = await lifecycle.rollbackPromotion(
    promoted.promotion.id,
    "Restore the exact prior policy after the rollback exercise.",
    rollbackReviewer
  );
  const activeAfterRollback = await lifecycle.getActivePolicy(runtimeDecisionType);
  assert.equal(activeAfterRollback?.version.id, baselineVersion.id);

  const snapshot = await lifecycle.snapshot();
  assert.equal(snapshot.eventChain.valid, true);
  assert.equal(snapshot.episodes.filter((episode) =>
    trainingEpisodeIds.includes(episode.id) || holdoutEpisodeIds.includes(episode.id)
  ).length, 24);

  console.log(
    JSON.stringify(
      {
        ontology: `${manifest.ontologyId}@${manifest.ontologyVersion}`,
        resolutionHash: compilation.resolutionHash,
        runId,
        schemaVersion,
        persisted: {
          episodes: 24,
          executionReceipts: receiptCount,
          trainingEpisodes: trainingEpisodeIds.length,
          heldOutEpisodes: holdoutEpisodeIds.length,
        },
        replay: {
          status: replay.lifecycleStatus,
          sampleSize: replay.metrics.sampleSize,
          estimatedImprovement: replay.metrics.estimatedImprovement,
          improvementConfidenceLower: replay.metrics.improvementConfidenceLower,
          candidateCoverage: replay.metrics.candidate.coverage,
          baselineCoverage: replay.metrics.baseline.coverage,
        },
        promotion: {
          deployedVersion: promoted.policyVersion.policyVersion,
          status: promoted.promotion.lifecycleStatus,
        },
        rollback: {
          status: rollback.lifecycleStatus,
          restoredVersion: activeAfterRollback.version.policyVersion,
          exactParentRestored: activeAfterRollback.version.id === baselineVersion.id,
        },
        eventChain: snapshot.eventChain,
      },
      null,
      2
    )
  );
} finally {
  await lifecycle.close();
}
