import assert from "node:assert/strict";
import { compileOntologyPackSet } from "../../packages/core/dist/compiler.js";
import {
  compileGraphFunction, executeGraphFunction, computeReasoningGraphHash,
  evaluateGraphFunction, computeGraphEvaluationSuiteHash,
} from "../../packages/core/dist/reasoning.js";
import { ontology, makeFunction, makeGraph, makeSuite } from "./fixtures.mjs";

const resolution = compileOntologyPackSet(ontology);
assert.equal(resolution.status, "valid", JSON.stringify(resolution.diagnostics));
const hash = resolution.resolutionHash;
const candidate = compileGraphFunction({ definition: makeFunction(hash), ontology });
const baseline = compileGraphFunction({ definition: makeFunction(hash, { omitCapacity: true }), ontology });
const graph = makeGraph(hash);
const result = executeGraphFunction({
  compiled: candidate, graph, arguments: { jobId: "job-1" },
  context: { graphKey: graph.graphKey, asOf: graph.asOf, expectedSnapshotHash: computeReasoningGraphHash(graph) },
});
assert.equal(result.status, "complete");
assert.equal(result.value.length, 1);
assert.equal(result.value[0].crewId, "crew-a");
assert.equal(result.authorization, "not_authorized");
const suite = makeSuite(hash);
const evaluation = evaluateGraphFunction({
  candidate, baseline, suite, expectedSuiteHash: computeGraphEvaluationSuiteHash(suite),
});
assert.equal(evaluation.status, "passed", JSON.stringify(evaluation));
assert.equal(evaluation.candidate.hardConstraintViolations, 0);
assert.ok(evaluation.baseline.hardConstraintViolations > 0);

const incompleteOntology = structuredClone(ontology);
incompleteOntology.manifests[0].objectTypes.find((item) => item.id === "crew").properties =
  incompleteOntology.manifests[0].objectTypes.find((item) => item.id === "crew").properties
    .filter((property) => property.id !== "available");
const incompleteResolution = compileOntologyPackSet(incompleteOntology);
assert.equal(incompleteResolution.status, "valid");
let schemaFailure;
try {
  compileGraphFunction({ definition: makeFunction(incompleteResolution.resolutionHash), ontology: incompleteOntology });
} catch (error) {
  schemaFailure = { code: error.code, message: error.message };
}
assert.equal(schemaFailure?.code, "unknown_property");

console.log(JSON.stringify({
  experiment: "Harborlight typed graph functions",
  scope: "Synthetic correctness and failure detection; no production benefit claim.",
  authoring: "Both functions are hand-authored. The baseline deliberately omits capacity filtering.",
  schemaFailure,
  result,
  evaluation,
}, null, 2));
