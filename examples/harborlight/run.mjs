import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregatePolicyRewards,
  evaluateReferenceReplay,
  validateOntologyPackManifest,
} from "../../packages/core/dist/index.js";
import { compileOntologyPackSet } from "../../packages/core/dist/compiler.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "ontology-pack.json"), "utf8")
);

const validation = validateOntologyPackManifest(manifest);
assert.equal(
  validation.valid,
  true,
  `Harborlight manifest failed schema validation: ${JSON.stringify(validation.errors)}`
);

const compilation = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }],
});
assert.equal(compilation.status, "valid", "Harborlight ontology must compile");

const evaluation = {
  minimumEpisodes: 20,
  minimumImprovement: 0.05,
  confidenceZ: 1.96,
  minimumCoverage: 0.2,
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
const candidateSpecification = {
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

const trainingEpisodeIds = Array.from(
  { length: 4 },
  (_, index) => `harborlight-training-${index + 1}`
);
const holdout = [
  ...Array.from({ length: 10 }, (_, index) => ({
    episodeId: `harborlight-holdout-overtime-${index + 1}`,
    pressure: 0.61 + index * 0.01,
    loggedAction: "authorize_overtime",
    scalarReward: -0.5,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    episodeId: `harborlight-holdout-rebalance-${index + 1}`,
    pressure: 0.72 + index * 0.01,
    loggedAction: "rebalance_route",
    scalarReward: 1,
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    episodeId: `harborlight-holdout-hold-${index + 1}`,
    pressure: 0.21 + index * 0.03,
    loggedAction: "hold",
    scalarReward: 0,
  })),
].map((episode) => ({
  episodeId: episode.episodeId,
  state: { facts: [{ objectValue: episode.pressure }] },
  loggedAction: episode.loggedAction,
  scalarReward: episode.scalarReward,
  learningMode: "supervised_feedback",
  behaviorProbability: null,
  guardrailViolation: false,
}));

const holdoutIds = new Set(holdout.map((episode) => episode.episodeId));
assert.equal(holdout.length, 20, "The evaluation contract requires 20 holdout episodes");
assert.equal(
  trainingEpisodeIds.some((episodeId) => holdoutIds.has(episodeId)),
  false,
  "Training and holdout episodes must be disjoint"
);

const replay = evaluateReferenceReplay({
  candidateSpecification,
  baselineSpecification,
  episodes: holdout,
});

assert.equal(replay.status, "passed", "The independently computed replay must pass");
assert.equal(replay.candidate.coverage, 0.5, "Candidate coverage must remain explicit");
assert.equal(replay.baseline.coverage, 0.7, "Baseline coverage must remain explicit");
assert.ok(
  replay.improvementConfidenceLower > evaluation.minimumImprovement,
  "The paired lower bound must clear the promotion threshold"
);
assert.equal(replay.candidate.guardrailViolations, 0);

const rewardAggregates = aggregatePolicyRewards(
  holdout.map((episode) => ({
    policyVersionId: "dispatch-policy@1.0.0",
    scalarReward: episode.scalarReward,
    guardrailViolation: episode.guardrailViolation,
  }))
);

console.log(
  JSON.stringify(
    {
      ontology: `${manifest.ontologyId}@${manifest.ontologyVersion}`,
      resolutionHash: compilation.resolutionHash,
      episodes: {
        training: trainingEpisodeIds.length,
        holdout: holdout.length,
        disjoint: true,
      },
      replay: {
        status: replay.status,
        estimatedImprovement: replay.estimatedImprovement,
        improvementConfidenceLower: replay.improvementConfidenceLower,
        candidateCoverage: replay.candidate.coverage,
        baselineCoverage: replay.baseline.coverage,
      },
      rewardAggregates,
    },
    null,
    2
  )
);
