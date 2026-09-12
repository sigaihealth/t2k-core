/** Experimental contracts; independent of the normative ontology-pack schema. */
export type GraphValue = string | number | boolean | string[];
export type GraphValueType = "string" | "number" | "integer" | "boolean" | "string_list";
export type GraphRow = Record<string, GraphValue>;

export type GraphOperand =
  | { argument: string }
  | { literal: GraphValue }
  | { entity: string }
  | { binding: string; property: string };

export interface GraphCondition {
  left: GraphOperand;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains";
  right: GraphOperand;
}

export type GraphStep =
  | { id: string; op: "lookup"; typeRef: string; as: string; entityId?: GraphOperand }
  | { id: string; op: "traverse"; from: string; source: string; relation: string;
      direction: "outgoing" | "incoming"; as: string }
  | { id: string; op: "filter"; from: string; all: GraphCondition[] }
  /** Collapse paths by this entity id, retaining only its binding and all path evidence/issues. */
  | { id: string; op: "distinct"; from: string; binding: string }
  | { id: string; op: "project"; from: string; fields: Record<string, GraphOperand> }
  | { id: string; op: "aggregate"; from: string;
      operation: "count" | "sum" | "min" | "max" | "mean"; field?: string };

export type GraphOutputContract =
  | { kind: "rows"; fields: Record<string, GraphValueType> }
  | { kind: "scalar"; valueType: "number" };

export interface GraphFunctionDefinition {
  artifactVersion: "t2k.graph-function.v1";
  functionRef: string;
  ontologyResolutionHash: string;
  inputs: Record<string, GraphValueType>;
  output: GraphOutputContract;
  steps: GraphStep[];
  return: string;
  maxAgeSeconds: number;
  limits: { maxRows: number; maxWork: number };
}

export type GraphFunctionTemplate = Omit<GraphFunctionDefinition, "steps" | "return">;

export interface CompiledGraphFunction {
  readonly runtimeVersion: "t2k.graph-runtime.v1";
  readonly functionRef: string;
  readonly functionHash: string;
  readonly ontologyResolutionHash: string;
  readonly definition: Readonly<GraphFunctionDefinition>;
}

export interface GraphEntity {
  entityId: string;
  typeRef: string;
}

export interface GraphEvidence {
  sourceRef: string;
  locator: string;
}

export interface GraphClaim {
  claimId: string;
  revision: string;
  subjectId: string;
  predicateRef: string;
  value?: GraphValue;
  objectId?: string;
  status: "accepted" | "proposed" | "disputed" | "retracted";
  polarity: "positive" | "negative";
  observedAt: string;
  validFrom?: string;
  validUntil?: string;
  evidence: GraphEvidence[];
}

export interface ReasoningGraphSnapshot {
  snapshotVersion: "t2k.reasoning-graph.v1";
  graphKey: string;
  asOf: string;
  ontologyResolutionHash: string;
  /** A trusted adapter's assertion about this authorized view, not inferred coverage. */
  coverage: "complete" | "partial";
  entities: GraphEntity[];
  claims: GraphClaim[];
}

export interface GraphIssue {
  code: string;
  message: string;
  stepId: string;
  entityId?: string;
  predicateRef?: string;
}

export interface GraphClaimEvidence {
  claimId: string;
  revision: string;
  status: GraphClaim["status"];
  polarity: GraphClaim["polarity"];
  evidence: GraphEvidence[];
}

export interface GraphExclusion {
  stepId: string;
  bindings: Record<string, string>;
  reason: string;
  claimIds: string[];
}

export interface GraphStepTrace {
  stepId: string;
  operator: GraphStep["op"];
  inputRows: number;
  outputRows: number;
  claimIds: string[];
  outputHash: string;
}

export interface GraphFunctionResult {
  resultVersion: "t2k.graph-result.v1";
  status: "complete" | "needs_review";
  value: GraphRow[] | number | null;
  authorization: "not_authorized";
  binding: {
    runtimeVersion: string;
    functionHash: string;
    ontologyResolutionHash: string;
    graphKey: string;
    asOf: string;
    snapshotHash: string;
    argumentsHash: string;
  };
  evidence: GraphClaimEvidence[];
  supportingClaimIds: string[];
  derivations: Array<{ rowHash: string; claimIds: string[] }>;
  exclusions: GraphExclusion[];
  issues: GraphIssue[];
  trace: GraphStepTrace[];
  work: number;
  resultHash: string;
}

export interface GraphEvaluationInputCase {
  caseId: string;
  graph: ReasoningGraphSnapshot;
  arguments: Record<string, GraphValue>;
}

export type GraphEvaluationResourceLimitError = "row_limit" | "work_limit";

export interface GraphEvaluationCase extends GraphEvaluationInputCase {
  expected: {
    value: GraphRow[] | number | null;
    evidence: {
      /** Subset of claims supporting the completed answer, never merely considered claims. */
      supportingClaimIds: string[];
      /** Claims inspected during execution, including unresolved, stale, or excluded claims. */
      consideredClaimIds: string[];
      /** Opt in per role to equality of claim-id sets; omitted roles retain required-subset matching. */
      claimSetMatching?: { supporting?: "exact"; considered?: "exact" };
      /** Each assertion must match one exclusion; entity ids avoid coupling labels to program aliases. */
      exclusions: Array<{ entityIds: string[]; claimIds: string[] }>;
      /** Each assertion must match one derivation for this complete expected output row. */
      rows: Array<{ row: GraphRow; claimIds: string[] }>;
    };
  } & (
    | { status: GraphFunctionResult["status"]; errorCode?: never }
    /** An aborted execution has no result or evidence receipt. All evidence lists must be empty. */
    | { status: "resource_limit"; errorCode: GraphEvaluationResourceLimitError; value: null }
  );
  /** Each partial row describes a forbidden combination in a completed result. */
  forbiddenRows: GraphRow[];
}

export interface GraphEvaluationSuite {
  suiteVersion: "t2k.graph-evaluation.v2";
  suiteId: string;
  revision: string;
  thresholds: { minimumCases: number; minimumAccuracy: number; minimumImprovement: number };
  trainingCases: GraphEvaluationInputCase[];
  cases: GraphEvaluationCase[];
}

export interface GraphFailureCase {
  caseId: string;
  failureHash: string;
  category: "function" | "evidence" | "freshness" | "conflict" | "execution";
  reasons: string[];
  resultHash: string | null;
  issues: GraphIssue[];
  /** Opt-in development diagnostics; independent evaluation defaults retain their existing hashes. */
  diagnostics?: import("./reasoning-synthesis.js").GraphSynthesisDiagnostic[];
  result?: GraphFunctionResult | null;
  /** Present only when the case explicitly expects a resource-limit error. */
  expectedError?: GraphEvaluationResourceLimitError;
  /** Null for an ordinary returned result; execution_failed for an untyped exception. */
  actualError?: string | null;
}

export interface GraphEvaluationScore {
  passedCases: number;
  totalCases: number;
  accuracy: number;
  hardConstraintViolations: number;
  failures: GraphFailureCase[];
  runs: Array<{ caseId: string; passed: boolean; resultHash: string | null;
    /** These fields are absent on normal-result cases, including unexpected execution errors. */
    expectedError?: GraphEvaluationResourceLimitError; actualError?: string | null }>;
}

export interface GraphEvaluationResult {
  evaluationVersion: "t2k.graph-evaluation-result.v2";
  evaluationSource: "graph_runtime";
  status: "passed" | "failed";
  authorization: "not_authorized";
  suiteHash: string;
  candidateHash: string;
  baselineHash: string | null;
  candidate: GraphEvaluationScore;
  baseline: GraphEvaluationScore | null;
  improvement: number | null;
  reasons: string[];
  evaluationHash: string;
}
