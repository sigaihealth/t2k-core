import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregatePolicyRewards,
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  validateOntologyPackManifest,
} from "@t2kai/core";
import { compileOntologyPackSet } from "@t2kai/core/compiler";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(projectRoot, relativePath), "utf8"));

const [manifest, context, baseline, candidate, episodes] = await Promise.all([
  readJson("ontology-pack.json"),
  readJson("decision-context.json"),
  readJson("policies/baseline.json"),
  readJson("policies/candidate.json"),
  readJson("episodes/holdout.json"),
]);

const validation = validateOntologyPackManifest(manifest);
assert.equal(
  validation.valid,
  true,
  `Ontology validation failed: ${JSON.stringify(validation.errors)}`
);
const compilation = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }],
});
assert.equal(compilation.status, "valid", JSON.stringify(compilation.diagnostics));

const decisionTemplate = compilation.definitions.find(
  (definition) =>
    definition.definitionKind === "decision_template" &&
    definition.body.decisionType === context.decisionType
);
assert.ok(decisionTemplate, `No compiled template for ${context.decisionType}`);
const acceptedFactRefs = new Set(
  context.facts
    .filter((fact) => fact.status === "accepted")
    .map((fact) => fact.predicateRef)
);
for (const requiredFact of decisionTemplate.body.requiredFacts ?? []) {
  assert.ok(acceptedFactRefs.has(requiredFact), `Missing accepted fact: ${requiredFact}`);
}
assert.equal(
  context.authority.humanReviewRequired,
  true,
  "The quickstart must not silently authorize its recommendation."
);

const state = { facts: context.facts };
const baselineAction = evaluateReferencePolicy(baseline.specification, state);
const candidateAction = evaluateReferencePolicy(candidate.specification, state);
const replay = evaluateReferenceReplay({
  candidateSpecification: candidate.specification,
  baselineSpecification: baseline.specification,
  episodes: episodes.map(({ policyVersionId: _policyVersionId, ...episode }) => episode),
});
assert.equal(replay.status, "passed", "The challenger must pass computed replay.");
assert.equal(replay.candidate.guardrailViolations, 0);

const rewardAggregates = aggregatePolicyRewards(
  episodes.map((episode) => ({
    policyVersionId: episode.policyVersionId,
    scalarReward: episode.scalarReward,
    guardrailViolation: episode.guardrailViolation,
  }))
);
const result = {
  ontology: `${manifest.ontologyId}@${manifest.ontologyVersion}`,
  resolutionHash: compilation.resolutionHash,
  decisionContext: {
    contextKey: context.contextKey,
    decisionType: context.decisionType,
    acceptedFacts: acceptedFactRefs.size,
  },
  reasoning: {
    baseline: { version: baseline.version, action: baselineAction },
    candidate: { version: candidate.version, action: candidateAction },
  },
  replay: {
    status: replay.status,
    sampleSize: replay.sampleSize,
    estimatedImprovement: replay.estimatedImprovement,
    improvementConfidenceLower: replay.improvementConfidenceLower,
    candidateCoverage: replay.candidate.coverage,
    baselineCoverage: replay.baseline.coverage,
    guardrailViolations: replay.candidate.guardrailViolations,
  },
  rewardAggregates,
  recommendation: {
    action: candidateAction,
    policyVersion: candidate.version,
    status: "eligible_for_human_review",
  },
  authorization: {
    requiredRole: context.authority.requiredRole,
    status: "not_authorized",
  },
};

console.log(JSON.stringify(result, null, 2));
