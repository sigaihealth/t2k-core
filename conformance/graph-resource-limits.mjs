import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileOntologyPackSet } from "../packages/core/dist/compiler.js";
import {
  compileGraphFunction, computeGraphEvaluationSuiteHash, evaluateGraphFunction,
  preflightGraphEvaluationSuite, GraphFunctionError, GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS,
} from "../packages/core/dist/reasoning.js";

/** Public data vectors exercise the built API, independently of the unit-test runner. */
export async function verifyGraphResourceLimitVectors() {
  const vectors = JSON.parse(await fs.readFile(new URL("./vectors/graph-resource-limits-v1.json", import.meta.url), "utf8"));
  assert.equal(vectors.vectorType, "t2k.graph-resource-limit-conformance.v1");
  assert.deepEqual(GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS, ["row_limit", "work_limit"]);
  assert.ok(Object.isFrozen(GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS));
  const manifest = JSON.parse(await fs.readFile(new URL("../" + vectors.ontologyFixture, import.meta.url), "utf8"));
  const ontology = { manifests: [manifest], roots: [{ ontologyId: manifest.ontologyId, version: manifest.ontologyVersion }], mode: "deployment" };
  const ontologyResolutionHash = compileOntologyPackSet(ontology).resolutionHash;
  for (const vector of vectors.cases) {
    const definition = { artifactVersion: "t2k.graph-function.v1",
      functionRef: "harborlight.reasoning:reasoning_function:find_feasible_dispatch_options",
      ontologyResolutionHash, ...structuredClone(vectors.program), limits: vector.limits };
    const graph = { snapshotVersion: "t2k.reasoning-graph.v1", graphKey: "synthetic.resource-conformance",
      ontologyResolutionHash, asOf: "2026-09-12T12:00:00.000Z", coverage: "complete",
      entities: Array.from({ length: vector.members }, (_, i) => ({ entityId: `member-${i + 1}`, typeRef: "harborlight.reasoning:crew" })),
      claims: Array.from({ length: vector.claims }, (_, i) => ({ claimId: `claim-${i + 1}`, revision: "1", subjectId: "member-1",
        predicateRef: "harborlight.reasoning:crew.available", value: true, status: "accepted", polarity: "positive",
        observedAt: "2026-09-12T12:00:00.000Z", evidence: [{ sourceRef: "synthetic://resource-conformance/ledger", locator: `entry-${i + 1}` }] })),
    };
    const suite = { suiteVersion: "t2k.graph-evaluation.v2", suiteId: "conformance." + vector.name, revision: "1",
      thresholds: { minimumCases: 1, minimumAccuracy: 1, minimumImprovement: 0 }, trainingCases: [],
      cases: [{ caseId: vector.name, graph, arguments: { jobId: "member-1" },
        expected: { ...vector.expected, evidence: structuredClone(vectors.emptyEvidence) }, forbiddenRows: [] }],
    };
    const { steps: _steps, return: _return, ...template } = definition;
    if (vector.preflightError) {
      assert.throws(() => preflightGraphEvaluationSuite({ ontology, template, suite }),
        error => error instanceof GraphFunctionError && error.code === vector.preflightError, vector.name);
      continue;
    }
    const result = evaluateGraphFunction({ candidate: compileGraphFunction({ ontology, definition }), suite,
      expectedSuiteHash: computeGraphEvaluationSuiteHash(suite) });
    assert.equal(result.status, vector.evaluationStatus, vector.name);
    const [run] = result.candidate.runs;
    assert.equal(run.passed, vector.evaluationStatus === "passed", vector.name);
    if (vector.expected.status === "resource_limit") {
      assert.equal(run.expectedError, vector.expected.errorCode, vector.name);
      assert.equal(run.actualError, vector.actualError, vector.name);
    } else {
      assert.equal(Object.hasOwn(run, "expectedError"), false, vector.name);
      assert.equal(Object.hasOwn(run, "actualError"), false, vector.name);
    }
    assert.equal(typeof run.resultHash === "string", vector.hasResult, vector.name);
    if (!vector.hasResult) assert.equal(run.resultHash, null, vector.name);
  }
  return vectors.cases.length;
}
