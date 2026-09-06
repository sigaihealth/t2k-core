import { describe, expect, it } from "vitest";
import { compileOntologyPackSet, semanticHash } from "../compiler.js";
import {
  compileGraphFunction, computeGraphEvaluationSuiteHash, computeReasoningGraphHash,
  evaluateGraphFunction, executeGraphFunction, GraphFunctionError, preflightGraphEvaluationSuite,
} from "../reasoning.js";
import type { GraphFunctionDefinition, ReasoningGraphSnapshot } from "../reasoning.js";
import {
  ontology, makeFunction, makeGraph, makeSuite, refs,
} from "../../../../examples/harborlight-reasoning/fixtures.mjs";

const resolution = compileOntologyPackSet(ontology);
const hash = resolution.resolutionHash;
const compile = (definition: unknown = makeFunction(hash)) => compileGraphFunction({ definition, ontology });
const run = (graph: ReasoningGraphSnapshot = makeGraph(hash), definition = makeFunction(hash)) =>
  executeGraphFunction({
    compiled: compile(definition), graph, arguments: { jobId: "job-1" },
    context: { graphKey: graph.graphKey, asOf: graph.asOf, expectedSnapshotHash: computeReasoningGraphHash(graph) },
  });
const capture = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error as GraphFunctionError; }
  throw new Error("Expected a rejected contract.");
};

describe("typed graph function compilation", () => {
  it("compiles a function against an actual accepted ontology resolution", () => {
    expect(resolution.status).toBe("valid");
    const compiled = compile();
    expect(compiled.ontologyResolutionHash).toBe(hash);
    expect(compiled.functionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(compiled.definition.steps)).toBe(true);
  });

  it("defaults to accepted-only compilation and requires explicit authoring mode for drafts", () => {
    const draft = structuredClone(ontology);
    draft.manifests[0].status = "draft";
    delete (draft as any).mode;
    const draftResolution = compileOntologyPackSet({ ...draft, mode: "authoring" });
    expect(capture(() => compileGraphFunction({ definition: makeFunction(draftResolution.resolutionHash), ontology: draft })).code)
      .toBe("invalid_ontology");
    expect(compileGraphFunction({ definition: makeFunction(draftResolution.resolutionHash), ontology: { ...draft, mode: "authoring" } }))
      .toHaveProperty("functionHash");
  });

  it("distinguishes a missing schema concept from a program type error", () => {
    const broken = structuredClone(ontology);
    const crew = broken.manifests[0].objectTypes.find((item: any) => item.id === "crew")!;
    crew.properties = crew.properties.filter((property: any) => property.id !== "available");
    const next = compileOntologyPackSet(broken);
    expect(next.status).toBe("valid");
    expect(capture(() => compileGraphFunction({ definition: makeFunction(next.resolutionHash), ontology: broken })).code)
      .toBe("unknown_property");
    const badType = makeFunction(hash);
    badType.steps[3].all[2].right = { literal: "three hours" };
    expect(capture(() => compile(badType)).code).toBe("type_mismatch");
  });

  it.each([
    ["ontology_mismatch", (definition: any) => { definition.ontologyResolutionHash = "0".repeat(64); }],
    ["unknown_function", (definition: any) => { definition.functionRef = "unknown:function"; }],
    ["unsupported_operator", (definition: any) => { definition.steps[1].op = "execute_code"; }],
    ["invalid_contract", (definition: any) => { definition.steps[0].sql = "SELECT *"; }],
    ["unknown_step", (definition: any) => { definition.steps[1].from = "options"; }],
    ["unknown_relation", (definition: any) => { definition.steps[1].relation = "unknown:relation"; }],
    ["unknown_argument", (definition: any) => { definition.steps[0].entityId = { argument: "undeclared" }; }],
    ["type_mismatch", (definition: any) => { definition.output.fields.capacityHours = "boolean"; }],
    ["unused_step", (definition: any) => { definition.steps.unshift({ id: "unused", op: "lookup", typeRef: refs.crew, as: "extra" }); }],
  ])("rejects %s before a program can execute", (code, mutate) => {
    const definition = makeFunction(hash);
    mutate(definition);
    expect(capture(() => compile(definition)).code).toBe(code);
  });

  it("rejects forged compiled objects and never invokes source accessors", () => {
    const compiled = compile();
    expect(capture(() => executeGraphFunction({
      compiled: { ...compiled }, graph: makeGraph(hash), arguments: {}, context: { graphKey: "x", asOf: "x" },
    })).code).toBe("uncompiled_function");
    let invoked = false;
    const graph = makeGraph(hash);
    Object.defineProperty(graph.claims[0], "value", { enumerable: true, get() { invoked = true; return 3; } });
    expect(capture(() => run(graph)).code).toBe("invalid_json");
    expect(invoked).toBe(false);
  });
});

describe("evidence-bearing graph execution", () => {
  it("returns only the feasible option with its evidence and exclusions", () => {
    const result = run();
    expect(result).toMatchObject({
      status: "complete", authorization: "not_authorized",
      value: [{ jobId: "job-1", routeId: "route-a", crewId: "crew-a", capacityHours: 4 }],
    });
    expect(result.supportingClaimIds).toEqual(expect.arrayContaining(["crew-a.available", "crew-a.capacity_hours", "job-1.route-a"]));
    expect(result.supportingClaimIds).not.toContain("crew-b.capacity_hours");
    expect(result.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ bindings: expect.objectContaining({ crew: "crew-b" }) }),
      expect.objectContaining({ bindings: expect.objectContaining({ crew: "crew-c" }) }),
    ]));
    expect(result.derivations[0].rowHash).toBe(semanticHash((result.value as unknown[])[0]));
    expect(result.trace.every((step) => /^[a-f0-9]{64}$/.test(step.outputHash))).toBe(true);
    const { resultHash, ...body } = result;
    expect(resultHash).toBe(semanticHash(body));
  });

  it("is invariant to input ordering and preserves caller input", () => {
    const graph = makeGraph(hash);
    const original = structuredClone(graph);
    const first = run(graph);
    graph.entities.reverse();
    graph.claims.reverse();
    graph.claims.forEach((claim: any) => claim.evidence.reverse());
    expect(run(graph)).toEqual(first);
    expect(original.claims[0].observedAt).toBe("2026-09-05T11:45:00Z");
    expect(run(original)).toEqual(first);
  });

  it("keeps ignored claims in the audit trail without treating them as supporting evidence", () => {
    const graph = makeGraph(hash);
    const accepted = graph.claims.find((claim: any) => claim.claimId === "crew-a.capacity_hours")!;
    const ignored = [
      { ...structuredClone(accepted), claimId: "proposed-capacity", status: "proposed", value: 200 },
      { ...structuredClone(accepted), claimId: "stale-capacity", observedAt: "2026-08-01T11:45:00Z", value: 200 },
      { ...structuredClone(accepted), claimId: "retracted-capacity", status: "retracted", value: 200 },
    ];
    graph.claims.push(...ignored);
    const result = run(graph);
    expect(result.value).toEqual(run().value);
    for (const claim of ignored) {
      expect(result.evidence.some((entry) => entry.claimId === claim.claimId)).toBe(true);
      expect(result.supportingClaimIds).not.toContain(claim.claimId);
      expect(result.derivations[0].claimIds).not.toContain(claim.claimId);
      expect(result.trace.find((step) => step.operator === "project")!.claimIds).toContain(claim.claimId);
    }
  });

  it.each([
    ["missing_availability", "missing_accepted_evidence"],
    ["proposed_availability", "missing_accepted_evidence"],
    ["negative_availability", "missing_accepted_evidence"],
    ["stale_availability", "stale_evidence"],
    ["missing_locator", "missing_locator"],
    ["conflicting_capacity", "conflicting_evidence"],
    ["partial_view", "incomplete_view"],
  ])("keeps %s unresolved", (variant, code) => {
    const result = run(makeGraph(hash, variant));
    expect(result).toMatchObject({ status: "needs_review", value: null, supportingClaimIds: [] });
    expect(result.issues.some((issue) => issue.code === code)).toBe(true);
  });

  it("does not convert an explicit false or empty complete view into missing data", () => {
    expect(run(makeGraph(hash, "unavailable"))).toMatchObject({ status: "complete", value: [] });
    expect(run(makeGraph(hash, "empty_routes"))).toMatchObject({ status: "complete", value: [] });
    const graph = makeGraph(hash);
    graph.claims = graph.claims.filter((claim: any) => claim.claimId !== "crew-c.capacity_hours");
    // Crew C is definitively unavailable; another missing constraint cannot make it feasible.
    expect(run(graph).status).toBe("complete");
  });

  it("treats source instructions as inert text", () => {
    const result = run(makeGraph(hash, "source_instruction"));
    expect(result.value).toEqual(run().value);
    expect(result.authorization).toBe("not_authorized");
    expect(result.trace.map((step) => step.operator)).not.toContain("execute_code");
  });

  it("preserves relation evidence, blocks contradictory edges, and deduplicates repeated evidence", () => {
    const graph = makeGraph(hash);
    const relation = graph.claims.find((claim: any) => claim.claimId === "job-1.route-a")!;
    graph.claims.push({ ...structuredClone(relation), claimId: "route-a-second-source" });
    expect((run(graph).value as unknown[]).length).toBe(1);
    expect(run(graph).supportingClaimIds).toContain("route-a-second-source");
    graph.claims.push({ ...structuredClone(relation), claimId: "route-a-denied", polarity: "negative" });
    expect(run(graph)).toMatchObject({ status: "needs_review", value: null });
  });

  it("rejects cross-graph, version, time, hash, and argument mismatches", () => {
    const compiled = compile();
    const graph = makeGraph(hash);
    const input = {
      compiled, graph, arguments: { jobId: "job-1" },
      context: { graphKey: graph.graphKey, asOf: graph.asOf, expectedSnapshotHash: computeReasoningGraphHash(graph) },
    };
    expect(capture(() => executeGraphFunction({ ...input, context: { ...input.context, graphKey: "another-graph" } })).code).toBe("graph_mismatch");
    expect(capture(() => executeGraphFunction({ ...input, context: { ...input.context, asOf: "2026-09-05T13:00:00Z" } })).code).toBe("snapshot_mismatch");
    expect(capture(() => executeGraphFunction({ ...input, context: { ...input.context, expectedSnapshotHash: "0".repeat(64) } })).code).toBe("snapshot_mismatch");
    expect(capture(() => executeGraphFunction({ ...input, arguments: { jobId: 42 } })).code).toBe("type_mismatch");
    expect(capture(() => executeGraphFunction({ ...input, arguments: { jobId: "job-1", role: "admin" } })).code).toBe("invalid_contract");
    expect(capture(() => run({ ...graph, ontologyResolutionHash: "0".repeat(64) })).code).toBe("ontology_mismatch");
    expect(capture(() => run({ ...graph, asOf: "2026-02-30T12:00:00Z" })).code).toBe("invalid_timestamp");
  });

  it("rejects malformed graph types and duplicate revisions", () => {
    const graph = makeGraph(hash);
    graph.claims[0].value = "not a number";
    expect(capture(() => run(graph)).code).toBe("type_mismatch");
    const duplicated = makeGraph(hash);
    duplicated.claims.push({ ...duplicated.claims[0], revision: "2" });
    expect(capture(() => run(duplicated)).code).toBe("duplicate_claim");
  });

  it("enforces relationship cardinality on accepted snapshot claims", () => {
    const strict = structuredClone(ontology);
    strict.manifests[0].structuralRelationships[0].cardinality = "many_to_one";
    const strictHash = compileOntologyPackSet(strict).resolutionHash;
    const compiled = compileGraphFunction({ definition: makeFunction(strictHash), ontology: strict });
    const graph = makeGraph(strictHash);
    expect(capture(() => executeGraphFunction({ compiled, graph, arguments: { jobId: "job-1" },
      context: { graphKey: graph.graphKey, asOf: graph.asOf } })).code).toBe("cardinality_violation");
  });

  it("enforces work and row bounds during execution", () => {
    const lowWork = makeFunction(hash);
    lowWork.limits.maxWork = 2;
    expect(capture(() => run(makeGraph(hash), lowWork)).code).toBe("work_limit");
    const lowRows = makeFunction(hash);
    lowRows.limits.maxRows = 1;
    expect(capture(() => run(makeGraph(hash), lowRows)).code).toBe("row_limit");
    const oversized = makeGraph(hash);
    oversized["x".repeat(32_769)] = true;
    expect(capture(() => run(oversized)).code).toBe("input_limit");
  });

  it.each([["count", 2], ["sum", 9], ["min", 4], ["max", 5], ["mean", 4.5]])(
    "computes %s over the filtered projection", (operation, expected) => {
      const definition = makeFunction(hash) as GraphFunctionDefinition;
      definition.steps.push({
        id: "total", op: "aggregate", from: "options", operation: operation as any,
        ...(operation === "count" ? {} : { field: "capacityHours" }),
      });
      definition.return = "total";
      definition.output = { kind: "scalar", valueType: "number" };
      expect(run(makeGraph(hash, "more_capacity"), definition)).toMatchObject({ status: "complete", value: expected });
      if (operation === "count" || operation === "sum") {
        expect(run(makeGraph(hash, "empty_routes"), definition)).toMatchObject({ status: "complete", value: 0 });
      } else {
        expect(run(makeGraph(hash, "empty_routes"), definition)).toMatchObject({ status: "needs_review", value: null });
      }
    });
});

describe("computed graph task evaluation", () => {
  const candidate = compile();
  const baseline = compile(makeFunction(hash, { omitCapacity: true }));
  const evaluate = (suite = makeSuite(hash)) => evaluateGraphFunction({
    candidate, baseline, suite, expectedSuiteHash: computeGraphEvaluationSuiteHash(suite),
  });

  it("computes 15 synthetic cases and exposes the faulty baseline's hard failures", () => {
    const result = evaluate();
    expect(result).toMatchObject({
      evaluationSource: "graph_runtime", status: "passed", authorization: "not_authorized",
      candidate: { passedCases: 15, totalCases: 15, accuracy: 1, hardConstraintViolations: 0 },
      baseline: { passedCases: 10, totalCases: 15, hardConstraintViolations: 6 },
    });
    expect(result.baseline!.failures.every((failure) => /^[a-f0-9]{64}$/.test(failure.failureHash))).toBe(true);
    const suite = makeSuite(hash);
    suite.cases.reverse();
    expect(evaluate(suite)).toEqual(result);
  });

  it("rejects a modified evaluation contract and caller-supplied verdicts", () => {
    const suite = makeSuite(hash);
    const expectedSuiteHash = computeGraphEvaluationSuiteHash(suite);
    suite.thresholds.minimumAccuracy = 0.1;
    expect(capture(() => evaluateGraphFunction({ candidate, baseline, suite, expectedSuiteHash })).code).toBe("evaluation_contract_mismatch");
    expect(capture(() => evaluate({ ...makeSuite(hash), status: "passed" })).code).toBe("invalid_contract");
  });

  it("blocks training/test leakage and repeated examples under new identifiers", () => {
    const suite = makeSuite(hash);
    suite.cases[0].caseId = suite.trainingCases[0].caseId;
    expect(capture(() => evaluate(suite)).code).toBe("overlapping_cases");
    const copied = makeSuite(hash);
    copied.cases[0].graph = structuredClone(copied.trainingCases[0].graph);
    expect(capture(() => evaluate(copied)).code).toBe("overlapping_cases");
    const repeated = makeSuite(hash);
    repeated.cases.push({ ...structuredClone(repeated.cases[0]), caseId: "renamed-copy" });
    expect(capture(() => evaluate(repeated)).code).toBe("overlapping_cases");
  });

  it("fails insufficient coverage, no improvement, and hard-constraint violations", () => {
    const suite = makeSuite(hash);
    const pinned = computeGraphEvaluationSuiteHash(suite);
    expect(evaluateGraphFunction({ candidate, baseline: candidate, suite, expectedSuiteHash: pinned }).status).toBe("failed");
    expect(evaluateGraphFunction({ candidate: baseline, baseline: candidate, suite, expectedSuiteHash: pinned }).status).toBe("failed");
    suite.thresholds.minimumCases = 20;
    expect(evaluate(suite).reasons).toContain("Insufficient independent evaluation cases.");
  });

  it("requires explicitly reviewed v2 evidence roles, without upgrading ambiguous legacy labels", () => {
    const suite: any = makeSuite(hash);
    suite.suiteVersion = "t2k.graph-evaluation.v1";
    expect(capture(() => computeGraphEvaluationSuiteHash(suite)).message).toContain("legacy requiredClaimIds");
    suite.suiteVersion = "t2k.graph-evaluation.v2";
    suite.cases[0].expected.requiredClaimIds = [];
    expect(capture(() => computeGraphEvaluationSuiteHash(suite)).code).toBe("invalid_contract");
  });

  it("does not allow considered or excluded evidence to satisfy supporting or per-row assertions", () => {
    const suite = makeSuite(hash);
    const standard = suite.cases.find((item: any) => item.caseId === "test-standard")!;
    standard.expected.evidence.supportingClaimIds.push("crew-b.capacity_hours");
    standard.expected.evidence.rows[0].claimIds.push("crew-b.capacity_hours");
    const result = evaluate(suite);
    const failure = result.candidate.failures.find((item) => item.caseId === "test-standard")!;
    expect(failure.reasons).toContain("Required supporting evidence did not support the completed answer.");
    expect(failure.reasons).toContain("Required row evidence did not support its designated returned row.");
    expect(failure.reasons.some((reason) => reason.includes("exclusion evidence"))).toBe(false);
    standard.expected.evidence.supportingClaimIds.pop();
    standard.expected.evidence.rows[0].claimIds.pop();
    standard.expected.evidence.consideredClaimIds.push("crew-b.capacity_hours");
    expect(evaluate(suite).status).toBe("passed");
  });

  it("supports needs_review evidence assertions without claiming answer support", () => {
    const suite = makeSuite(hash);
    const unresolved = suite.cases.find((item: any) => item.caseId === "test-stale_availability")!;
    expect(unresolved.expected.evidence.consideredClaimIds).toEqual(["crew-a.available"]);
    expect(evaluate(suite).status).toBe("passed");
    unresolved.expected.evidence.supportingClaimIds.push("crew-a.available");
    expect(capture(() => evaluate(suite)).code).toBe("invalid_contract");
  });

  it("requires one matching row derivation and one matching exclusion instead of pooled evidence", () => {
    const suite = makeSuite(hash);
    const standard = suite.cases.find((item: any) => item.caseId === "test-standard")!;
    standard.expected.evidence.exclusions = [{ entityIds: ["crew-b"], claimIds: ["crew-c.available"] }];
    expect(evaluate(suite).candidate.failures.find((item) => item.caseId === "test-standard")!.reasons)
      .toContain("Required exclusion evidence did not establish the designated exclusion.");
    const multiple = suite.cases.find((item: any) => item.caseId === "test-more_capacity")!;
    multiple.expected.evidence.rows = [{ row: multiple.expected.value[0], claimIds: ["crew-a.available", "crew-b.available"] }];
    expect(evaluate(suite).candidate.failures.find((item) => item.caseId === "test-more_capacity")!.reasons)
      .toContain("Required row evidence did not support its designated returned row.");
  });

  it.each([
    ["training arguments", (suite: any) => { suite.trainingCases[0].arguments.jobId = 2; }, "type_mismatch"],
    ["missing final argument", (suite: any) => { suite.cases[0].arguments = {}; }, "invalid_contract"],
    ["extra final argument", (suite: any) => { suite.cases[0].arguments.extra = true; }, "invalid_contract"],
    ["invalid graph type", (suite: any) => { suite.cases[0].graph.entities[0].typeRef = "missing:type"; }, "unknown_type"],
    ["wrong graph ontology", (suite: any) => { suite.cases[0].graph.ontologyResolutionHash = "0".repeat(64); }, "ontology_mismatch"],
    ["scalar label for rows", (suite: any) => { suite.cases[0].expected.value = 3; }, "type_mismatch"],
    ["missing output field", (suite: any) => { delete suite.cases[0].expected.value[0].crewId; }, "invalid_contract"],
    ["extra output field", (suite: any) => { suite.cases[0].expected.value[0].other = true; }, "invalid_contract"],
    ["wrong output field type", (suite: any) => { suite.cases[0].expected.value[0].capacityHours = "four"; }, "type_mismatch"],
    ["unknown forbidden field", (suite: any) => { suite.cases[0].forbiddenRows = [{ typo: true }]; }, "invalid_contract"],
    ["contradictory forbidden label", (suite: any) => { suite.cases[0].forbiddenRows = [{ crewId: "crew-a" }]; }, "invalid_contract"],
    ["missing supporting reference", (suite: any) => { suite.cases[0].expected.evidence.supportingClaimIds = ["missing"]; }, "invalid_contract"],
    ["missing considered reference", (suite: any) => { suite.cases[0].expected.evidence.consideredClaimIds = ["missing"]; }, "invalid_contract"],
    ["missing exclusion entity", (suite: any) => { suite.cases[0].expected.evidence.exclusions[0].entityIds = ["missing"]; }, "invalid_contract"],
    ["non-output row assertion", (suite: any) => { suite.cases[0].expected.evidence.rows[0].row.crewId = "crew-b"; }, "invalid_contract"],
    ["stale supporting evidence", (suite: any) => { suite.cases[0].graph.claims.find((claim: any) => claim.claimId === "crew-a.available").observedAt = "2026-08-01T12:00:00Z"; }, "invalid_contract"],
  ])("preflights %s before generation or final execution", (_label, mutate, code) => {
    const suite = makeSuite(hash);
    mutate(suite);
    const { steps: _steps, return: _return, ...template } = makeFunction(hash);
    expect(capture(() => preflightGraphEvaluationSuite({ ontology, template, suite })).code).toBe(code);
    expect(capture(() => evaluate(suite)).code).toBe(code);
  });

  it("validates integer output labels against the original signature, without numeric coercion", () => {
    const suite = makeSuite(hash);
    const { steps: _steps, return: _return, ...template } = makeFunction(hash);
    template.output.fields.capacityHours = "integer";
    expect(preflightGraphEvaluationSuite({ ontology, template, suite }).cases.length).toBe(15);
    suite.cases[0].expected.value[0].capacityHours = 4.5;
    expect(capture(() => preflightGraphEvaluationSuite({ ontology, template, suite })).code).toBe("type_mismatch");
  });
});
