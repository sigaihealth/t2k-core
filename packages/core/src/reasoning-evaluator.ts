import { canonicalJson, compareCanonicalStrings, semanticHash, type CompileOntologyPackSetInput } from "./compiler.js";
import { graphFunctionTemplatePlan, graphPlan, type GraphPlan } from "./reasoning-compiler.js";
import {
  array, GraphFunctionError, identifier, integer, literalType, object,
  reasoningData, requireCondition, validValue,
} from "./reasoning-input.js";
import { executeGraphFunction, normalizeReasoningGraph, validateGraphArguments, validateGraphTypes } from "./reasoning-runtime.js";
import type {
  CompiledGraphFunction, GraphEvaluationInputCase, GraphEvaluationResult,
  GraphEvaluationCase, GraphEvaluationScore, GraphEvaluationSuite, GraphFailureCase, GraphFunctionResult, GraphFunctionTemplate, GraphRow,
} from "./reasoning-types.js";
import type { GraphSynthesisDiagnostic } from "./reasoning-synthesis.js";

/** Optional exact claim-set roles supported by this evaluator; absent roles remain required subsets. */
export const GRAPH_EVALUATION_CLAIM_SET_MATCHING = Object.freeze(["supporting", "considered"] as const);
/** Explicitly reviewable aborted outcomes; every other error remains a failed execution. */
export const GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS = Object.freeze(["row_limit", "work_limit"] as const);

function valueRows(value: any) {
  array(value, 2_000, "Expected rows");
  for (const row of value) {
    requireCondition(row && typeof row === "object" && !Array.isArray(row),
      "invalid_contract", "Expected values must be scalar literals or flat rows.");
    requireCondition(Object.keys(row).length <= 32, "input_limit", "Too many expected fields.");
    for (const [field, item] of Object.entries(row)) {
      identifier(field, "Expected field");
      literalType(item);
    }
  }
  value.sort((a: any, b: any) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b)));
}

function caseFingerprint(item: GraphEvaluationInputCase) {
  return semanticHash({ graph: item.graph, arguments: item.arguments });
}

function uniqueIds(value: any, label: string) {
  array(value, 100, label);
  value.forEach((id: any) => identifier(id, label));
  requireCondition(new Set(value).size === value.length, "invalid_contract", label + " must be unique.");
  value.sort();
}

export function normalizeGraphEvaluationSuite(value: unknown): GraphEvaluationSuite {
  const suite = reasoningData(value);
  object(suite, ["suiteVersion", "suiteId", "revision", "thresholds", "trainingCases", "cases"], [], "Evaluation suite");
  requireCondition(suite.suiteVersion === "t2k.graph-evaluation.v2", "invalid_contract",
    "Evaluation requires v2 explicit evidence roles; legacy requiredClaimIds must be reviewed, not automatically migrated.");
  identifier(suite.suiteId, "Suite id");
  identifier(suite.revision, "Suite revision");
  object(suite.thresholds, ["minimumCases", "minimumAccuracy", "minimumImprovement"]);
  integer(suite.thresholds.minimumCases, 1, 100, "minimumCases");
  requireCondition(typeof suite.thresholds.minimumAccuracy === "number" &&
    suite.thresholds.minimumAccuracy > 0 && suite.thresholds.minimumAccuracy <= 1 &&
    typeof suite.thresholds.minimumImprovement === "number" &&
    suite.thresholds.minimumImprovement >= 0 && suite.thresholds.minimumImprovement <= 1,
    "invalid_contract", "Evaluation thresholds must be finite fractions.");
  array(suite.trainingCases, 100, "Training cases");
  array(suite.cases, 100, "Evaluation cases");
  requireCondition(suite.cases.length > 0, "invalid_contract", "Evaluation cases cannot be empty.");
  const ids = new Set<string>();
  const inputs = new Set<string>();
  for (const [cohort, cases] of [["training", suite.trainingCases], ["evaluation", suite.cases]] as const) {
    for (const item of cases) {
      object(item, cohort === "training" ? ["caseId", "graph", "arguments"] :
        ["caseId", "graph", "arguments", "expected", "forbiddenRows"]);
      identifier(item.caseId, "Case id");
      requireCondition(!ids.has(item.caseId), "overlapping_cases", "Training and evaluation identifiers must be unique and disjoint.");
      ids.add(item.caseId);
      item.graph = normalizeReasoningGraph(item.graph);
      requireCondition(item.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments),
        "invalid_contract", "Case arguments must be an object.");
      for (const [name, argument] of Object.entries(item.arguments)) {
        identifier(name, "Case argument"); literalType(argument);
      }
      const fingerprint = caseFingerprint(item);
      requireCondition(!inputs.has(fingerprint), "overlapping_cases", "Duplicate case inputs cannot be relabeled as independent holdout evidence.");
      inputs.add(fingerprint);
      if (cohort === "evaluation") {
        object(item.expected, ["status", "value", "evidence"], ["errorCode"]);
        requireCondition(["complete", "needs_review", "resource_limit"].includes(item.expected.status),
          "invalid_contract", "Unsupported expected result status.");
        if (item.expected.status === "resource_limit") {
          requireCondition(GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS.includes(item.expected.errorCode),
            "invalid_contract", "Resource-limit labels require errorCode row_limit or work_limit.");
          requireCondition(item.expected.value === null, "invalid_contract", "Resource-limit expected values must be null.");
        } else {
          requireCondition(!Object.hasOwn(item.expected, "errorCode"), "invalid_contract", "Normal result labels cannot declare an errorCode.");
        }
        if (item.expected.status === "needs_review") {
          requireCondition(item.expected.value === null, "invalid_contract", "Unresolved expected values must be null.");
        } else if (item.expected.status === "complete" && typeof item.expected.value === "number") {
          requireCondition(Number.isFinite(item.expected.value), "invalid_contract", "Expected scalar must be finite.");
        } else if (item.expected.status === "complete") valueRows(item.expected.value);
        const evidence = item.expected.evidence;
        object(evidence, ["supportingClaimIds", "consideredClaimIds", "exclusions", "rows"], ["claimSetMatching"]);
        if (evidence.claimSetMatching !== undefined) {
          object(evidence.claimSetMatching, [], [...GRAPH_EVALUATION_CLAIM_SET_MATCHING], "Claim-set matching");
          requireCondition(Object.keys(evidence.claimSetMatching).length > 0 &&
            Object.values(evidence.claimSetMatching).every((mode) => mode === "exact"),
          "invalid_contract", "Claim-set matching must opt in at least one known role with mode exact.");
        }
        uniqueIds(evidence.supportingClaimIds, "Supporting evidence ids");
        uniqueIds(evidence.consideredClaimIds, "Considered evidence ids");
        array(evidence.exclusions, 100, "Exclusion evidence assertions");
        for (const exclusion of evidence.exclusions) {
          object(exclusion, ["entityIds", "claimIds"]);
          uniqueIds(exclusion.entityIds, "Excluded entity ids");
          requireCondition(exclusion.entityIds.length > 0, "invalid_contract", "An exclusion must identify at least one entity.");
          uniqueIds(exclusion.claimIds, "Exclusion evidence ids");
        }
        array(evidence.rows, 100, "Row evidence assertions");
        const rowHashes = new Set<string>();
        for (const assertion of evidence.rows) {
          object(assertion, ["row", "claimIds"]);
          valueRows([assertion.row]);
          uniqueIds(assertion.claimIds, "Row evidence ids");
          const rowHash = semanticHash(assertion.row);
          requireCondition(!rowHashes.has(rowHash), "invalid_contract", "Each expected row can have only one evidence assertion.");
          rowHashes.add(rowHash);
        }
        evidence.exclusions.sort((a: any, b: any) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b)));
        evidence.rows.sort((a: any, b: any) => compareCanonicalStrings(canonicalJson(a), canonicalJson(b)));
        if (evidence.claimSetMatching?.supporting === "exact") {
          requireCondition(evidence.rows.every((assertion: { claimIds: string[] }) =>
            assertion.claimIds.every((id) => evidence.supportingClaimIds.includes(id))),
          "invalid_contract", "Exact supporting claims must include every required returned-row claim.");
        }
        if (evidence.claimSetMatching?.considered === "exact") {
          const required = [...evidence.supportingClaimIds,
            ...evidence.rows.flatMap((assertion: { claimIds: string[] }) => assertion.claimIds),
            ...evidence.exclusions.flatMap((assertion: { claimIds: string[] }) => assertion.claimIds)];
          requireCondition(required.every((id) => evidence.consideredClaimIds.includes(id)),
            "invalid_contract", "Exact considered claims must include every required supporting, returned-row and exclusion claim.");
        }
        valueRows(item.forbiddenRows);
        requireCondition(item.forbiddenRows.every((row: GraphRow) => Object.keys(row).length > 0),
          "invalid_contract", "A forbidden row must name at least one field.");
        if (item.expected.status === "resource_limit") {
          requireCondition(!Object.hasOwn(evidence, "claimSetMatching") &&
            [evidence.supportingClaimIds, evidence.consideredClaimIds, evidence.exclusions, evidence.rows, item.forbiddenRows]
              .every((items) => items.length === 0),
          "invalid_contract", "Resource-limit labels require empty evidence and forbidden rows, without claim-set matching; no receipt is produced.");
        }
      }
    }
    cases.sort((a: any, b: any) => compareCanonicalStrings(a.caseId, b.caseId));
  }
  return suite;
}

function validateSuiteAgainstSignature(suite: GraphEvaluationSuite, template: GraphFunctionTemplate,
  plan: Pick<GraphPlan, "definitions">): GraphEvaluationSuite {
  function rowSignature(row: GraphRow, partial = false) {
    requireCondition(template.output.kind === "rows", "type_mismatch", "Row labels require a row output signature.");
    object(row, partial ? [] : Object.keys(template.output.fields), partial ? Object.keys(template.output.fields) : [], "Expected row");
    for (const [field, value] of Object.entries(row)) {
      requireCondition(validValue(value, template.output.fields[field]), "type_mismatch", "Expected row has the wrong type: " + field);
    }
  }
  for (const item of [...suite.trainingCases, ...suite.cases]) {
    requireCondition(item.graph.ontologyResolutionHash === template.ontologyResolutionHash,
      "ontology_mismatch", "Every case must use the pinned function ontology.");
    validateGraphTypes(item.graph, plan);
    validateGraphArguments(item.arguments, template);
  }
  for (const item of suite.cases) {
    const { expected } = item;
    // Training entries above are unexecuted input fingerprints. Generation validates its
    // labelled development cases as suite.cases, so only an explicit work-limit label
    // may bypass this prediction for an actual execution target.
    requireCondition((expected.status === "resource_limit" && expected.errorCode === "work_limit") ||
      item.graph.claims.length < template.limits.maxWork, "invalid_contract",
    "Case graph already exceeds the work budget before any function can execute.");
    const evidence = expected.evidence;
    if (expected.status === "complete") {
      requireCondition(item.graph.coverage === "complete", "invalid_contract", "A partial graph cannot label a completed result.");
      if (template.output.kind === "scalar") {
        requireCondition(typeof expected.value === "number" && Number.isFinite(expected.value),
          "type_mismatch", "Expected value must match the numeric scalar output.");
      } else {
        requireCondition(Array.isArray(expected.value), "type_mismatch", "Expected value must match the row output.");
        requireCondition(expected.value.length <= template.limits.maxRows, "invalid_contract", "Expected rows exceed the function row budget.");
        expected.value.forEach((row) => rowSignature(row));
      }
    }
    requireCondition(expected.status === "complete" || (evidence.supportingClaimIds.length === 0 && evidence.rows.length === 0),
      "invalid_contract", "Unresolved results cannot have supporting or returned-row evidence; use considered evidence or exclusions.");
    requireCondition(!Array.isArray(expected.value) || expected.value.length > 0 || evidence.supportingClaimIds.length === 0,
      "invalid_contract", "An empty row result cannot have answer-supporting evidence; use exclusion evidence.");
    const claims = new Map(item.graph.claims.map((claim) => [claim.claimId, claim]));
    const entities = new Set(item.graph.entities.map((entity) => entity.entityId));
    const checkClaims = (ids: string[], supporting = false) => {
      for (const id of ids) {
        const claim = claims.get(id);
        requireCondition(claim, "invalid_contract", "Evidence assertion references a claim absent from its case: " + id);
        if (supporting) {
          const asOf = Date.parse(item.graph.asOf);
          const temporal = plan.definitions.get(claim.predicateRef)?.body.temporal !== false;
          requireCondition(claim.status === "accepted" && claim.polarity === "positive" && claim.evidence.length > 0 &&
            Date.parse(claim.observedAt) <= asOf && (!claim.validFrom || Date.parse(claim.validFrom) <= asOf) &&
            (!claim.validUntil || Date.parse(claim.validUntil) > asOf) &&
            (!temporal || asOf - Date.parse(claim.observedAt) <= template.maxAgeSeconds * 1000),
          "invalid_contract", "Supporting evidence must be current, accepted, positive, and sourced: " + id);
        }
      }
    };
    checkClaims(evidence.supportingClaimIds, true);
    checkClaims(evidence.consideredClaimIds);
    for (const assertion of evidence.exclusions) {
      requireCondition(assertion.entityIds.every((id) => entities.has(id)), "invalid_contract", "Exclusion refers to an absent entity.");
      checkClaims(assertion.claimIds);
    }
    for (const assertion of evidence.rows) {
      rowSignature(assertion.row);
      requireCondition(Array.isArray(expected.value) && expected.value.some((row) => canonicalJson(row) === canonicalJson(assertion.row)),
        "invalid_contract", "Row evidence must refer to a complete expected output row.");
      checkClaims(assertion.claimIds, true);
    }
    item.forbiddenRows.forEach((row) => rowSignature(row, true));
    requireCondition(!Array.isArray(expected.value) || expected.value.every((row) => !item.forbiddenRows.some((forbidden) =>
      Object.entries(forbidden).every(([field, value]) => canonicalJson(row[field]) === canonicalJson(value)))),
    "invalid_contract", "An expected output row contradicts a forbidden-row constraint.");
  }
  return suite;
}

/** Validate all frozen cases before generation or evaluation, without executing any candidate. */
export function preflightGraphEvaluationSuite(input: {
  ontology: CompileOntologyPackSetInput; template: unknown; suite: unknown;
}): GraphEvaluationSuite {
  const plan = graphFunctionTemplatePlan({ ontology: input.ontology, template: input.template });
  return validateSuiteAgainstSignature(normalizeGraphEvaluationSuite(input.suite), plan.template, plan);
}

/** The independent harness must pin this hash before constructing candidates. */
export function computeGraphEvaluationSuiteHash(suite: unknown) {
  return semanticHash(normalizeGraphEvaluationSuite(suite));
}

function claimSetDifference(expected: string[], actual: string[]) {
  const expectedSet = new Set(expected), actualSet = new Set(actual);
  return {
    missing: [...expectedSet].filter((id) => !actualSet.has(id)).sort(),
    extra: [...actualSet].filter((id) => !expectedSet.has(id)).sort(),
  };
}

function developmentDiagnostics(item: GraphEvaluationCase, result: GraphFunctionResult | null, actualError: string | null = null): GraphSynthesisDiagnostic[] {
  if (item.expected.status === "resource_limit") {
    const repairable = actualError === null || GRAPH_EVALUATION_RESOURCE_LIMIT_ERRORS.some(code => code === actualError);
    return [{
      code: repairable ? "resource_limit_mismatch" : "execution_failed", category: repairable ? "answer" : "data",
      action: repairable ? "repair_program" : "review_contract", path: item.caseId,
      message: repairable
        ? "Execution did not raise the reviewed resource-limit error. Repair the program without changing frozen limits or labels."
        : "Execution failed outside the reviewed resource-limit outcomes. Review the contract or runtime before retrying.",
      details: { expectedError: item.expected.errorCode, actualError, actualStatus: result?.status ?? null },
    }];
  }
  if (!result) return [{ code: "execution_failed", category: "data", action: "review_contract", path: item.caseId,
    message: "Execution failed before producing a receipt; inspect the recorded execution error." }];
  const entries: GraphSynthesisDiagnostic[] = [];
  const add = (code: string, category: GraphSynthesisDiagnostic["category"], action: GraphSynthesisDiagnostic["action"], message: string, details: unknown) =>
    entries.push({ code, category, action, path: item.caseId, message, details });
  const sample = (items: unknown[]) => ({ total: items.length, omitted: Math.max(0, items.length - 3), truncated: items.length > 3, samples: items.slice(0, 3) });
  if (item.expected.status !== result.status) add("status_mismatch", "answer", "repair_program", "Computed status differs from the reviewed label.", { expected: item.expected.status, actual: result.status });
  if (canonicalJson(item.expected.value) !== canonicalJson(result.value)) {
    if (Array.isArray(item.expected.value) && Array.isArray(result.value)) {
      const subtract = (left: GraphRow[], right: GraphRow[]) => {
        const counts = new Map<string, number>();
        right.forEach((row) => { const key = canonicalJson(row); counts.set(key, (counts.get(key) ?? 0) + 1); });
        return left.filter((row) => { const key = canonicalJson(row), count = counts.get(key) ?? 0; if (count) { counts.set(key, count - 1); return false; } return true; });
      };
      add("answer_rows_mismatch", "answer", "repair_program", "Returned rows differ, preserving duplicate multiplicity.", {
        missing: sample(subtract(item.expected.value, result.value)), extra: sample(subtract(result.value, item.expected.value)),
        trace: sample(result.trace.slice(-3)),
      });
    } else add("answer_value_mismatch", "answer", "repair_program", "Computed value differs from the reviewed label.", { expected: item.expected.value, actual: result.value, trace: sample(result.trace.slice(-3)) });
  }
  const evidence = item.expected.evidence;
  const missingSupporting = evidence.supportingClaimIds.filter((id) => !result.supportingClaimIds.includes(id));
  if (evidence.claimSetMatching?.supporting === "exact") {
    const { missing, extra } = claimSetDifference(evidence.supportingClaimIds, result.supportingClaimIds);
    if (missing.length || extra.length) add("supporting_evidence_mismatch", "evidence", "repair_program", "Answer-supporting claims differ from the exact reviewed set.", { missing: sample(missing), extra: sample(extra) });
  } else if (missingSupporting.length) add("supporting_evidence_mismatch", "evidence", "repair_program", "Required answer-supporting claims are missing.", { missing: sample(missingSupporting) });
  const missingConsidered = evidence.consideredClaimIds.filter((id) => !result.evidence.some((claim) => claim.claimId === id));
  if (evidence.claimSetMatching?.considered === "exact") {
    const { missing, extra } = claimSetDifference(evidence.consideredClaimIds, result.evidence.map((claim) => claim.claimId));
    if (missing.length || extra.length) add("considered_evidence_mismatch", "evidence", "repair_program", "Considered claims differ from the exact reviewed set.", { missing: sample(missing), extra: sample(extra) });
  } else if (missingConsidered.length) add("considered_evidence_mismatch", "evidence", "repair_program", "Required considered claims were not inspected.", { missing: sample(missingConsidered) });
  const missingExclusions = evidence.exclusions.filter((assertion) => !result.exclusions.some((exclusion) =>
    assertion.entityIds.every((id) => Object.values(exclusion.bindings).includes(id)) && assertion.claimIds.every((id) => exclusion.claimIds.includes(id))));
  if (missingExclusions.length) add("exclusion_evidence_mismatch", "evidence", "repair_program", "Required exclusion evidence is missing.", { missing: sample(missingExclusions) });
  const missingRows = evidence.rows.filter((assertion) => !result.derivations.some((derivation) =>
    derivation.rowHash === semanticHash(assertion.row) && assertion.claimIds.every((id) => derivation.claimIds.includes(id))));
  if (missingRows.length) add("row_evidence_mismatch", "evidence", "repair_program", "Required evidence does not support the designated returned row.", { missing: sample(missingRows) });
  if (Array.isArray(result.value)) {
    const forbidden = result.value.filter((row) => item.forbiddenRows.some((constraint) => Object.entries(constraint).every(([field, value]) => canonicalJson(row[field]) === canonicalJson(value))));
    if (forbidden.length) add("hard_constraint_violation", "answer", "repair_program", "Returned options violate designated forbidden-row constraints.", { forbidden: sample(forbidden), constraints: sample(item.forbiddenRows) });
  }
  if (result.issues.length) add("data_or_contract_issue", "data", "request_data", "Missing, stale, conflicting or unsupported evidence requires data or contract review; do not relabel cases during repair.", {
    issues: sample(result.issues), codes: [...new Set(result.issues.map((issue) => issue.code))].sort(),
  });
  return entries;
}

function score(compiled: CompiledGraphFunction, suite: GraphEvaluationSuite, includeDiagnostics = false): GraphEvaluationScore {
  const failures: GraphFailureCase[] = [];
  const runs: GraphEvaluationScore["runs"] = [];
  let passedCases = 0;
  let hardConstraintViolations = 0;
  for (const item of suite.cases) {
    const reasons: string[] = [];
    let result: GraphFunctionResult | null = null;
    let category: GraphFailureCase["category"] = "function";
    let actualError: string | null = null;
    try {
      result = executeGraphFunction({
        compiled, graph: item.graph, arguments: item.arguments,
        context: {
          graphKey: item.graph.graphKey, asOf: item.graph.asOf,
          expectedSnapshotHash: semanticHash(item.graph),
        },
      });
      if (item.expected.status === "resource_limit") {
        category = "execution";
        reasons.push("Expected " + item.expected.errorCode + ", but execution returned " + result.status + ".");
      } else {
        if (result.status !== item.expected.status) reasons.push("Result status does not match the labeled case.");
        if (canonicalJson(result.value) !== canonicalJson(item.expected.value)) reasons.push("Computed value does not match the labeled case.");
        const evidence = item.expected.evidence;
        if (!evidence.supportingClaimIds.every((id) => result!.supportingClaimIds.includes(id)))
          reasons.push("Required supporting evidence did not support the completed answer.");
        if (!evidence.consideredClaimIds.every((id) => result!.evidence.some((entry) => entry.claimId === id)))
          reasons.push("Required considered evidence was not inspected by execution.");
        if (evidence.claimSetMatching?.supporting === "exact" &&
          claimSetDifference(evidence.supportingClaimIds, result.supportingClaimIds).extra.length)
          reasons.push("Additional supporting evidence is outside the exact reviewed claim set.");
        if (evidence.claimSetMatching?.considered === "exact" &&
          claimSetDifference(evidence.consideredClaimIds, result.evidence.map((entry) => entry.claimId)).extra.length)
          reasons.push("Additional considered evidence is outside the exact reviewed claim set.");
        if (!evidence.exclusions.every((assertion) => result!.exclusions.some((exclusion) =>
          assertion.entityIds.every((id) => Object.values(exclusion.bindings).includes(id)) &&
          assertion.claimIds.every((id) => exclusion.claimIds.includes(id)))))
          reasons.push("Required exclusion evidence did not establish the designated exclusion.");
        if (!evidence.rows.every((assertion) => result!.derivations.some((derivation) =>
          derivation.rowHash === semanticHash(assertion.row) && assertion.claimIds.every((id) => derivation.claimIds.includes(id)))))
          reasons.push("Required row evidence did not support its designated returned row.");
        if (Array.isArray(result.value)) {
          for (const row of result.value) {
            if (item.forbiddenRows.some((forbidden) => Object.entries(forbidden)
              .every(([field, value]) => Object.hasOwn(row, field) && canonicalJson(row[field]) === canonicalJson(value)))) {
              hardConstraintViolations++;
              reasons.push("A returned option violates a designated hard constraint.");
            }
          }
        }
        if (result.issues.some((issue) => issue.code === "conflicting_evidence")) category = "conflict";
        else if (result.issues.some((issue) => issue.code === "stale_evidence")) category = "freshness";
        else if (result.issues.length > 0) category = "evidence";
      }
    } catch (error) {
      category = "execution";
      actualError = error instanceof GraphFunctionError ? error.code : "execution_failed";
      if (item.expected.status === "resource_limit") {
        if (!(error instanceof GraphFunctionError) || error.code !== item.expected.errorCode) reasons.push(
          error instanceof GraphFunctionError
            ? "Expected " + item.expected.errorCode + ", but execution raised " + error.code + ": " + error.message
            : "Expected " + item.expected.errorCode + ", but execution failed without a typed graph error.");
      } else reasons.push(error instanceof GraphFunctionError ? error.code + ": " + error.message : "Execution failed.");
    }
    const passed = reasons.length === 0;
    if (passed) passedCases++;
    else {
      const failure = {
        caseId: item.caseId, category, reasons,
        resultHash: result?.resultHash ?? null, issues: result?.issues ?? [],
        ...(item.expected.status === "resource_limit" ? { expectedError: item.expected.errorCode, actualError } : {}),
        ...(includeDiagnostics ? { diagnostics: developmentDiagnostics(item, result, actualError), result } : {}),
      };
      failures.push({ ...failure, failureHash: semanticHash({ ...failure, functionHash: compiled.functionHash, inputHash: caseFingerprint(item) }) });
    }
    runs.push({ caseId: item.caseId, passed, resultHash: result?.resultHash ?? null,
      ...(item.expected.status === "resource_limit" ? { expectedError: item.expected.errorCode, actualError } : {}) });
  }
  return { passedCases, totalCases: suite.cases.length, accuracy: passedCases / suite.cases.length,
    hardConstraintViolations, failures, runs };
}

/**
 * Computes labeled task correctness, not causal outcome improvement or promotion.
 * The host must own the suite/hash and keep final cases outside candidate search.
 */
export function evaluateGraphFunction(input: {
  candidate: CompiledGraphFunction;
  baseline?: CompiledGraphFunction;
  suite: unknown;
  expectedSuiteHash: string;
  /** Include development-only differences and full failure receipts. Omitted by default. */
  includeDiagnostics?: boolean;
}): GraphEvaluationResult {
  graphPlan(input.candidate);
  if (input.baseline) graphPlan(input.baseline);
  const suite = normalizeGraphEvaluationSuite(input.suite);
  const suiteHash = semanticHash(suite);
  requireCondition(suiteHash === input.expectedSuiteHash, "evaluation_contract_mismatch",
    "Evaluation suite differs from the independently pinned acceptance contract.");
  validateSuiteAgainstSignature(suite, input.candidate.definition, graphPlan(input.candidate));
  if (input.baseline) {
    requireCondition(input.candidate.ontologyResolutionHash === input.baseline.ontologyResolutionHash,
      "ontology_mismatch", "This evaluator compares functions on one ontology; schema migration needs a separate evaluator.");
    requireCondition(input.candidate.functionRef === input.baseline.functionRef &&
      canonicalJson(input.candidate.definition.inputs) === canonicalJson(input.baseline.definition.inputs) &&
      canonicalJson(input.candidate.definition.output) === canonicalJson(input.baseline.definition.output),
      "type_mismatch", "Candidate and baseline must implement the same function signature.");
    validateSuiteAgainstSignature(suite, input.baseline.definition, graphPlan(input.baseline));
  }
  const candidate = score(input.candidate, suite, input.includeDiagnostics);
  const baseline = input.baseline ? score(input.baseline, suite, input.includeDiagnostics) : null;
  const improvement = baseline ? candidate.accuracy - baseline.accuracy : null;
  const reasons: string[] = [];
  if (suite.cases.length < suite.thresholds.minimumCases) reasons.push("Insufficient independent evaluation cases.");
  if (candidate.accuracy < suite.thresholds.minimumAccuracy) reasons.push("Candidate accuracy is below the pinned threshold.");
  if (candidate.hardConstraintViolations > 0) reasons.push("A designated hard constraint failed.");
  if (suite.thresholds.minimumImprovement > 0 && improvement === null) reasons.push("The improvement gate requires a baseline.");
  if (improvement !== null && improvement + Number.EPSILON < suite.thresholds.minimumImprovement) reasons.push("Improvement is below the pinned threshold.");
  const result: Omit<GraphEvaluationResult, "evaluationHash"> = {
    evaluationVersion: "t2k.graph-evaluation-result.v2", evaluationSource: "graph_runtime",
    status: reasons.length === 0 ? "passed" : "failed", authorization: "not_authorized",
    suiteHash, candidateHash: input.candidate.functionHash, baselineHash: input.baseline?.functionHash ?? null,
    candidate, baseline, improvement, reasons,
  };
  return { ...result, evaluationHash: semanticHash(result) };
}
