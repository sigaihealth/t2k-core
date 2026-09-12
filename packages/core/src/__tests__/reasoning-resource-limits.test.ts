import { afterEach, describe, expect, it, vi } from "vitest";
import { compileOntologyPackSet, semanticHash } from "../compiler.js";
import * as runtime from "../reasoning-runtime.js";
import {
  compileGraphFunction, computeGraphEvaluationSuiteHash, evaluateGraphFunction, generateGraphFunction,
  graphGenerationInstructions, preflightGraphEvaluationSuite, prepareGraphGenerationContract,
  GraphFunctionError, GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS, GRAPH_GENERATION_INSTRUCTIONS,
  GRAPH_GENERATION_EXACT_EVIDENCE_INSTRUCTIONS, GRAPH_GENERATION_RESOURCE_LIMIT_INSTRUCTIONS,
  type GraphEvaluationCase, type GraphEvaluationResourceLimitError, type GraphEvaluationSuite,
  type GraphFunctionDefinition, type GraphGenerationContract, type GraphGenerationRequest, type ReasoningGraphSnapshot,
} from "../reasoning.js";
import { ontology, makeFunction, refs } from "../../../../examples/harborlight-reasoning/fixtures.mjs";

const hash = compileOntologyPackSet(ontology).resolutionHash;
const emptyEvidence = () => ({ supportingClaimIds: [], consideredClaimIds: [], exclusions: [], rows: [] });
function program(limits = { maxRows: 3, maxWork: 100 }): GraphFunctionDefinition {
  return { ...makeFunction(hash), output: { kind: "rows", fields: { memberId: "string" } }, limits,
    steps: [
      { id: "members", op: "lookup", typeRef: refs.crew, as: "member" },
      { id: "result", op: "project", from: "members", fields: { memberId: { entity: "member" } } },
    ], return: "result" };
}
function graph(members: number, claims = 0): ReasoningGraphSnapshot {
  return { snapshotVersion: "t2k.reasoning-graph.v1", graphKey: "synthetic.resource-boundaries",
    ontologyResolutionHash: hash, asOf: "2026-09-12T12:00:00.000Z", coverage: "complete",
    entities: Array.from({ length: members }, (_, i) => ({ entityId: `member-${i + 1}`, typeRef: refs.crew })),
    claims: Array.from({ length: claims }, (_, i) => ({ claimId: `availability-${i + 1}`, revision: "1", subjectId: "member-1",
      predicateRef: refs.crew + ".available", value: true, status: "accepted", polarity: "positive",
      observedAt: "2026-09-12T12:00:00.000Z", evidence: [{ sourceRef: "synthetic://resource-boundaries/ledger", locator: `entry-${i + 1}` }] })),
  };
}
function normalCase(caseId: string, members: number): GraphEvaluationCase {
  return { caseId, graph: graph(members), arguments: { jobId: "member-1" },
    expected: { status: "complete", value: Array.from({ length: members }, (_, i) => ({ memberId: `member-${i + 1}` })), evidence: emptyEvidence() }, forbiddenRows: [] };
}
function resourceCase(caseId: string, members: number, errorCode: GraphEvaluationResourceLimitError, claims = 0): GraphEvaluationCase {
  return { caseId, graph: graph(members, claims), arguments: { jobId: "member-1" },
    expected: { status: "resource_limit", errorCode, value: null, evidence: emptyEvidence() }, forbiddenRows: [] };
}
function suite(cases: GraphEvaluationCase[]): GraphEvaluationSuite {
  return { suiteVersion: "t2k.graph-evaluation.v2", suiteId: "synthetic.resource-boundaries", revision: "1",
    thresholds: { minimumCases: cases.length, minimumAccuracy: 1, minimumImprovement: 0 }, trainingCases: [], cases };
}
function contract(value: GraphEvaluationSuite, definition = program()): GraphGenerationContract {
  const { steps: _steps, return: _return, ...template } = definition;
  return { task: "Return every member ID within the pinned resource budgets. Preserve every reviewed outcome.",
    ontology, template, trainingCases: value.cases, maximumAttempts: 2 };
}
function evaluate(value: GraphEvaluationSuite, definition = program(), includeDiagnostics = false) {
  return evaluateGraphFunction({ candidate: compileGraphFunction({ definition, ontology }), suite: value,
    expectedSuiteHash: computeGraphEvaluationSuiteHash(value), includeDiagnostics });
}
afterEach(() => vi.restoreAllMocks());

describe("reviewed resource-limit evaluation", () => {
  it("advertises only the two immutable expected errors", () => {
    expect(GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS).toEqual(["row_limit", "work_limit"]);
    expect(Object.isFrozen(GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS)).toBe(true);
    expect(() => (GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS as unknown as string[]).push("invalid_contract")).toThrow(TypeError);
    expect(() => { (GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS as unknown as string[])[0] = "invalid_contract"; }).toThrow(TypeError);
  });

  it("passes ordinary cases below and at the row budget, and a labelled abort above it", () => {
    const value = suite([normalCase("below", 2), normalCase("equal", 3), resourceCase("above", 4, "row_limit")]);
    const result = evaluate(value);
    expect(result.status).toBe("passed");
    expect(result.candidate).toMatchObject({ passedCases: 3, accuracy: 1, failures: [], hardConstraintViolations: 0 });
    expect(result.candidate.runs.find(run => run.caseId === "above")).toEqual({ caseId: "above", passed: true,
      resultHash: null, expectedError: "row_limit", actualError: "row_limit" });
    for (const run of result.candidate.runs.filter(run => run.caseId !== "above")) {
      expect(Object.keys(run).sort()).toEqual(["caseId", "passed", "resultHash"]);
      expect(run.resultHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(result.authorization).toBe("not_authorized");
  });

  it("passes below and exactly at the work budget, then matches exhaustion above it", () => {
    // Lookup and entity projection cost two steps plus three units per member: 8, 11, 14.
    const definition = program({ maxRows: 10, maxWork: 11 });
    const value = suite([normalCase("below", 2), normalCase("equal", 3), resourceCase("above", 4, "work_limit")]);
    expect(evaluate(value, definition).candidate.runs).toEqual([
      { caseId: "above", passed: true, resultHash: null, expectedError: "work_limit", actualError: "work_limit" },
      { caseId: "below", passed: true, resultHash: expect.any(String) },
      { caseId: "equal", passed: true, resultHash: expect.any(String) },
    ]);
    const item = value.cases[1];
    expect(runtime.executeGraphFunction({ compiled: compileGraphFunction({ definition, ontology }), graph: item.graph,
      arguments: item.arguments, context: { graphKey: item.graph.graphKey, asOf: item.graph.asOf } }).work).toBe(11);
  });

  it.each([9, 10, 11])("allows labelled work exhaustion with %i claims around a ten-unit indexing budget", claims => {
    const value = suite([resourceCase("indexing", 1, "work_limit", claims)]);
    const definition = program({ maxRows: 3, maxWork: 10 });
    expect(evaluate(value, definition).candidate.runs[0]).toEqual({ caseId: "indexing", passed: true,
      resultHash: null, expectedError: "work_limit", actualError: "work_limit" });
    if (claims >= 10) {
      value.cases[0].expected = { status: "needs_review", value: null, evidence: emptyEvidence() };
      expect(() => evaluate(value, definition)).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
      value.cases[0].expected = { status: "resource_limit", errorCode: "row_limit", value: null, evidence: emptyEvidence() };
      expect(() => evaluate(value, definition)).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
    }
  });

  it("validates indexing-heavy training fingerprints without executing or granting them expected-error outcomes", () => {
    const value = suite([normalCase("final", 1)]), definition = program({ maxRows: 3, maxWork: 4 });
    // With zero final claims, this final target still costs five units and therefore fails normally.
    value.trainingCases = [{ caseId: "development-metadata", graph: graph(1, 4), arguments: { jobId: "member-1" } }];
    const preflight = preflightGraphEvaluationSuite({ ontology, template: contract(value, definition).template, suite: value });
    expect(preflight.trainingCases[0].graph.claims).toHaveLength(4);
    expect(evaluate(value, definition).candidate.runs[0]).toEqual({ caseId: "final", passed: false, resultHash: null });
    const independentFinal = suite([normalCase("empty-final", 0)]);
    independentFinal.trainingCases = value.trainingCases;
    expect(evaluate(independentFinal, definition).status).toBe("passed");
    const labelledDevelopment = suite([resourceCase("development-labelled", 1, "work_limit", 4)]);
    expect(evaluate(labelledDevelopment, definition).status).toBe("passed");
    expect(prepareGraphGenerationContract(contract(labelledDevelopment, definition)).trainingCases[0].expected.status).toBe("resource_limit");
    const invalid = structuredClone(independentFinal);
    invalid.trainingCases[0].graph.claims[0].value = "wrong-type";
    expect(() => evaluate(invalid, definition)).toThrow();
    const overlap = structuredClone(independentFinal);
    overlap.trainingCases[0] = { ...overlap.cases[0], caseId: "different-id" };
    delete (overlap.trainingCases[0] as any).expected; delete (overlap.trainingCases[0] as any).forbiddenRows;
    expect(() => evaluate(overlap, definition)).toThrowError(expect.objectContaining({ code: "overlapping_cases" }));
  });

  it("exhausts the incoming duplicate paths before distinct could reduce them", () => {
    const definition = program({ maxRows: 3, maxWork: 1000 });
    definition.steps = [...makeFunction(hash).steps.slice(0, 3),
      { id: "unique", op: "distinct", from: "crews", binding: "crew" },
      { id: "result", op: "project", from: "unique", fields: { memberId: { entity: "crew" } } }];
    const item = resourceCase("duplicate-paths", 2, "row_limit");
    item.graph.entities.push({ entityId: "request", typeRef: refs.job },
      { entityId: "route-a", typeRef: refs.route }, { entityId: "route-b", typeRef: refs.route });
    item.arguments.jobId = "request";
    const edges = [
      ["request", refs.jobRoute, "route-a"], ["request", refs.jobRoute, "route-b"],
      ["route-a", refs.routeCrew, "member-1"], ["route-a", refs.routeCrew, "member-2"],
      ["route-b", refs.routeCrew, "member-1"], ["route-b", refs.routeCrew, "member-2"],
    ];
    item.graph.claims = edges.map(([subjectId, predicateRef, objectId], i) => ({ claimId: `edge-${i}`, revision: "1",
      subjectId, predicateRef, objectId, status: "accepted", polarity: "positive", observedAt: item.graph.asOf,
      evidence: [{ sourceRef: "synthetic://resource-boundaries/paths", locator: `edge-${i}` }] }));
    expect(evaluate(suite([item]), definition).status).toBe("passed");
    const enoughRoom = { ...definition, limits: { ...definition.limits, maxRows: 4 } };
    const actual = runtime.executeGraphFunction({ compiled: compileGraphFunction({ definition: enoughRoom, ontology }), graph: item.graph,
      arguments: item.arguments, context: { graphKey: item.graph.graphKey, asOf: item.graph.asOf } });
    expect(actual.value).toEqual([{ memberId: "member-1" }, { memberId: "member-2" }]);
    expect(actual.trace.find(step => step.operator === "distinct")).toMatchObject({ inputRows: 4, outputRows: 2 });
  });

  it.each(["complete", "needs_review"] as const)("fails a resource label when execution returns %s with a real receipt", status => {
    const value = suite([resourceCase("ordinary-return", 1, "row_limit")]);
    if (status === "needs_review") value.cases[0].graph.coverage = "partial";
    const result = evaluate(value, program(), true);
    expect(result.status).toBe("failed");
    expect(result.candidate.runs[0]).toEqual({ caseId: "ordinary-return", passed: false,
      resultHash: expect.any(String), expectedError: "row_limit", actualError: null });
    expect(result.candidate.failures[0]).toMatchObject({ category: "execution", expectedError: "row_limit", actualError: null,
      reasons: [`Expected row_limit, but execution returned ${status}.`], result: { status },
      diagnostics: [{ code: "resource_limit_mismatch", details: { expectedError: "row_limit", actualError: null, actualStatus: status } }] });
  });

  it("rejects a different typed error and exposes the actual code without a fabricated receipt", () => {
    const result = evaluate(suite([resourceCase("wrong-limit", 4, "row_limit")]), program({ maxRows: 10, maxWork: 11 }), true);
    expect(result.status).toBe("failed");
    expect(result.candidate.runs[0]).toEqual({ caseId: "wrong-limit", passed: false, resultHash: null,
      expectedError: "row_limit", actualError: "work_limit" });
    expect(result.candidate.failures[0]).toMatchObject({ resultHash: null, result: null, issues: [],
      diagnostics: [{ code: "resource_limit_mismatch", details: { expectedError: "row_limit", actualError: "work_limit", actualStatus: null } }] });
  });

  it.each([
    ["other graph error", new GraphFunctionError("invalid_contract", "Invalid fixture"), "invalid_contract"],
    ["untyped error with a matching code", Object.assign(new Error("private error text"), { code: "row_limit" }), "execution_failed"],
    ["plain matching error object", { code: "row_limit" }, "execution_failed"],
  ])("does not convert %s into a passing safety outcome", (_name, thrown, actualError) => {
    vi.spyOn(runtime, "executeGraphFunction").mockImplementationOnce(() => { throw thrown; });
    const result = evaluate(suite([resourceCase("unexpected-error", 1, "row_limit")]), program(), true);
    expect(result.status).toBe("failed");
    expect(result.candidate.runs[0]).toMatchObject({ passed: false, expectedError: "row_limit", actualError, resultHash: null });
    expect(result.candidate.failures[0].diagnostics).toEqual([expect.objectContaining({
      code: "execution_failed", category: "data", action: "review_contract", details: { expectedError: "row_limit", actualError, actualStatus: null },
    })]);
    expect(JSON.stringify(result)).not.toContain("private error text");
  });

  it.each([
    new GraphFunctionError("invalid_graph", "Invalid graph"),
    new GraphFunctionError("invalid_arguments", "Invalid arguments"),
    new Error("Untyped execution failure"),
  ])("stops resource-case generation for review after an unrelated execution error", async thrown => {
    const definition = program(), value = suite([resourceCase("requires-review", 4, "row_limit")]);
    const original = structuredClone(value), provider = vi.fn(async (_request: Readonly<GraphGenerationRequest>) => ({ steps: definition.steps, return: definition.return }));
    vi.spyOn(runtime, "executeGraphFunction").mockImplementationOnce(() => { throw thrown; });
    const result = await generateGraphFunction(contract(value, definition), provider);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "exhausted", definition: null, functionHash: null });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].status).toBe("training_failed");
    expect(result.attempts[0].diagnostics?.samples).toContainEqual(expect.objectContaining({ code: "execution_failed", action: "review_contract" }));
    expect(provider.mock.calls[0][0].template.limits).toEqual(definition.limits);
    expect(Object.isFrozen(provider.mock.calls[0][0].template.limits)).toBe(true);
    expect(value).toEqual(original);
    expect(definition.limits).toEqual({ maxRows: 3, maxWork: 100 });
  });

  it("preserves legacy unexpected-error run and failure shapes for normal labels", () => {
    const item = normalCase("unexpected-limit", 4); item.expected.value = [];
    const result = evaluate(suite([item]), program(), true);
    expect(result.status).toBe("failed");
    expect(result.candidate.runs).toEqual([{ caseId: "unexpected-limit", passed: false, resultHash: null }]);
    expect(result.candidate.failures[0]).not.toHaveProperty("expectedError");
    expect(result.candidate.failures[0]).not.toHaveProperty("actualError");
    expect(result.candidate.failures[0].diagnostics).toEqual([expect.objectContaining({ code: "execution_failed" })]);
  });

  it("binds expected error codes to the suite and generation contract hashes without mutating caller labels", () => {
    const value = suite([resourceCase("frozen", 4, "row_limit")]), original = structuredClone(value);
    const before = computeGraphEvaluationSuiteHash(value), prepared = prepareGraphGenerationContract(contract(value));
    expect(prepared.trainingCases[0].expected).toEqual(original.cases[0].expected);
    expect(Object.isFrozen(prepared.trainingCases[0].expected)).toBe(true);
    value.cases[0].expected = { ...value.cases[0].expected, status: "resource_limit", errorCode: "work_limit", value: null };
    expect(computeGraphEvaluationSuiteHash(value)).not.toBe(before);
    expect(semanticHash(prepareGraphGenerationContract(contract(value)))).not.toBe(semanticHash(prepared));
    expect(() => evaluateGraphFunction({ candidate: compileGraphFunction({ definition: program(), ontology }),
      suite: value, expectedSuiteHash: before })).toThrowError(expect.objectContaining({ code: "evaluation_contract_mismatch" }));
  });

  it.each([
    ["missing error code", (item: any) => { delete item.expected.errorCode; }],
    ["unknown error code", (item: any) => { item.expected.errorCode = "invalid_contract"; }],
    ["non-null value", (item: any) => { item.expected.value = 0; }],
    ["supporting evidence", (item: any) => { item.expected.evidence.supportingClaimIds = ["claim"]; }],
    ["considered evidence", (item: any) => { item.expected.evidence.consideredClaimIds = ["claim"]; }],
    ["row evidence", (item: any) => { item.expected.evidence.rows = [{ row: { memberId: "member-1" }, claimIds: [] }]; }],
    ["exclusion evidence", (item: any) => { item.expected.evidence.exclusions = [{ entityIds: ["member-1"], claimIds: [] }]; }],
    ["forbidden row", (item: any) => { item.forbiddenRows = [{ memberId: "member-1" }]; }],
    ["claim-set matching", (item: any) => { item.expected.evidence.claimSetMatching = { supporting: "exact" }; }],
    ["normal status plus error", (item: any) => { item.expected.status = "needs_review"; }],
    ["completed status plus error", (item: any) => { item.expected.status = "complete"; item.expected.value = []; }],
    ["case budget override", (item: any) => { item.limits = { maxRows: 2, maxWork: 2 }; }],
    ["mistyped graph data", (item: any) => { item.graph.claims = graph(1, 1).claims; item.graph.claims[0].value = "not-boolean"; }],
    ["wrong argument type", (item: any) => { item.arguments.jobId = 1; }],
  ] as const)("rejects %s before a model call", async (_name, mutate) => {
    const value = suite([resourceCase("invalid-label", 4, "row_limit")]); mutate(value.cases[0]);
    const provider = vi.fn(async () => ({}));
    await expect(generateGraphFunction(contract(value), provider)).rejects.toBeInstanceOf(GraphFunctionError);
    expect(provider).not.toHaveBeenCalled();
  });

  it("adds resource guidance only for opted-in development and retains frozen labels through repair", async () => {
    const definition = program({ maxRows: 10, maxWork: 11 });
    const value = suite([normalCase("ordinary", 2), resourceCase("budget", 4, "work_limit")]);
    const original = structuredClone(value), prepared = prepareGraphGenerationContract(contract(value, definition));
    expect(graphGenerationInstructions()).toBe(GRAPH_GENERATION_INSTRUCTIONS);
    expect(graphGenerationInstructions(undefined, [normalCase("normal-only", 1)])).toBe(GRAPH_GENERATION_INSTRUCTIONS);
    const exact = normalCase("exact", 1); exact.expected.evidence.claimSetMatching = { considered: "exact" };
    expect(graphGenerationInstructions(undefined, [exact])).toBe(GRAPH_GENERATION_INSTRUCTIONS + "\n" + GRAPH_GENERATION_EXACT_EVIDENCE_INSTRUCTIONS);
    const requests: Readonly<GraphGenerationRequest>[] = [];
    const result = await generateGraphFunction(contract(value, definition), async request => {
      requests.push(request);
      const steps = structuredClone(definition.steps);
      if (request.attempt === 1) (steps[0] as any).entityId = { argument: "jobId" };
      return { steps, return: definition.return };
    });
    expect(result.attempts.map(attempt => attempt.status)).toEqual(["training_failed", "ready"]);
    expect(result.definition?.limits).toEqual(definition.limits);
    for (const request of requests) {
      expect(request.instructions).toBe(GRAPH_GENERATION_INSTRUCTIONS + "\n" + GRAPH_GENERATION_RESOURCE_LIMIT_INSTRUCTIONS);
      expect(request.trainingCases).toEqual(prepared.trainingCases);
      expect(Object.isFrozen(request.template.limits)).toBe(true);
      if (request.attempt === 2) expect(request.diagnostics?.samples).toContainEqual(expect.objectContaining({
        code: "resource_limit_mismatch", details: { expectedError: "work_limit", actualError: null, actualStatus: "complete" },
      }));
    }
    expect(value).toEqual(original);
  });
});
