import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { compileOntologyPackSet, semanticHash } from "../compiler.js";
import { graphPlan } from "../reasoning-compiler.js";
import {
  analyzeGraphGenerationCapabilities, compileGraphFunction, executeGraphFunction,
  generateGraphFunction, GRAPH_GENERATION_INSTRUCTIONS, GRAPH_GENERATION_DISTINCT_INSTRUCTIONS,
  GRAPH_SYNTHESIS_CAPABILITIES, graphGenerationInstructions, graphGenerationProgramSchema,
  type GraphFunctionDefinition, type GraphGenerationContract, type GraphStep, type ReasoningGraphSnapshot,
} from "../reasoning.js";
import { ontology, makeFunction, makeGraph, refs } from "../../../../examples/harborlight-reasoning/fixtures.mjs";

const hash = compileOntologyPackSet(ontology).resolutionHash;
const compile = (definition: GraphFunctionDefinition) => compileGraphFunction({ definition, ontology });
const property = { binding: "crew", property: refs.crew + ".capacity_hours" };
const distinct: GraphStep = { id: "unique", op: "distinct", from: "eligible", binding: "crew" };
function definition(): GraphFunctionDefinition {
  const original = makeFunction(hash);
  return {
    ...original,
    output: { kind: "rows", fields: { crewId: "string", capacityHours: "number" } },
    steps: [...original.steps.slice(0, 4), { ...distinct },
      { id: "options", op: "project", from: "unique", fields: { crewId: { entity: "crew" }, capacityHours: { ...property } } }],
  };
}
function graph(): ReasoningGraphSnapshot {
  const snapshot = makeGraph(hash);
  const routeCrew = snapshot.claims.find((claim: any) => claim.claimId === "route-a.crew-a");
  for (const route of ["b", "c"]) snapshot.claims.push({
    ...structuredClone(routeCrew), claimId: "route-" + route + ".crew-a", subjectId: "route-" + route,
  });
  return snapshot;
}
function run(snapshot = graph(), program = definition()) {
  return executeGraphFunction({ compiled: compile(program), graph: snapshot, arguments: { jobId: "job-1" },
    context: { graphKey: snapshot.graphKey, asOf: snapshot.asOf } });
}
function aggregate(operation: "count" | "sum", project = true): GraphFunctionDefinition {
  const program = definition();
  if (!project) program.steps.pop();
  program.steps.push({ id: "total", op: "aggregate", from: project ? "options" : "unique", operation,
    ...(operation === "sum" ? { field: "capacityHours" } : {}) });
  program.output = { kind: "scalar", valueType: "number" };
  program.return = "total";
  return program;
}

describe("entity-bound distinct compilation", () => {
  it("retains only the selected ontology-typed binding", () => {
    const compiled = compile(definition());
    expect(graphPlan(compiled).stepTypes.get("unique")).toEqual({ kind: "bindings", bindings: { crew: refs.crew }, fields: {} });
    expect(Object.isFrozen(compiled.definition.steps)).toBe(true);
  });

  it.each([
    ["unknown binding", "unknown_binding", (program: any) => { program.steps[4].binding = "missing"; }],
    ["missing binding", "invalid_contract", (program: any) => { delete program.steps[4].binding; }],
    ["extra field", "invalid_contract", (program: any) => { program.steps[4].fields = ["crew"]; }],
    ["retaining a path entity", "unknown_binding", (program: any) => { program.steps[5].fields.crewId = { entity: "route" }; }],
    ["retaining a path property", "type_mismatch", (program: any) => {
      program.steps[5].fields.capacityHours = { binding: "job", property: refs.job + ".hours" };
    }],
    ["projected rows", "type_mismatch", (program: any) => {
      program.steps[4] = { id: "projected", op: "project", from: "eligible", fields: { crew: { entity: "crew" } } };
      program.steps.splice(5, 0, { ...distinct, from: "projected" });
    }],
    ["scalar input", "type_mismatch", (program: any) => {
      program.steps.splice(4, 0, { id: "count", op: "aggregate", from: "eligible", operation: "count" });
      program.steps[5].from = "count";
    }],
  ])("rejects %s", (_label, code, mutate) => {
    const program = definition(); mutate(program);
    expect(() => compile(program)).toThrowError(expect.objectContaining({ code }));
  });

  it("does not allow a binding collection as the returned value", () => {
    const program = definition(); program.steps.pop(); program.return = "unique";
    expect(() => compile(program)).toThrow();
  });
});

describe("bounded entity distinct execution", () => {
  it("unions every supporting path without selecting a path representative", () => {
    const result = run();
    expect(result).toMatchObject({ status: "complete", value: [{ crewId: "crew-a", capacityHours: 4 }] });
    const claims = ["job-1.route-a", "job-1.route-b", "job-1.route-c", "route-a.crew-a", "route-b.crew-a", "route-c.crew-a"];
    expect(result.supportingClaimIds).toEqual(expect.arrayContaining(claims));
    expect(result.derivations).toEqual([{ rowHash: semanticHash({ crewId: "crew-a", capacityHours: 4 }), claimIds: result.supportingClaimIds }]);
    expect(result.supportingClaimIds).not.toContain("crew-b.capacity_hours");
    const trace = result.trace.find((step) => step.operator === "distinct")!;
    expect(trace).toMatchObject({ inputRows: 3, outputRows: 1, claimIds: result.supportingClaimIds });
    expect(trace.outputHash).toBe(semanticHash([{
      bindings: { crew: "crew-a" }, values: {}, issues: [], claimIds: result.supportingClaimIds,
    }]));
  });

  it.each(["count", "sum"] as const)("computes %s by entity identity even when different entities have equal capacity", (operation) => {
    const snapshot = graph();
    snapshot.claims.find((claim) => claim.claimId === "crew-b.capacity_hours")!.value = 4;
    expect(run(snapshot, aggregate(operation))).toMatchObject({ status: "complete", value: operation === "count" ? 2 : 8 });
    expect(run(snapshot, aggregate("count", false))).toMatchObject({ status: "complete", value: 2 });
    const original = definition();
    original.steps.splice(4, 1);
    (original.steps.at(-1) as any).from = "eligible";
    expect(run(snapshot, original).value).toHaveLength(4);
  });

  it("uses exact entity ids without case folding or numeric value comparison", () => {
    const snapshot = graph();
    snapshot.entities.push({ entityId: "CREW-A", typeRef: refs.crew });
    const matching = snapshot.claims.filter((claim) => claim.subjectId === "crew-a");
    snapshot.claims.push(...matching.map((claim) => ({ ...structuredClone(claim), claimId: "upper-" + claim.claimId, subjectId: "CREW-A" })));
    snapshot.claims.push({ ...structuredClone(snapshot.claims.find((claim) => claim.claimId === "route-a.crew-a")!),
      claimId: "upper-route", objectId: "CREW-A" });
    expect(run(snapshot).value).toEqual([{ crewId: "CREW-A", capacityHours: 4 }, { crewId: "crew-a", capacityHours: 4 }]);
    expect(run(snapshot, aggregate("sum")).value).toBe(8);
    const result = run(snapshot);
    expect(result.trace.find((step) => step.operator === "distinct")!.outputHash).toBe(semanticHash(["CREW-A", "crew-a"].map((crewId) => ({
      bindings: { crew: crewId }, values: {}, issues: [],
      claimIds: result.derivations.find((row) => row.rowHash === semanticHash({ crewId, capacityHours: 4 }))!.claimIds,
    }))));
  });

  it.each(["count", "sum"] as const)("returns zero for an empty distinct %s", (operation) => {
    expect(run(makeGraph(hash, "empty_routes"), aggregate(operation))).toMatchObject({ status: "complete", value: 0 });
    expect(run(makeGraph(hash, "empty_routes")).value).toEqual([]);
  });

  it.each([
    ["disputed", "conflicting_evidence", (claim: any) => { claim.status = "disputed"; }],
    ["stale", "stale_evidence", (claim: any) => { claim.observedAt = "2026-09-01T11:45:00Z"; }],
    ["missing locator", "missing_locator", (claim: any) => { claim.evidence = []; }],
    ["proposed", "missing_accepted_evidence", (claim: any) => { claim.status = "proposed"; }],
  ])("preserves an unresolved %s alternate path despite two clean paths", (_label, code, mutate) => {
    const snapshot = graph(); mutate(snapshot.claims.find((claim) => claim.claimId === "job-1.route-c"));
    for (const program of [definition(), aggregate("count"), aggregate("sum")]) {
      const result = run(snapshot, program);
      expect(result).toMatchObject({ status: "needs_review", value: null, supportingClaimIds: [], derivations: [] });
      expect(result.issues).toEqual([expect.objectContaining({ code, entityId: "route-c" })]);
      expect(result.evidence.map((claim) => claim.claimId)).toContain("job-1.route-c");
    }
  });

  it("deduplicates repeated issues and retains distinct unresolved issues across paths", () => {
    const snapshot = graph();
    snapshot.claims.find((claim) => claim.claimId === "job-1.route-c")!.status = "disputed";
    snapshot.claims.find((claim) => claim.claimId === "job-1.route-b")!.evidence = [];
    snapshot.claims = snapshot.claims.filter((claim) => claim.claimId !== "crew-a.available");
    const result = run(snapshot, aggregate("count", false));
    expect(result.issues).toHaveLength(3);
    expect(result.issues.map((issue) => issue.code).sort()).toEqual(["conflicting_evidence", "missing_accepted_evidence", "missing_locator"]);
    const distinctTrace = result.trace.find((step) => step.operator === "distinct")!;
    expect(distinctTrace.outputHash).toBe(semanticHash([{
      bindings: { crew: "crew-a" }, values: {}, issues: result.issues, claimIds: distinctTrace.claimIds,
    }]));
  });

  it("preserves incomplete-view review and explicit edge exclusions", () => {
    const snapshot = graph(); snapshot.coverage = "partial";
    expect(run(snapshot, aggregate("count", false))).toMatchObject({ status: "needs_review", value: null,
      issues: [expect.objectContaining({ code: "incomplete_view" })] });
    snapshot.coverage = "complete";
    snapshot.claims.find((claim) => claim.claimId === "route-c.crew-a")!.polarity = "negative";
    const result = run(snapshot);
    expect(result.status).toBe("complete");
    expect(result.supportingClaimIds).not.toContain("route-c.crew-a");
    expect(result.exclusions).toContainEqual(expect.objectContaining({ claimIds: expect.arrayContaining(["route-c.crew-a"]) }));
  });

  it("is invariant to input ordering and does not mutate caller inputs", () => {
    const snapshot = graph(); const saved = structuredClone(snapshot); const program = definition(); const savedProgram = structuredClone(program);
    const result = run(snapshot, program);
    expect(snapshot).toEqual(saved); expect(program).toEqual(savedProgram);
    snapshot.entities.reverse(); snapshot.claims.reverse(); snapshot.claims.forEach((claim) => claim.evidence.reverse());
    expect(run(snapshot, program)).toEqual(result);
  });

  it("charges every source row and merged claim to the work budget", () => {
    const program = definition();
    program.steps = [...program.steps.slice(0, 2), { id: "unique", op: "distinct", from: "routes", binding: "job" },
      { id: "total", op: "aggregate", from: "unique", operation: "count" }];
    program.return = "total"; program.output = { kind: "scalar", valueType: "number" };
    const baseline = structuredClone(program);
    baseline.steps.splice(2, 1); (baseline.steps.at(-1) as any).from = "routes";
    const result = run(graph(), program); const prior = run(graph(), baseline);
    // Distinct: one step + three rows + three claims; count now examines one row instead of three.
    expect(result.work).toBe(prior.work + 5);
    program.limits.maxWork = result.work;
    expect(run(graph(), program).value).toBe(1);
    program.limits.maxWork--;
    expect(() => run(graph(), program)).toThrowError(expect.objectContaining({ code: "work_limit" }));
  });

  it("charges unresolved issue merges and rejects excess intermediate paths before collapse", () => {
    const snapshot = graph(); const program = aggregate("count", false);
    snapshot.claims.find((claim) => claim.claimId === "job-1.route-c")!.status = "disputed";
    const result = run(snapshot, program);
    program.limits.maxWork = result.work - 1;
    expect(() => run(snapshot, program)).toThrowError(expect.objectContaining({ code: "work_limit" }));
    program.limits.maxWork = 10000;
    program.limits.maxRows = 4; // Three lookup routes expand to five paths, ultimately one distinct entity.
    expect(() => run(snapshot, program)).toThrowError(expect.objectContaining({ code: "row_limit" }));
    program.limits.maxRows = 5;
    expect(run(snapshot, program).status).toBe("needs_review");
  });

  it("keeps work and result hashes independent of the engine's sort comparison count", () => {
    const snapshot = graph(); const program = aggregate("sum");
    snapshot.claims.find((claim) => claim.claimId === "crew-b.capacity_hours")!.value = 4;
    snapshot.claims.find((claim) => claim.claimId === "job-1.route-b")!.evidence = [];
    snapshot.claims.find((claim) => claim.claimId === "job-1.route-c")!.status = "disputed";
    const expected = run(snapshot, program);
    const nativeSort = Array.prototype.sort;
    const alternateSort = vi.spyOn(Array.prototype, "sort").mockImplementation(function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
      return nativeSort.call(this, compare ? (a: unknown, b: unknown) => { compare(a, b); return compare(a, b); } : undefined);
    });
    let replayed;
    try { replayed = run(snapshot, program); } finally { alternateSort.mockRestore(); }
    expect(replayed).toEqual(expected);
  });

  it("preserves existing function and result hashes for programs without distinct", () => {
    const original = makeFunction(hash);
    expect(compile(original).functionHash).toBe("0a77db8ca42b309e9d6f7cc0fe753eb43b9a9bd941cc27b3e9a6869f9955dc3e");
    expect(run(makeGraph(hash), original).resultHash).toBe("ccbb2ecbce3e85c95d664caa81643e0498a70d42e914f546fc42b81ede8055b5");
  });
});

describe("reviewed distinct generation", () => {
  function contract(): GraphGenerationContract {
    const { steps: _steps, return: _returned, ...template } = definition();
    return { ontology, template, task: "Return each eligible crew once across its qualifying route paths.", maximumAttempts: 2,
      requirements: { capabilities: ["lookup", "traverse", "filter", "distinct", "project"], definitionRefs: [], identityConstants: [], ordering: "canonical", multiplicity: "distinct" },
      trainingCases: [{ caseId: "development", graph: graph(), arguments: { jobId: "job-1" }, expected: {
        status: "complete", value: [{ crewId: "crew-a", capacityHours: 4 }],
        evidence: { supportingClaimIds: [], consideredClaimIds: [], exclusions: [], rows: [] },
      }, forbiddenRows: [] }],
    };
  }

  it("advertises the bounded distinct capability while leaving ranking and grouping unsupported", () => {
    expect(GRAPH_SYNTHESIS_CAPABILITIES).toContain("distinct");
    expect(analyzeGraphGenerationCapabilities(contract())).toEqual([]);
    const input = contract(); input.requirements!.capabilities.push("group_by"); input.requirements!.ordering = "ranked";
    expect(analyzeGraphGenerationCapabilities(input).map((entry) => entry.code)).toEqual(["unsupported_requirement", "unsupported_requirement"]);
  });

  it.each(["missing capability", "preserved multiplicity"])("rejects a declaration with %s before calling the provider", async (variant) => {
    const input = contract();
    if (variant === "missing capability") input.requirements!.capabilities = input.requirements!.capabilities.filter((item) => item !== "distinct");
    else input.requirements!.multiplicity = "preserve";
    expect(analyzeGraphGenerationCapabilities(input)).toEqual([expect.objectContaining({ code: "contract_needs_review", path: "requirements.multiplicity" })]);
    let calls = 0;
    await expect(generateGraphFunction(input, async () => { calls++; return {}; })).rejects.toMatchObject({ code: "contract_needs_review" });
    expect(calls).toBe(0);
  });

  it("offers a strict distinct schema only for an explicit compatible declaration", () => {
    const input = contract(); const program = definition();
    const validate = new Ajv({ strict: true }).compile(graphGenerationProgramSchema(input));
    expect(validate({ steps: program.steps, return: program.return }), JSON.stringify(validate.errors)).toBe(true);
    const extra: any = structuredClone(program.steps); extra[4].field = "value";
    expect(validate({ steps: extra, return: program.return })).toBe(false);
    delete extra[4].field; delete extra[4].binding;
    expect(validate({ steps: extra, return: program.return })).toBe(false);
    const noRequirements = { ...input, requirements: undefined };
    const legacyValidate = new Ajv({ strict: true }).compile(graphGenerationProgramSchema(noRequirements));
    expect(legacyValidate({ steps: program.steps, return: program.return })).toBe(false);
    input.requirements!.multiplicity = "preserve";
    expect(new Ajv().compile(graphGenerationProgramSchema(input))({ steps: program.steps, return: program.return })).toBe(false);
  });

  it("adds instructions only for distinct contracts and repairs a missing distinct even when the small suite passes", async () => {
    const input = contract(); input.trainingCases[0].graph = makeGraph(hash);
    expect(graphGenerationInstructions()).toBe(GRAPH_GENERATION_INSTRUCTIONS);
    expect(graphGenerationInstructions(input.requirements)).toBe(GRAPH_GENERATION_INSTRUCTIONS + "\n" + GRAPH_GENERATION_DISTINCT_INSTRUCTIONS);
    const program = definition(); const old = structuredClone(program); old.steps.splice(4, 1); (old.steps.at(-1) as any).from = "eligible";
    const result = await generateGraphFunction(input, async (request) => {
      expect(request.instructions).toBe(graphGenerationInstructions(input.requirements));
      if (request.attempt === 1) return { steps: old.steps, return: old.return };
      expect(request.diagnostics?.samples).toContainEqual(expect.objectContaining({ code: "multiplicity_mismatch", action: "repair_program" }));
      return { steps: program.steps, return: program.return };
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["training_failed", "ready"]);
    expect(result.attempts[0].training!.passedCases).toBe(1);
    expect(result.definition).toEqual(program);
    input.requirements!.multiplicity = "preserve";
    input.requirements!.capabilities = input.requirements!.capabilities.filter((item) => item !== "distinct");
    const preserved = await generateGraphFunction(input, async (request) => {
      expect(request.instructions).toBe(GRAPH_GENERATION_INSTRUCTIONS);
      return request.attempt === 1 ? { steps: program.steps, return: program.return } : { steps: old.steps, return: old.return };
    });
    expect(preserved.attempts.map((attempt) => attempt.status)).toEqual(["training_failed", "ready"]);
    expect(preserved.attempts[0].diagnostics?.samples).toContainEqual(expect.objectContaining({ code: "multiplicity_mismatch" }));
  });

  it("rejects an implicit distinct returned by a custom provider for a legacy contract", async () => {
    const input = contract(); delete input.requirements;
    input.trainingCases[0].graph = makeGraph(hash); // One qualifying path hides the undeclared semantic change.
    const program = definition(); const preserved = structuredClone(program);
    preserved.steps.splice(4, 1); (preserved.steps.at(-1) as any).from = "eligible";
    const result = await generateGraphFunction(input, async (request) => {
      expect(request.instructions).toBe(GRAPH_GENERATION_INSTRUCTIONS);
      expect(request.requirements).toBeUndefined();
      if (request.attempt === 1) return { steps: program.steps, return: program.return };
      expect(request.diagnostics?.samples).toContainEqual(expect.objectContaining({ code: "multiplicity_mismatch", action: "repair_program" }));
      return { steps: preserved.steps, return: preserved.return };
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["training_failed", "ready"]);
    expect(result.attempts[0].training!.passedCases).toBe(1);
    expect(result.definition).toEqual(preserved);
  });
});
