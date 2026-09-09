import { describe, expect, it } from "vitest";
import { compileOntologyPackSet } from "../compiler.js";
import {
  compileGraphFunction, computeGraphEvaluationSuiteHash, evaluateGraphFunction,
  generateGraphFunction, graphGenerationInstructions, preflightGraphEvaluationSuite, prepareGraphGenerationContract,
  GRAPH_EVALUATION_CLAIM_SET_MATCHING, GRAPH_GENERATION_EXACT_EVIDENCE_INSTRUCTIONS,
  type GraphEvaluationSuite, type GraphFunctionDefinition, type GraphGenerationContract, type GraphGenerationRequest,
} from "../reasoning.js";
import { ontology, makeFunction, makeGraph, refs } from "../../../../examples/harborlight-reasoning/fixtures.mjs";

const hash = compileOntologyPackSet(ontology).resolutionHash;
function definition(kind: "capacity" | "extra" | "skills" | "missing" = "capacity"): GraphFunctionDefinition {
  const all: any[] = kind === "skills" ? [] : [{ left: { binding: "crew", property: refs.crew + ".capacity_hours" }, operator: "gte", right: { literal: 0 } }];
  if (kind === "skills" || kind === "extra") all.push({ left: { binding: "crew", property: refs.crew + ".skills" }, operator: "contains", right: { literal: "electrical" } });
  return { ...makeFunction(hash), output: { kind: "rows", fields: { crewId: "string" } }, steps: [
    { id: "crews", op: "lookup", typeRef: refs.crew, as: "crew" },
    ...(kind === "missing" ? [] : [{ id: "eligible", op: "filter", from: "crews", all }] as const),
    { id: "options", op: "project", from: kind === "missing" ? "crews" : "eligible", fields: { crewId: { entity: "crew" } } },
  ] };
}
const capacityIds = ["a", "b", "c"].map((id) => "crew-" + id + ".capacity_hours");
function suite(): GraphEvaluationSuite {
  return { suiteVersion: "t2k.graph-evaluation.v2", suiteId: "harborlight.claim-sets", revision: "1",
    thresholds: { minimumCases: 1, minimumAccuracy: 1, minimumImprovement: 0 }, trainingCases: [], cases: [{
      caseId: "development", graph: makeGraph(hash), arguments: { jobId: "job-1" },
      expected: { status: "complete", value: ["a", "b", "c"].map((id) => ({ crewId: "crew-" + id })),
        evidence: { supportingClaimIds: [...capacityIds], consideredClaimIds: [...capacityIds], exclusions: [], rows: [] } }, forbiddenRows: [],
    }] };
}
function contract(value = suite()): GraphGenerationContract {
  const { steps: _steps, return: _return, ...template } = definition();
  return { task: "Return crews with nonnegative capacity, supported only by their capacity claims.", ontology, template, maximumAttempts: 2, trainingCases: value.cases };
}
function evaluate(value = suite(), program = definition(), includeDiagnostics = false) {
  return evaluateGraphFunction({ candidate: compileGraphFunction({ definition: program, ontology }), suite: value,
    expectedSuiteHash: computeGraphEvaluationSuiteHash(value), includeDiagnostics });
}
function exact(value = suite()) {
  value.cases[0].expected.evidence.claimSetMatching = { supporting: "exact", considered: "exact" };
  return value;
}

describe("opt-in exact evidence claim sets", () => {
  it("preserves published 0.6.0 suite, evaluation and generation-request hashes when modes are absent", async () => {
    // Recorded from published Core 0.6.0 using this public synthetic fixture before the extension.
    expect(computeGraphEvaluationSuiteHash(suite())).toBe("47a61cbcef9ab373fe8092ea21d700968476bc91e114d2dd347dfa5b81d8d846");
    expect(evaluate().evaluationHash).toBe("da32f8cb5fb34b4e9665dec639e75ca9008e82bc3fac8152bcea08fd759e89e2");
    const program = definition();
    const generated = await generateGraphFunction(contract(), async () => ({ steps: program.steps, return: program.return }));
    expect(generated.attempts[0].requestHash).toBe("79bb2fb47ed7b6a8e4e1c064ae82b698fd454db36aa1e7a64fd33b32e8787eca");
    expect(evaluate(suite(), definition("extra")).status).toBe("passed");
    expect(GRAPH_EVALUATION_CLAIM_SET_MATCHING).toEqual(["supporting", "considered"]);
  });

  it("prevents callers from expanding the exported matching-role validation whitelist", () => {
    expect(Object.isFrozen(GRAPH_EVALUATION_CLAIM_SET_MATCHING)).toBe(true);
    expect(() => (GRAPH_EVALUATION_CLAIM_SET_MATCHING as unknown as string[]).push("rows")).toThrow(TypeError);
    expect(() => { (GRAPH_EVALUATION_CLAIM_SET_MATCHING as unknown as string[])[0] = "rows"; }).toThrow(TypeError);
    const value = suite();
    (value.cases[0].expected.evidence as any).claimSetMatching = { rows: "exact" };
    expect(() => computeGraphEvaluationSuiteHash(value)).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
    expect(evaluate(exact()).status).toBe("passed");
  });

  it("accepts exact sets in any input order and binds the modes to the normalized suite hash", () => {
    const value = exact(), original = structuredClone(value), pinned = computeGraphEvaluationSuiteHash(value);
    expect(evaluate(value).status).toBe("passed");
    value.cases[0].expected.evidence.supportingClaimIds.reverse();
    value.cases[0].expected.evidence.consideredClaimIds.reverse();
    value.cases[0].graph.claims.reverse();
    expect(computeGraphEvaluationSuiteHash(value)).toBe(pinned);
    expect(evaluate(value)).toEqual(evaluate(original));
    expect(original).toEqual(exact());
    expect(pinned).not.toBe(computeGraphEvaluationSuiteHash(suite()));
    expect(() => evaluateGraphFunction({ candidate: compileGraphFunction({ definition: definition(), ontology }), suite: value,
      expectedSuiteHash: computeGraphEvaluationSuiteHash(suite()) })).toThrowError(expect.objectContaining({ code: "evaluation_contract_mismatch" }));
  });

  it.each(["supporting", "considered"] as const)("opts in %s independently and rejects extra claims despite the correct answer", (role) => {
    const value = suite(), evidence = value.cases[0].expected.evidence;
    evidence.claimSetMatching = { [role]: "exact" };
    evidence[role === "supporting" ? "consideredClaimIds" : "supportingClaimIds"] = [];
    expect(evaluate(value).status).toBe("passed");
    const result = evaluate(value, definition("extra"), true);
    expect(result.status).toBe("failed");
    expect(result.candidate.failures[0].reasons).toEqual([expect.stringContaining("Additional " + role)]);
    expect(result.candidate.failures[0].diagnostics).toEqual([expect.objectContaining({ code: role + "_evidence_mismatch",
      details: { missing: { total: 0, omitted: 0, truncated: false, samples: [] },
        extra: { total: 3, omitted: 0, truncated: false, samples: ["crew-a.skills", "crew-b.skills", "crew-c.skills"] } } })]);
  });

  it("reports missing exact claims while preserving separate row and exclusion assertions", () => {
    const value = exact();
    value.cases[0].expected.evidence.rows = [{ row: { crewId: "crew-a" }, claimIds: ["crew-a.capacity_hours"] }];
    expect(evaluate(value).status).toBe("passed");
    const result = evaluate(value, definition("missing"), true);
    expect(result.candidate.failures[0].diagnostics?.map((item) => item.code)).toEqual([
      "supporting_evidence_mismatch", "considered_evidence_mismatch", "row_evidence_mismatch",
    ]);
    value.cases[0].expected.evidence.exclusions = [{ entityIds: ["crew-b"], claimIds: ["crew-b.capacity_hours"] }];
    expect(evaluate(value).candidate.failures[0].reasons).toEqual(["Required exclusion evidence did not establish the designated exclusion."]);
  });

  it("treats exact empty arrays as empty-set assertions, including unresolved and excluded evidence", () => {
    const value = exact(), evidence = value.cases[0].expected.evidence;
    evidence.supportingClaimIds = [];
    expect(evaluate(value).status).toBe("failed");
    value.cases[0].expected.value = [];
    value.cases[0].graph.claims.filter((claim) => capacityIds.includes(claim.claimId)).forEach((claim) => { claim.value = -1; });
    expect(evaluate(value).status).toBe("passed");
    evidence.consideredClaimIds = [];
    expect(evaluate(value).status).toBe("failed");
    value.cases[0].graph = makeGraph(hash);
    value.cases[0].graph.claims.find((claim) => claim.claimId === capacityIds[0])!.observedAt = "2026-09-04T12:00:00Z";
    value.cases[0].expected.status = "needs_review";
    value.cases[0].expected.value = null;
    evidence.consideredClaimIds = [...capacityIds];
    expect(evaluate(value).status).toBe("passed");
    evidence.consideredClaimIds.pop();
    expect(evaluate(value).status).toBe("failed");
  });

  it.each([null, {}, [], "exact", { supporting: "subset" }, { considered: true }, { supporting: "exact", rows: "exact" }])(
    "rejects malformed matching declarations %j", (mode) => {
      const value = suite(); (value.cases[0].expected.evidence as any).claimSetMatching = mode;
      expect(() => computeGraphEvaluationSuiteHash(value)).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
    });

  it.each([
    ["duplicate supporting", (value: GraphEvaluationSuite) => { value.cases[0].expected.evidence.supportingClaimIds.push(capacityIds[0]); }],
    ["duplicate considered", (value: GraphEvaluationSuite) => { value.cases[0].expected.evidence.consideredClaimIds.push(capacityIds[0]); }],
    ["omitted required supporting", (value: GraphEvaluationSuite) => { value.cases[0].expected.evidence.consideredClaimIds.pop(); }],
    ["omitted required row", (value: GraphEvaluationSuite) => { value.cases[0].expected.evidence.rows = [{ row: { crewId: "crew-a" }, claimIds: ["crew-a.skills"] }]; }],
    ["omitted required exclusion", (value: GraphEvaluationSuite) => { value.cases[0].expected.evidence.exclusions = [{ entityIds: ["crew-a"], claimIds: ["crew-a.available"] }]; }],
    ["unknown considered claim", (value: GraphEvaluationSuite) => { value.cases[0].expected.evidence.consideredClaimIds.push("missing-claim"); }],
  ] as const)("rejects %s before any provider call", async (_label, mutate) => {
    const value = exact(); mutate(value);
    expect(() => preflightGraphEvaluationSuite({ ontology, template: contract().template, suite: value })).toThrowError(expect.objectContaining({ code: "invalid_contract" }));
    let calls = 0;
    await expect(generateGraphFunction(contract(value), async () => { calls++; return {}; })).rejects.toMatchObject({ code: "invalid_contract" });
    expect(calls).toBe(0);
  });

  it("retains frozen exact labels and bounded missing/extra diagnostics through development repair", async () => {
    const value = exact(), item = value.cases[0];
    for (const id of ["d", "e"]) {
      item.graph.entities.push({ entityId: "crew-" + id, typeRef: refs.crew });
      item.graph.claims.push(...item.graph.claims.filter((claim) => claim.subjectId === "crew-a").map((claim) => ({
        ...structuredClone(claim), claimId: claim.claimId.replace("crew-a", "crew-" + id), subjectId: "crew-" + id,
      })));
      (item.expected.value as { crewId: string }[]).push({ crewId: "crew-" + id });
      item.expected.evidence.supportingClaimIds.push("crew-" + id + ".capacity_hours");
      item.expected.evidence.consideredClaimIds.push("crew-" + id + ".capacity_hours");
    }
    const frozen = structuredClone(value);
    const normalized = prepareGraphGenerationContract(contract(value));
    const requests: Readonly<GraphGenerationRequest>[] = [];
    const generated = await generateGraphFunction(contract(value), async (request) => {
      requests.push(request);
      const program = definition(request.attempt === 1 ? "skills" : "capacity");
      return { steps: program.steps, return: program.return };
    });
    expect(generated.attempts.map((attempt) => attempt.status)).toEqual(["training_failed", "ready"]);
    for (const request of requests) {
      expect(request.instructions).toBe(graphGenerationInstructions(undefined, value.cases));
      expect(request.instructions).toContain(GRAPH_GENERATION_EXACT_EVIDENCE_INSTRUCTIONS);
      expect(request.trainingCases).toEqual(normalized.trainingCases);
      expect(Object.isFrozen(request.trainingCases[0].expected.evidence.claimSetMatching)).toBe(true);
      if (request.attempt === 2) {
        for (const diagnostic of request.diagnostics!.samples) {
          expect(diagnostic.code).toMatch(/^(supporting|considered)_evidence_mismatch$/);
          expect(diagnostic.details).toMatchObject({ missing: { total: 5, omitted: 2, truncated: true }, extra: { total: 5, omitted: 2, truncated: true } });
          expect((diagnostic.details as any).missing.samples).toHaveLength(3);
          expect((diagnostic.details as any).extra.samples).toHaveLength(3);
        }
      }
    }
    expect(value).toEqual(frozen);
  });
});
