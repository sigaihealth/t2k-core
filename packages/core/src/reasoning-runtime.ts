import { canonicalJson, compareCanonicalStrings, semanticHash } from "./compiler.js";
import { assignable, graphPlan, propertyDefinition, type GraphPlan } from "./reasoning-compiler.js";
import {
  array, identifier, literalType, object, reasoningData,
  requireCondition, textValue, timestamp, validValue,
} from "./reasoning-input.js";
import type {
  CompiledGraphFunction, GraphClaim, GraphExclusion, GraphFunctionResult, GraphIssue,
  GraphFunctionTemplate, GraphOperand, GraphRow, GraphStepTrace, GraphValue, ReasoningGraphSnapshot,
} from "./reasoning-types.js";

interface Row {
  bindings: Record<string, string>;
  values: GraphRow;
  issues: GraphIssue[];
  claimIds: Set<string>;
}

export function normalizeReasoningGraph(value: unknown): ReasoningGraphSnapshot {
  const graph = reasoningData(value);
  object(graph, ["snapshotVersion", "graphKey", "asOf", "ontologyResolutionHash", "coverage", "entities", "claims"]);
  requireCondition(graph.snapshotVersion === "t2k.reasoning-graph.v1" &&
    ["complete", "partial"].includes(graph.coverage), "invalid_contract", "Unsupported graph snapshot contract.");
  identifier(graph.graphKey, "Graph key");
  requireCondition(typeof graph.ontologyResolutionHash === "string" && /^[a-f0-9]{64}$/.test(graph.ontologyResolutionHash),
    "invalid_contract", "The graph must pin a compiled ontology hash.");
  graph.asOf = new Date(timestamp(graph.asOf, "Graph asOf")).toISOString();
  array(graph.entities, 2_000, "Entities");
  array(graph.claims, 12_000, "Claims");
  const entities = new Set<string>();
  for (const entity of graph.entities) {
    object(entity, ["entityId", "typeRef"]);
    identifier(entity.entityId, "Entity id");
    identifier(entity.typeRef, "Entity type");
    requireCondition(!entities.has(entity.entityId), "duplicate_entity", "Duplicate graph entity.");
    entities.add(entity.entityId);
  }
  const claims = new Set<string>();
  for (const claim of graph.claims) {
    object(claim, ["claimId", "revision", "subjectId", "predicateRef", "status", "polarity", "observedAt", "evidence"],
      ["value", "objectId", "validFrom", "validUntil"]);
    for (const key of ["claimId", "revision", "subjectId", "predicateRef"]) identifier(claim[key], key);
    requireCondition(!claims.has(claim.claimId), "duplicate_claim", "A snapshot must contain one revision per claim id.");
    claims.add(claim.claimId);
    requireCondition(entities.has(claim.subjectId), "unknown_entity", "Claim subject is outside the graph snapshot.");
    requireCondition(Object.hasOwn(claim, "value") !== Object.hasOwn(claim, "objectId"),
      "invalid_contract", "A claim requires exactly one literal value or entity object.");
    if (claim.objectId !== undefined) {
      identifier(claim.objectId, "Claim object");
      requireCondition(entities.has(claim.objectId), "unknown_entity", "Claim object is outside the graph snapshot.");
    } else literalType(claim.value);
    requireCondition(["accepted", "proposed", "disputed", "retracted"].includes(claim.status) &&
      ["positive", "negative"].includes(claim.polarity), "invalid_contract", "Unknown claim status or polarity.");
    claim.observedAt = new Date(timestamp(claim.observedAt, "Claim observedAt")).toISOString();
    for (const key of ["validFrom", "validUntil"]) {
      if (claim[key] !== undefined) claim[key] = new Date(timestamp(claim[key], key)).toISOString();
    }
    requireCondition(!claim.validFrom || !claim.validUntil || claim.validFrom < claim.validUntil,
      "invalid_timestamp", "Claim validity interval must be non-empty.");
    array(claim.evidence, 32, "Claim evidence");
    for (const evidence of claim.evidence) {
      object(evidence, ["sourceRef", "locator"]);
      textValue(evidence.sourceRef, "Source reference");
      textValue(evidence.locator, "Evidence locator");
    }
    claim.evidence.sort((a: any, b: any) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b)));
  }
  graph.entities.sort((a: any, b: any) => compareCanonicalStrings(a.entityId, b.entityId));
  graph.claims.sort((a: any, b: any) => compareCanonicalStrings(a.claimId, b.claimId));
  return graph;
}

/** Hash a canonical snapshot; the host is responsible for authorizing its contents. */
export function computeReasoningGraphHash(graph: unknown) {
  return semanticHash(normalizeReasoningGraph(graph));
}

export function validateGraphTypes(graph: ReasoningGraphSnapshot, plan: Pick<GraphPlan, "definitions">) {
  const entities = new Map(graph.entities.map((entity) => [entity.entityId, entity]));
  const singleTargets = new Map<string, string>();
  const singleSources = new Map<string, string>();
  const asOf = Date.parse(graph.asOf);
  for (const entity of graph.entities) {
    requireCondition(plan.definitions.get(entity.typeRef)?.definitionKind === "object_type",
      "unknown_type", "Graph entity has an undeclared type: " + entity.typeRef);
  }
  for (const claim of graph.claims) {
    const subject = entities.get(claim.subjectId)!;
    const predicate = plan.definitions.get(claim.predicateRef);
    if (claim.objectId !== undefined) {
      requireCondition(predicate?.definitionKind === "structural_relationship",
        "unknown_relation", "Graph relation is not declared in the ontology.");
      requireCondition(assignable(plan.definitions, subject.typeRef, String(predicate.body.from)) &&
        assignable(plan.definitions, entities.get(claim.objectId)!.typeRef, String(predicate.body.to)),
        "type_mismatch", "Graph relationship violates its domain/range.");
      if (claim.status === "accepted" && claim.polarity === "positive" &&
        Date.parse(claim.observedAt) <= asOf &&
        (!claim.validFrom || Date.parse(claim.validFrom) <= asOf) &&
        (!claim.validUntil || Date.parse(claim.validUntil) > asOf)) {
        const cardinality = predicate.body.cardinality;
        if (cardinality === "one_to_one" || cardinality === "many_to_one") {
          const index = canonicalJson([claim.predicateRef, claim.subjectId]);
          requireCondition(!singleTargets.has(index) || singleTargets.get(index) === claim.objectId,
            "cardinality_violation", "Accepted graph relations violate source cardinality.");
          singleTargets.set(index, claim.objectId);
        }
        if (cardinality === "one_to_one" || cardinality === "one_to_many") {
          const index = canonicalJson([claim.predicateRef, claim.objectId]);
          requireCondition(!singleSources.has(index) || singleSources.get(index) === claim.subjectId,
            "cardinality_violation", "Accepted graph relations violate target cardinality.");
          singleSources.set(index, claim.subjectId);
        }
      }
    } else {
      const property = propertyDefinition(plan, claim.predicateRef);
      requireCondition(assignable(plan.definitions, subject.typeRef, String(property.body.objectType)) &&
        validValue(claim.value, property.body.valueType as any),
        "type_mismatch", "Graph property violates its ontology type: " + claim.predicateRef);
    }
  }
}

export function validateGraphArguments(args: unknown, signature: GraphFunctionTemplate) {
  object(args, Object.keys(signature.inputs), [], "Arguments");
  for (const [key, type] of Object.entries(signature.inputs)) {
    requireCondition(validValue((args as Record<string, unknown>)[key], type), "type_mismatch", "Argument has the wrong type: " + key);
  }
}

interface Resolution {
  value?: GraphValue;
  issue?: { code: string; message: string };
  claimIds: string[];
  supportingClaimIds: string[];
}

/** No network, database, model, or action capabilities are available to a program. */
export function executeGraphFunction(input: {
  compiled: CompiledGraphFunction;
  graph: unknown;
  arguments: unknown;
  context: { graphKey: string; asOf: string; expectedSnapshotHash?: string };
}): GraphFunctionResult {
  const plan = graphPlan(input.compiled);
  const definition = plan.definition;
  const graph = normalizeReasoningGraph(input.graph);
  const args = reasoningData(input.arguments);
  validateGraphArguments(args, definition);
  const context = reasoningData(input.context);
  object(context, ["graphKey", "asOf"], ["expectedSnapshotHash"], "Execution context");
  const asOf = timestamp(context.asOf, "Execution asOf");
  requireCondition(context.graphKey === graph.graphKey, "graph_mismatch", "Execution is restricted to the host-selected graph.");
  requireCondition(asOf === timestamp(graph.asOf, "Snapshot asOf"), "snapshot_mismatch", "Execution time must match the frozen snapshot.");
  requireCondition(graph.ontologyResolutionHash === input.compiled.ontologyResolutionHash,
    "ontology_mismatch", "Graph and function ontology versions differ.");
  const snapshotHash = semanticHash(graph);
  requireCondition(context.expectedSnapshotHash === undefined || context.expectedSnapshotHash === snapshotHash,
    "snapshot_mismatch", "Snapshot does not match the host-pinned hash.");
  validateGraphTypes(graph, plan);

  let work = 0;
  const tick = (amount = 1) => {
    work += amount;
    requireCondition(work <= definition.limits.maxWork, "work_limit", "Graph execution exceeded its work budget.");
  };
  const claimsById = new Map(graph.claims.map((claim) => [claim.claimId, claim]));
  const properties = new Map<string, GraphClaim[]>();
  const relations = new Map<string, GraphClaim[]>();
  const key = (...values: string[]) => canonicalJson(values);
  for (const claim of graph.claims) {
    tick();
    if (claim.objectId === undefined) {
      const index = key(claim.subjectId, claim.predicateRef);
      if (!properties.has(index)) properties.set(index, []);
      properties.get(index)!.push(claim);
    } else {
      for (const [direction, entityId] of [["outgoing", claim.subjectId], ["incoming", claim.objectId]]) {
        const index = key(direction, entityId, claim.predicateRef);
        if (!relations.has(index)) relations.set(index, []);
        relations.get(index)!.push(claim);
      }
    }
  }
  const considered = new Set<string>();
  const stepClaims = new Set<string>();
  const exclusions: GraphExclusion[] = [];
  const globalIssues: GraphIssue[] = [];
  const trace: GraphStepTrace[] = [];
  const rowsByStep = new Map<string, Row[]>();
  let scalar: number | null = null;
  const inWindow = (claim: GraphClaim) => Date.parse(claim.observedAt) <= asOf &&
    (!claim.validFrom || Date.parse(claim.validFrom) <= asOf) &&
    (!claim.validUntil || Date.parse(claim.validUntil) > asOf) && claim.status !== "retracted";
  function resolve(claims: GraphClaim[], temporal: boolean, edge: boolean): Resolution {
    tick(claims.length + 1);
    const claimIds = claims.map((claim) => claim.claimId);
    claimIds.forEach((id) => { considered.add(id); stepClaims.add(id); });
    const current = claims.filter(inWindow);
    const issue = (code: string, message: string): Resolution => ({
      claimIds, supportingClaimIds: [], issue: { code, message },
    });
    if (current.some((claim) => claim.status === "disputed")) {
      return issue("conflicting_evidence", "A relevant claim is disputed.");
    }
    const accepted = current.filter((claim) => claim.status === "accepted");
    const fresh = accepted.filter((claim) => !temporal ||
      asOf - Date.parse(claim.observedAt) <= definition.maxAgeSeconds * 1000);
    if (fresh.some((claim) => claim.evidence.length === 0)) {
      return issue("missing_locator", "A current accepted claim has no source evidence locators.");
    }
    const evidenced = fresh.filter((claim) => claim.evidence.length > 0);
    const positive = evidenced.filter((claim) => claim.polarity === "positive");
    const negative = evidenced.filter((claim) => claim.polarity === "negative");
    if (positive.length === 0) {
      if (edge && negative.length > 0) return {
        value: false, claimIds, supportingClaimIds: negative.map((claim) => claim.claimId),
      };
      if (accepted.length > 0 && fresh.length === 0) return issue("stale_evidence", "Accepted evidence is older than the function's freshness bound.");
      if (fresh.length > 0 && evidenced.length === 0) return issue("missing_locator", "Accepted claims have no source evidence locators.");
      return issue("missing_accepted_evidence", "No current, supported positive claim establishes this value.");
    }
    // A newer timestamp does not silently settle disagreement between accepted claims.
    const values = new Map(positive.map((claim) => [canonicalJson(edge ? true : claim.value), edge ? true : claim.value!]));
    if (values.size !== 1 || negative.some((claim) => edge || values.has(canonicalJson(claim.value)))) {
      return issue("conflicting_evidence", "Active accepted claims disagree or contradict one another.");
    }
    return { value: [...values.values()][0], claimIds,
      supportingClaimIds: positive.map((claim) => claim.claimId) };
  }
  const cache = new Map<string, Resolution>();
  function operand(value: GraphOperand, row: Row, stepId: string): { value?: GraphValue; issues: GraphIssue[] } {
    tick();
    if ("argument" in value) return { value: args[value.argument], issues: [] };
    if ("literal" in value) return { value: value.literal, issues: [] };
    if ("entity" in value) return { value: row.bindings[value.entity], issues: [] };
    const entityId = row.bindings[value.binding];
    const index = key(entityId, value.property);
    let resolution = cache.get(index);
    if (!resolution) {
      const property = propertyDefinition(plan, value.property);
      resolution = resolve(properties.get(index) ?? [], property.body.temporal !== false, false);
      cache.set(index, resolution);
    }
    resolution.claimIds.forEach((id) => { considered.add(id); stepClaims.add(id); });
    resolution.supportingClaimIds.forEach((id) => row.claimIds.add(id));
    return {
      value: resolution.value,
      issues: resolution.issue ? [{ ...resolution.issue, stepId, entityId, predicateRef: value.property }] : [],
    };
  }
  const copyRow = (row: Row): Row => ({
    bindings: { ...row.bindings }, values: { ...row.values },
    issues: [...row.issues], claimIds: new Set(row.claimIds),
  });
  const push = (rows: Row[], row: Row) => {
    requireCondition(rows.length < definition.limits.maxRows, "row_limit", "Graph execution exceeded its row budget.");
    rows.push(row);
  };
  if (graph.coverage === "partial") {
    globalIssues.push({ code: "incomplete_view", message: "The host has not established complete coverage for this graph view.", stepId: "snapshot" });
  }
  for (const step of definition.steps) {
    stepClaims.clear();
    const source = "from" in step ? rowsByStep.get(step.from)! : [];
    const rows: Row[] = [];
    tick();
    if (step.op === "lookup") {
      const empty: Row = { bindings: {}, values: {}, issues: [], claimIds: new Set() };
      const requested = step.entityId ? operand(step.entityId, empty, step.id).value : undefined;
      for (const entity of graph.entities) {
        tick();
        if (assignable(plan.definitions, entity.typeRef, step.typeRef) &&
          (requested === undefined || requested === entity.entityId)) {
          push(rows, { bindings: { [step.as]: entity.entityId }, values: {}, issues: [], claimIds: new Set() });
        }
      }
      if (requested !== undefined && rows.length === 0) globalIssues.push({
        code: "unknown_entity", message: "The requested entity is absent from the authorized view.", stepId: step.id,
      });
    } else if (step.op === "traverse") {
      for (const original of source) {
        tick();
        const groups = new Map<string, GraphClaim[]>();
        for (const claim of relations.get(key(step.direction, original.bindings[step.source], step.relation)) ?? []) {
          tick();
          if (!inWindow(claim)) continue;
          const target = step.direction === "outgoing" ? claim.objectId! : claim.subjectId;
          if (!groups.has(target)) groups.set(target, []);
          groups.get(target)!.push(claim);
        }
        for (const [target, claims] of [...groups.entries()].sort(([a], [b]) => compareCanonicalStrings(a, b))) {
          const resolved = resolve(claims, true, true);
          const row = copyRow(original);
          row.bindings[step.as] = target;
          resolved.supportingClaimIds.forEach((id) => row.claimIds.add(id));
          if (resolved.value === false) {
            exclusions.push({ stepId: step.id, bindings: row.bindings, reason: "An accepted negative claim excludes this relation.", claimIds: [...row.claimIds].sort() });
          } else {
            if (resolved.issue) row.issues.push({ ...resolved.issue, stepId: step.id, entityId: target, predicateRef: step.relation });
            push(rows, row);
          }
        }
      }
    } else if (step.op === "filter") {
      for (const original of source) {
        tick();
        const row = copyRow(original);
        let rejected = false;
        const failed: number[] = [];
        for (const [index, condition] of step.all.entries()) {
          const left = operand(condition.left, row, step.id);
          const right = operand(condition.right, row, step.id);
          row.issues.push(...left.issues, ...right.issues);
          if (left.value === undefined || right.value === undefined) continue;
          let matches: boolean;
          switch (condition.operator) {
            case "eq": matches = canonicalJson(left.value) === canonicalJson(right.value); break;
            case "neq": matches = canonicalJson(left.value) !== canonicalJson(right.value); break;
            case "contains": matches = (left.value as string[]).includes(right.value as string); break;
            case "gt": matches = (left.value as number) > (right.value as number); break;
            case "gte": matches = (left.value as number) >= (right.value as number); break;
            case "lt": matches = (left.value as number) < (right.value as number); break;
            case "lte": matches = (left.value as number) <= (right.value as number); break;
          }
          if (!matches) { rejected = true; failed.push(index); }
        }
        if (rejected) exclusions.push({
          stepId: step.id, bindings: row.bindings,
          reason: "Failed filter conditions: " + failed.join(", "), claimIds: [...row.claimIds].sort(),
        });
        else push(rows, row);
      }
    } else if (step.op === "project") {
      for (const original of source) {
        tick();
        const row = copyRow(original);
        for (const [field, value] of Object.entries(step.fields)) {
          const resolved = operand(value, row, step.id);
          row.issues.push(...resolved.issues);
          if (resolved.value !== undefined) row.values[field] = resolved.value;
        }
        push(rows, row);
      }
    } else {
      tick(source.length);
      source.forEach((row) => globalIssues.push(...row.issues));
      if (step.operation === "count") scalar = source.length;
      else if (source.length === 0 && step.operation !== "sum") {
        globalIssues.push({ code: "empty_aggregate", message: "This aggregate has no defined value over an empty collection.", stepId: step.id });
      } else {
        const values = source.map((row) => row.values[step.field!] as number);
        if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
          if (step.operation === "min") scalar = Math.min(...values);
          else if (step.operation === "max") scalar = Math.max(...values);
          else {
            scalar = values.reduce((sum, value) => sum + value, 0);
            if (step.operation === "mean") scalar /= values.length;
          }
          if (!Number.isFinite(scalar)) {
            scalar = null;
            globalIssues.push({ code: "numeric_overflow", message: "Aggregate exceeded finite numeric precision.", stepId: step.id });
          }
        }
      }
    }
    rowsByStep.set(step.id, rows);
    trace.push({
      stepId: step.id, operator: step.op, inputRows: source.length,
      outputRows: step.op === "aggregate" ? 1 : rows.length,
      claimIds: [...stepClaims].sort(),
      outputHash: semanticHash(step.op === "aggregate" ? scalar : rows.map((row) => ({
        bindings: row.bindings, values: row.values, issues: row.issues, claimIds: [...row.claimIds].sort(),
      }))),
    });
  }
  const resultRows = rowsByStep.get(definition.return)!;
  const issues = [...new Map([...globalIssues, ...resultRows.flatMap((row) => row.issues)]
    .map((issue) => [canonicalJson(issue), issue])).entries()]
    .sort(([a], [b]) => compareCanonicalStrings(a, b)).map(([, issue]) => issue);
  const value = issues.length > 0 ? null : definition.output.kind === "scalar" ? scalar :
    resultRows.map((row) => row.values).sort((a, b) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b)));
  const finalStep = definition.steps.at(-1)!;
  const supportRows = finalStep.op === "aggregate" ? rowsByStep.get(finalStep.from)! : resultRows;
  const supportingClaimIds = issues.length > 0 ? [] : [...new Set(supportRows.flatMap((row) => [...row.claimIds]))].sort();
  const result: Omit<GraphFunctionResult, "resultHash"> = {
    resultVersion: "t2k.graph-result.v1", status: issues.length > 0 ? "needs_review" : "complete",
    value, authorization: "not_authorized",
    binding: {
      runtimeVersion: input.compiled.runtimeVersion, functionHash: input.compiled.functionHash,
      ontologyResolutionHash: input.compiled.ontologyResolutionHash, graphKey: graph.graphKey,
      asOf: graph.asOf, snapshotHash, argumentsHash: semanticHash(args),
    },
    evidence: [...considered].sort().map((id) => {
      const claim = claimsById.get(id)!;
      return { claimId: id, revision: claim.revision, status: claim.status, polarity: claim.polarity, evidence: claim.evidence };
    }),
    supportingClaimIds,
    derivations: issues.length > 0 || definition.output.kind === "scalar" ? [] : resultRows.map((row) => ({
      rowHash: semanticHash(row.values), claimIds: [...row.claimIds].sort(),
    })).sort((a, b) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b))),
    exclusions, issues, trace, work,
  };
  return { ...result, resultHash: semanticHash(result) };
}
