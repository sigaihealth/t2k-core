import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateOntologyPackManifest } from "@t2kai/core";
import { compileOntologyPackSet } from "@t2kai/core/compiler";
import { PostgresReferenceLifecycle } from "@t2kai/core/postgres";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(projectRoot, relativePath), "utf8"));
const [manifest, baseline, candidatePolicy, holdout] = await Promise.all([
  readJson("ontology-pack.json"),
  readJson("policies/baseline.json"),
  readJson("policies/candidate.json"),
  readJson("episodes/holdout.json"),
]);

const validation = validateOntologyPackManifest(manifest);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));
const compilation = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }],
});
assert.equal(compilation.status, "valid", JSON.stringify(compilation.diagnostics));

const template = manifest.decisionTemplates[0];
const learningContract = template.learningContract;
const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const policyKey = `${baseline.policyKey}-${runId}`;
const decisionType = `${template.decisionType}.${runId}`;
const connectionString =
  process.env.T2K_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.T2K_TEST_DATABASE_URL ??
  "postgresql://t2k:t2k@127.0.0.1:55432/t2k_reference";

const actors = {
  proposer: { actorType: "agent", actorId: "agent:policy-builder" },
  reviewer: { actorType: "human", actorId: "human:dispatch-owner" },
  evaluator: { actorType: "human", actorId: "human:policy-evaluator" },
  promoter: { actorType: "human", actorId: "human:policy-promoter" },
  rollback: { actorType: "human", actorId: "human:rollback-reviewer" },
  reward: { actorType: "system", actorId: "system:reward-engine" },
};
const lifecycle = new PostgresReferenceLifecycle({ connectionString });
const trainingEpisodeIds = [];
const holdoutEpisodeIds = [];

const sha256 = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function createAcceptedVersion(version, specification, parentVersionId) {
  const proposed = await lifecycle.createPolicyVersion(
    policyKey,
    {
      policyVersion: version,
      learningMode: learningContract.mode,
      specification,
      rewardSpec: learningContract.rewardSpec,
      parentVersionId,
      rationale: `Synthetic reference policy ${version}.`,
    },
    actors.proposer
  );
  return lifecycle.acceptPolicyVersion(
    policyKey,
    proposed.policyVersion,
    "An independent human accepted the deterministic policy.",
    actors.reviewer
  );
}

async function persistFixture(fixture, index) {
  const key = `${runId}:${fixture.cohort}:${fixture.fixtureId}`;
  const pressure = fixture.state.facts[0].objectValue;
  const context = await lifecycle.createDecisionContext(
    {
      contextKey: `context:${key}`,
      question: template.question,
      decisionType,
      stateSnapshot: fixture.state,
      objective: { maximize: template.successMeasure },
      constraints: template.policies,
      requiredAuthority: { role: template.authority },
      learningContract,
    },
    actors.proposer
  );
  const recommendation = await lifecycle.recommend(
    context.contextKey,
    { recommendationKey: `recommendation:${key}` },
    actors.proposer
  );
  assert.equal(recommendation.proposedAction, fixture.loggedAction);
  const authorization = await lifecycle.authorizeRecommendation(
    recommendation.id,
    { rationale: "The dispatch owner authorizes this reversible synthetic action." },
    actors.reviewer
  );
  const episode = await lifecycle.openEpisode(
    {
      episodeKey: `episode:${key}`,
      contextKey: context.contextKey,
      authorizedDecisionId: authorization.id,
      externalEffect: true,
    },
    actors.proposer
  );

  const request = { action: fixture.loggedAction, pressure };
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
    actors.proposer
  );
  await lifecycle.recordObservation(
    episode.id,
    {
      measureRef: learningContract.rewardSpec[0].measureRef,
      observedValue: 0.4 + fixture.scalarReward * 0.4,
      baselineValue: 0.4,
      unit: "ratio",
      observationWindow: "7d",
      sourceRefs: [`fixture://harborlight/${key}`],
      provenance: { cohort: fixture.cohort, synthetic: true },
      attributionConfidence: 1,
      observedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    },
    actors.proposer
  );
  const reward = await lifecycle.assessReward(
    episode.id,
    {
      assessmentKey: `assessment:${key}`,
      attribution: { method: "deterministic_synthetic_fixture" },
    },
    actors.reward
  );
  assert.equal(reward.lifecycleStatus, "complete");
  await lifecycle.closeEpisode(
    episode.id,
    "The receipt and outcome observation are complete.",
    actors.reviewer
  );
  (fixture.cohort === "training" ? trainingEpisodeIds : holdoutEpisodeIds).push(
    episode.id
  );
}

const behaviorTraining = [
  {
    fixtureId: "training-rebalance-01",
    cohort: "training",
    state: { facts: [{ objectValue: 0.82 }] },
    loggedAction: "rebalance_route",
    scalarReward: 0.8,
  },
  {
    fixtureId: "training-rebalance-02",
    cohort: "training",
    state: { facts: [{ objectValue: 0.74 }] },
    loggedAction: "rebalance_route",
    scalarReward: 0.7,
  },
];
const baselineTraining = [
  {
    fixtureId: "training-hold-01",
    cohort: "training",
    state: { facts: [{ objectValue: 0.31 }] },
    loggedAction: "hold",
    scalarReward: 0,
  },
  {
    fixtureId: "training-hold-02",
    cohort: "training",
    state: { facts: [{ objectValue: 0.22 }] },
    loggedAction: "hold",
    scalarReward: 0.05,
  },
];
const normalizedHoldout = holdout.map((episode) => ({
  ...episode,
  fixtureId: episode.episodeId,
  cohort: "holdout",
}));

try {
  const schemaVersion = await lifecycle.migrate();
  await lifecycle.createPolicy(
    {
      policyKey,
      label: "Harborlight dispatch policy",
      decisionType,
      description: "A synthetic persisted decision-learning loop.",
    },
    actors.proposer
  );

  const behavior = await createAcceptedVersion(
    "0.9.0",
    candidatePolicy.specification
  );
  await lifecycle.deployPolicyVersion(policyKey, "0.9.0", actors.reviewer);
  const behaviorFixtures = [
    ...behaviorTraining,
    ...normalizedHoldout.filter((episode) => episode.loggedAction === "rebalance_route"),
  ];
  for (const [index, fixture] of behaviorFixtures.entries()) {
    await persistFixture(fixture, index);
  }

  const baselineVersion = await createAcceptedVersion(
    baseline.version,
    baseline.specification,
    behavior.id
  );
  await lifecycle.deployPolicyVersion(policyKey, baseline.version, actors.reviewer);
  const baselineFixtures = [
    ...baselineTraining,
    ...normalizedHoldout.filter((episode) => episode.loggedAction !== "rebalance_route"),
  ];
  for (const [index, fixture] of baselineFixtures.entries()) {
    await persistFixture(fixture, behaviorFixtures.length + index);
  }

  assert.equal(trainingEpisodeIds.length, 4);
  assert.equal(holdoutEpisodeIds.length, 20);
  const candidate = await lifecycle.createCandidate(
    {
      candidateKey: `candidate:${runId}:${candidatePolicy.version}`,
      policyKey,
      sourcePolicyVersionId: baselineVersion.id,
      proposedPolicyVersion: candidatePolicy.version,
      proposedSpecification: candidatePolicy.specification,
      trainingEpisodeIds,
      rationale: "Training evidence supports route rebalancing under pressure.",
    },
    actors.proposer
  );
  const replay = await lifecycle.evaluateCandidate(
    candidate.id,
    {
      evaluationKey: `replay:${runId}:${candidatePolicy.version}`,
      holdoutEpisodeIds,
      evidenceRefs: [`fixture://harborlight/${runId}/holdout`],
    },
    actors.evaluator
  );
  assert.equal(replay.lifecycleStatus, "passed");

  const promoted = await lifecycle.promoteCandidate(
    candidate.id,
    {
      reviewRationale: "Computed held-out replay passed the promotion threshold.",
      deploy: true,
    },
    actors.promoter
  );
  const rollback = await lifecycle.rollbackPromotion(
    promoted.promotion.id,
    "Restore the exact parent after proving rollback.",
    actors.rollback
  );
  const restored = await lifecycle.getActivePolicy(decisionType);
  assert.equal(restored?.version.id, baselineVersion.id);
  const eventChain = await lifecycle.verifyEventChain();
  assert.equal(eventChain.valid, true);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        ontology: `${manifest.ontologyId}@${manifest.ontologyVersion}`,
        resolutionHash: compilation.resolutionHash,
        runId,
        schemaVersion,
        persisted: { episodes: 24, executionReceipts: 24 },
        replay: replay.metrics,
        promotion: {
          version: promoted.policyVersion.policyVersion,
          status: promoted.promotion.lifecycleStatus,
        },
        rollback: {
          status: rollback.lifecycleStatus,
          restoredVersion: restored.version.policyVersion,
          exactParentRestored: true,
        },
        eventChain,
      },
      null,
      2
    )
  );
} finally {
  await lifecycle.close();
}
