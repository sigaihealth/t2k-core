import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { compileOntologyPackSet, semanticHash } from "../compiler.js";
import { generateGraphFunction, prepareGraphGenerationContract, GRAPH_GENERATION_LIMITS,
  type GraphGenerationAttempt } from "../reasoning.js";
import { analyzeGraphGenerationCapabilities, graphGenerationIdentityDiagnostics, graphGenerationOntologyContext, graphGenerationProgramSchema } from "../reasoning.js";
import { ontology, makeFunction, makeGraph } from "../../../../examples/harborlight-reasoning/fixtures.mjs";

const hash = compileOntologyPackSet(ontology).resolutionHash;
const { steps, return: returned, ...template } = makeFunction(hash);
const contract = {
  task: "Find all qualified available crews with sufficient capacity and a covering time window.",
  ontology, template, maximumAttempts: 3,
  trainingCases: [{
    caseId: "development", graph: makeGraph(hash, "training"), arguments: { jobId: "job-1" },
    expected: { status: "complete", value: [{ jobId: "job-1", routeId: "route-a", crewId: "crew-a", capacityHours: 4 }], evidence: { supportingClaimIds: [], consideredClaimIds: [], exclusions: [], rows: [] } },
    forbiddenRows: [{ crewId: "crew-b" }, { crewId: "crew-c" }],
  }],
};

function oversizedContract() {
  const value = structuredClone(contract);
  value.trainingCases = Array.from({ length: 18 }, (_, index) => {
    const item = structuredClone(contract.trainingCases[0]);
    item.caseId = "large-" + index;
    item.graph.graphKey = "synthetic.large-" + index;
    item.graph.claims.find((claim: any) => claim.claimId === "job-1.note")!.value = "x".repeat(30_000);
    return item;
  });
  return value;
}

describe("automatic graph function authoring", () => {
  const requirements = { capabilities: ["lookup", "filter", "project"], definitionRefs: [], identityConstants: [], ordering: "canonical", multiplicity: "preserve" };
  it.each([
    ["capabilities", ["group_by"], "unsupported_requirement"], ["ordering", "ranked", "unsupported_requirement"],
    ["multiplicity", "distinct", "contract_needs_review"], ["definitionRefs", ["missing:concept"], "contract_needs_review"],
  ])("diagnoses explicit unsupported %s before any provider call", async (field, value, code) => {
    const input: any = { ...contract, requirements: { ...requirements, [field]: value } };
    const diagnostics = analyzeGraphGenerationCapabilities(input);
    expect(diagnostics[0].code).toBe(code);
    let calls = 0;
    await expect(generateGraphFunction(input, async () => { calls++; return { steps, return: returned }; })).rejects.toMatchObject({ code });
    expect(calls).toBe(0);
  });

  it("derives a provider strict schema for typed programs while rejecting extra fields and undeclared references", () => {
    const schema = graphGenerationProgramSchema(contract);
    const validate = new Ajv({ strict: true }).compile(schema);
    expect(validate({ steps, return: returned }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ steps, return: returned, programJson: "{}" })).toBe(false);
    const wrong: any = structuredClone({ steps, return: returned });
    wrong.steps[0].typeRef = "missing:type";
    expect(validate(wrong)).toBe(false);
    const badProjection: any = structuredClone({ steps, return: returned });
    badProjection.steps.at(-1).fields.capacityHours = { literal: "four" };
    expect(validate(badProjection)).toBe(false);
    const walk = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (value.type === "object") { expect(value.additionalProperties).toBe(false); expect(value.required).toEqual(Object.keys(value.properties)); }
      Object.values(value).forEach(walk);
    };
    walk(schema);
  });

  it("preserves pinned constraints and reference hashes in a conservative ontology dependency subset", () => {
    const value: any = structuredClone(contract);
    const unrelated = { ...(value.ontology.manifests[0] as any), ontologyId: "unrelated.pack", objectTypes: [value.ontology.manifests[0].objectTypes[0]], reasoningFunctions: [], description: "Unrelated root" };
    // No inherited references or rules: this root contains no dependency of the reviewed function.
    for (const key of ["extends", "structuralRelationships", "authorityModel", "sourceMappings", "decisionTemplates", "validationRules", "normalizationRules", "contextDimensions", "canonicalLinks", "eventTypes", "openSemanticQuestions"]) delete unrelated[key];
    value.ontology.manifests.push(unrelated);
    value.ontology.roots.push({ ontologyId: "unrelated.pack", version: unrelated.ontologyVersion });
    const resolution = compileOntologyPackSet(value.ontology);
    expect(resolution.status, JSON.stringify(resolution.diagnostics)).toBe("valid");
    value.template.ontologyResolutionHash = resolution.resolutionHash;
    const context = graphGenerationOntologyContext(value);
    expect(context.fullResolutionHash).toBe(resolution.resolutionHash);
    expect(context.packs.map((pack) => pack.ontologyId)).not.toContain("unrelated.pack");
    expect(context.mapping.length).toBeGreaterThan(0);
    for (const mapping of context.mapping) expect(resolution.definitions.find((item) => item.definitionKey === mapping.definitionKey)?.contentHash).toBe(mapping.contentHash);
    expect(context.definitions.find((item) => item.definitionKey === value.template.functionRef)?.body).toEqual(resolution.definitions.find((item) => item.definitionKey === value.template.functionRef)?.body);
  });

  it("flags identity memorization even after a passing development answer, then repairs without changing labels", async () => {
    expect(graphGenerationIdentityDiagnostics({ literal: ["crew-a", "ordinary-value"] }, contract).map((item) => item.path)).toEqual(["program.literal.0"]);
    const memorized: any = structuredClone({ steps, return: returned });
    memorized.steps[0].entityId = { literal: "job-1" };
    const result = await generateGraphFunction(contract, async (request) => {
      if (request.attempt === 1) return memorized;
      expect(request.diagnostics?.samples.some((item) => item.code === "undeclared_identity_constant")).toBe(true);
      expect(request.trainingCases[0].arguments.jobId).toBe("job-1");
      return { steps, return: returned };
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["training_failed", "ready"]);
    const declared = await generateGraphFunction({ ...contract, requirements: { ...requirements, identityConstants: ["job-1"] } } as any, async () => memorized);
    expect(declared.status).toBe("ready_for_evaluation");
  });

  it("records structured answer, constraint and evidence differences separately with detailed execution receipts", async () => {
    const value: any = structuredClone(contract);
    value.trainingCases[0].expected.evidence.consideredClaimIds = ["crew-a.capacity_hours"];
    const faulty: any = makeFunction(hash, { omitCapacity: true });
    const result = await generateGraphFunction(value, async (request) => request.attempt === 1 ? { steps: faulty.steps, return: faulty.return } : { steps, return: returned });
    const diagnostic = result.attempts[0].diagnostics!;
    expect(diagnostic.samples.map((item) => item.code)).toContain("answer_rows_mismatch");
    expect(diagnostic.samples.map((item) => item.code)).toContain("hard_constraint_violation");
    expect(result.attempts[0].training!.failures[0].result?.trace.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic).length).toBeLessThan(13000);
  });

  it("repairs compiler and development failures without exposing final cases", async () => {
    const faulty = makeFunction(hash, { omitCapacity: true });
    const requests: unknown[] = [];
    const result = await generateGraphFunction(contract, async (request) => {
      requests.push(request);
      if (request.attempt === 1) return { steps: [{ id: "bad", op: "execute_code" }], return: "bad" };
      if (request.attempt === 2) {
        expect(request.feedback.join()).toContain("invalid_contract");
        return { steps: faulty.steps, return: faulty.return };
      }
      expect(request.feedback.join()).toContain("hard constraint");
      return { steps, return: returned };
    });
    expect(result.status).toBe("ready_for_evaluation");
    expect(result.attempts.map((item) => item.status)).toEqual(["compile_failed", "training_failed", "ready"]);
    expect(result.authorization).toBe("not_authorized");
    expect(Object.keys(requests[0] as object).sort()).toEqual(
      ["attempt", "instructions", "task", "ontology", "template", "trainingCases", "previousProgram", "feedback"].sort());
    expect(result.definition).toEqual(makeFunction(hash));
  });

  it("enforces immutable signatures, search limits, and input data contracts", async () => {
    let calls = 0;
    const result = await generateGraphFunction({ ...contract, maximumAttempts: 2 }, async () => {
      calls++;
      return { steps, return: returned, limits: { maxWork: 100000 } };
    });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: "exhausted", definition: null });
    expect(() => prepareGraphGenerationContract({ ...contract, holdout: [] })).toThrow();
    expect(() => prepareGraphGenerationContract({ ...contract, maximumAttempts: 6 })).toThrow();
    expect(() => prepareGraphGenerationContract({ ...contract, trainingCases: [] })).toThrow();
  });

  it("records provider failure without persisting private error bodies or promoting a fallback", async () => {
    const result = await generateGraphFunction(contract, async () => { throw new Error("secret-provider-body"); });
    expect(result.status).toBe("provider_failed");
    expect(JSON.stringify(result)).not.toContain("secret-provider-body");
    expect(result.definition).toBe(null);
  });

  it("repairs invalid JSON text as an authoring failure", async () => {
    const result = await generateGraphFunction(contract, async (request) => {
      if (request.attempt === 1) return '{"steps":';
      expect(request.feedback).toContain("The program must contain valid JSON.");
      return JSON.stringify({ steps, return: returned });
    });
    expect(result.attempts.map((item) => item.status)).toEqual(["compile_failed", "ready"]);
  });

  it.each([
    ["missing argument", (value: any) => { delete value.trainingCases[0].arguments.jobId; }],
    ["extra argument", (value: any) => { value.trainingCases[0].arguments.extra = true; }],
    ["wrong argument type", (value: any) => { value.trainingCases[0].arguments.jobId = 7; }],
    ["wrong output shape", (value: any) => { value.trainingCases[0].expected.value = 4; }],
    ["wrong output type", (value: any) => { value.trainingCases[0].expected.value[0].capacityHours = "four"; }],
    ["unknown evidence", (value: any) => { value.trainingCases[0].expected.evidence.consideredClaimIds = ["missing-claim"]; }],
    ["unknown entity type", (value: any) => { value.trainingCases[0].graph.entities[0].typeRef = "undeclared:type"; }],
    ["invalid graph property type", (value: any) => { value.trainingCases[0].graph.claims[0].value = false; }],
  ])("rejects %s before any model call", async (_label, mutate) => {
    const value = structuredClone(contract);
    mutate(value);
    let calls = 0;
    await expect(generateGraphFunction(value, async () => { calls++; return { steps, return: returned }; })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("bounds large execution diagnostics so a development failure can be repaired", async () => {
    const value: any = structuredClone(contract);
    value.template.output = { kind: "rows", fields: { crewId: "string", capacityHours: "number" } };
    value.template.limits.maxRows = 1_000;
    const graph = value.trainingCases[0].graph;
    graph.entities = Array.from({ length: 300 }, (_, index) => ({ entityId: "crew-" + index, typeRef: "harborlight.reasoning:crew" }));
    graph.claims = graph.entities.map((entity: any) => ({ claimId: entity.entityId + ".available", revision: "1",
      subjectId: entity.entityId, predicateRef: "harborlight.reasoning:crew.available", value: false,
      status: "accepted", polarity: "positive", observedAt: "2026-09-05T11:45:00Z",
      evidence: [{ sourceRef: "synthetic://dispatch", locator: entity.entityId }],
    }));
    value.trainingCases[0].expected.value = [];
    value.trainingCases[0].forbiddenRows = [];
    const lookup = { id: "crews", op: "lookup", typeRef: "harborlight.reasoning:crew", as: "crew" };
    const project = { id: "result", op: "project", from: "crews", fields: {
      crewId: { entity: "crew" }, capacityHours: { binding: "crew", property: "harborlight.reasoning:crew.capacity_hours" },
    } };
    let calls = 0;
    const result = await generateGraphFunction(value, async (request) => {
      calls++;
      if (request.attempt === 1) return { steps: [lookup, project], return: "result" };
      expect(request.feedback.join()).toContain("truncated");
      expect(request.feedback.join("").length).toBeLessThanOrEqual(GRAPH_GENERATION_LIMITS.maximumFeedbackCharacters);
      expect(request.feedback.every((entry) => entry.length <= GRAPH_GENERATION_LIMITS.maximumFeedbackEntryCharacters)).toBe(true);
      return { steps: [lookup, { id: "eligible", op: "filter", from: "crews", all: [{
        left: { binding: "crew", property: "harborlight.reasoning:crew.available" }, operator: "eq", right: { literal: true },
      }] }, { ...project, from: "eligible" }], return: "result" };
    });
    expect(calls).toBe(2);
    expect(result.attempts[0].training!.failures[0].issues.length).toBe(300);
    expect(JSON.stringify(result.attempts[0].training!.failures[0].issues).length).toBeGreaterThan(32_768);
    expect(result.attempts.map((attempt) => attempt.status)).toEqual(["training_failed", "ready"]);
  });

  it("records a terminal request budget failure without invoking the provider", async () => {
    const value = oversizedContract();
    let calls = 0;
    const result = await generateGraphFunction(value, async () => { calls++; return { steps, return: returned }; });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: "request_budget_failed", definition: null,
      attempts: [{ attempt: 1, status: "request_budget_failed", requestHash: null }] });
    expect(result.generationHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("awaits a deeply immutable completed checkpoint before calling the provider again", async () => {
    const faulty = makeFunction(hash, { omitCapacity: true });
    let release!: () => void, reached!: () => void;
    const checkpointPending = new Promise<void>((resolve) => { release = resolve; });
    const checkpointReached = new Promise<void>((resolve) => { reached = resolve; });
    const order: string[] = [];
    const observed: Readonly<GraphGenerationAttempt>[] = [];
    const pending = generateGraphFunction(contract, async (request) => {
      order.push("provider-" + request.attempt);
      return request.attempt === 1 ? { steps: faulty.steps, return: faulty.return } : { steps, return: returned };
    }, { onAttempt: async (record) => {
      observed.push(record); order.push("checkpoint-" + record.attempt);
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.feedback)).toBe(true);
      expect(Object.isFrozen(record.training!.runs[0])).toBe(true);
      expect(() => record.feedback.push("tampered")).toThrow();
      expect(() => { record.training!.runs[0].passed = !record.training!.runs[0].passed; }).toThrow();
      if (record.attempt === 1) {
        reached(); await checkpointPending;
        order.push("checkpoint-1-saved");
      }
    } });
    await checkpointReached;
    expect(order).toEqual(["provider-1", "checkpoint-1"]);
    release();
    const result = await pending;
    expect(order).toEqual(["provider-1", "checkpoint-1", "checkpoint-1-saved", "provider-2", "checkpoint-2"]);
    expect(result.attempts).toEqual(observed);
    expect(result.attempts[0]).toBe(observed[0]);
    expect(result.status).toBe("ready_for_evaluation");
  });

  const outcomes = ["compile_failed", "training_failed", "ready", "provider_failed", "request_budget_failed"] as const;
  const outcomeContract = (status: typeof outcomes[number]) => status === "request_budget_failed"
    ? oversizedContract() : { ...contract, maximumAttempts: 1 };
  const outcomeProvider = (status: typeof outcomes[number]) => {
    if (status === "provider_failed") throw new Error("private-provider-error");
    if (status === "compile_failed") return '{"steps":';
    if (status === "training_failed") {
      const faulty = makeFunction(hash, { omitCapacity: true });
      return { steps: faulty.steps, return: faulty.return };
    }
    return { steps, return: returned };
  };

  it.each(outcomes)("checkpoints terminal %s without changing result hashes", async (status) => {
    const observed: Readonly<GraphGenerationAttempt>[] = [];
    const value = outcomeContract(status);
    const original = await generateGraphFunction(value, async () => outcomeProvider(status));
    const checkpointed = await generateGraphFunction(value, async () => outcomeProvider(status), {
      onAttempt: async (record) => { observed.push(record); },
    });
    expect(observed.map((attempt) => attempt.status)).toEqual([status]);
    expect(checkpointed).toEqual(original);
    expect(observed[0]).toBe(checkpointed.attempts[0]);
    expect(JSON.stringify(observed)).not.toContain("private-provider-error");
  });

  it.each(outcomes)("propagates a host checkpoint failure after %s without another provider call", async (status) => {
    const stopped = new Error("host-checkpoint-cancelled");
    const value = { ...outcomeContract(status), maximumAttempts: 3 };
    let calls = 0, checkpoints = 0;
    await expect(generateGraphFunction(value, async () => { calls++; return outcomeProvider(status); }, {
      onAttempt: async (record) => { checkpoints++; expect(record.status).toBe(status); throw stopped; },
    })).rejects.toBe(stopped);
    expect(checkpoints).toBe(1);
    expect(calls).toBe(status === "request_budget_failed" ? 0 : 1);
  });

  it("replays journaled responses with identical request and attempt hashes after a checkpoint interruption", async () => {
    const faulty = makeFunction(hash, { omitCapacity: true });
    const responses: unknown[] = ['{"steps":', { steps: faulty.steps, return: faulty.return }, JSON.stringify({ steps, return: returned })];
    const journal = new Map<number, { requestHash: string; response: unknown }>();
    const checkpoints = new Map<number, string>();
    let modelCalls = 0;
    const provider = async (request: any) => {
      const requestHash = semanticHash(request);
      const prior = journal.get(request.attempt);
      if (prior) { expect(requestHash).toBe(prior.requestHash); return structuredClone(prior.response); }
      modelCalls++;
      const response = structuredClone(responses[request.attempt - 1]);
      journal.set(request.attempt, { requestHash, response });
      return response;
    };
    const interruption = new Error("checkpoint-worker-interrupted");
    await expect(generateGraphFunction(contract, provider, { onAttempt: async (record) => {
      checkpoints.set(record.attempt, semanticHash(record));
      if (record.attempt === 2) throw interruption;
    } })).rejects.toBe(interruption);
    expect(modelCalls).toBe(2);
    const replayed = await generateGraphFunction(contract, provider, { onAttempt: async (record) => {
      if (checkpoints.has(record.attempt)) expect(semanticHash(record)).toBe(checkpoints.get(record.attempt));
      else checkpoints.set(record.attempt, semanticHash(record));
    } });
    expect(modelCalls).toBe(3);
    const uninterrupted = await generateGraphFunction(contract, async (request) => structuredClone(responses[request.attempt - 1]));
    expect(replayed).toEqual(uninterrupted);
    expect(checkpoints.size).toBe(3);
  });
});
