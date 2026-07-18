/** Public JSON contracts shared by the T2K core library and reference Studio. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const KNOWLEDGE_GRAPH_TYPES = [
  "private",
  "exchange",
  "shared_pattern",
] as const;
export type KnowledgeGraphType = (typeof KNOWLEDGE_GRAPH_TYPES)[number];

export const KNOWLEDGE_GRAPH_ROLES = [
  "viewer",
  "contributor",
  "publisher",
  "manager",
  "owner",
] as const;
export type KnowledgeGraphRole = (typeof KNOWLEDGE_GRAPH_ROLES)[number];

export const CLAIM_MODALITIES = [
  "observation",
  "attestation",
  "assertion",
  "interpretation",
  "inference",
  "hypothesis",
  "benchmark",
  "policy",
  "forecast",
  "recommendation",
] as const;
export type KnowledgeClaimModality = (typeof CLAIM_MODALITIES)[number];

export const CLAIM_LIFECYCLE_STATUSES = [
  "proposed",
  "accepted",
  "disputed",
  "superseded",
  "retracted",
] as const;
export type KnowledgeClaimLifecycleStatus =
  (typeof CLAIM_LIFECYCLE_STATUSES)[number];

export interface BusinessContextDimensionValue {
  state: "known" | "unknown" | "not_applicable";
  value?: JsonValue;
  scheme?: string;
  schemeVersion?: string;
  asOf?: string;
  sourceRefs?: string[];
}

export interface BusinessContextProfileRecord {
  id: string;
  contextId: string;
  contextVersion: string;
  label: string;
  status: string;
  subjectRef: string;
  unitOfAnalysis: string;
  dimensions: Record<string, BusinessContextDimensionValue>;
  sourceRefs: string[];
  contentHash: string;
  ownerOrganizationId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessContextProfileInput {
  contextId: string;
  contextVersion: string;
  label: string;
  status?: "draft" | "review" | "accepted" | "deprecated";
  subjectRef: string;
  unitOfAnalysis: string;
  dimensions: Record<string, BusinessContextDimensionValue>;
  sourceRefs?: string[];
}

export type OntologyPackLifecycleStatus =
  | "draft"
  | "review"
  | "accepted"
  | "deprecated"
  | "rejected";

export interface OntologyPackVersionSummary {
  id: string;
  ontologyVersion: string;
  manifestVersion: string;
  packKind: string;
  status: OntologyPackLifecycleStatus;
  contentHash: string;
  compatibility: JsonObject;
  createdAt: string;
}

export interface OntologyPackRegistryRecord {
  id: string;
  ontologyId: string;
  label: string;
  description: string;
  visibility: string;
  ownerOrganizationId: string | null;
  ownerUserId: string | null;
  versions: OntologyPackVersionSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface OntologyPackVersionDetail extends OntologyPackVersionSummary {
  ontologyId: string;
  manifest: JsonObject;
}

export type OntologyPackCompatibility =
  | "identical"
  | "backward_compatible"
  | "review_required"
  | "breaking";

export interface OntologyDefinitionChange {
  definitionKey: string;
  definitionKind: string;
  changeType: "added" | "removed" | "changed";
  compatibility: Exclude<OntologyPackCompatibility, "identical">;
  beforeHash: string | null;
  afterHash: string | null;
  beforeBody: JsonObject | null;
  afterBody: JsonObject | null;
  changedFields: string[];
}

export interface OntologyPackDiffRecord {
  ontologyId: string;
  fromVersion: string;
  toVersion: string;
  compatibility: OntologyPackCompatibility;
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  changes: OntologyDefinitionChange[];
  diagnostics: JsonValue[];
}

export interface ReviewOntologyPackVersionInput {
  status: "review" | "accepted" | "deprecated" | "rejected";
  rationale: string;
}

export interface OntologyPackEvaluationRecord {
  id: string;
  ontologyId: string;
  ontologyVersion: string;
  evaluationKey: string;
  evaluationType: "conformance" | "behavioral";
  suiteVersion: string;
  status: "passed" | "failed" | "needs_review";
  result: JsonObject;
  evidenceRefs: string[];
  notes: string;
  createdAt: string;
}

export interface CreateOntologyPackEvaluationInput {
  evaluationKey: string;
  evaluationType: "conformance" | "behavioral";
  suiteVersion?: string;
  status?: "passed" | "failed" | "needs_review";
  result?: JsonObject;
  evidenceRefs?: string[];
  notes?: string;
}

export interface OntologyPackPromotionRecord {
  id: string;
  proposalKey: string;
  sourceOntologyId: string;
  sourceOntologyVersion: string;
  targetOntologyId: string;
  targetPackKind: "core" | "context" | "vertical" | "workflow";
  definitionKeys: string[];
  rationale: string;
  evidenceRefs: string[];
  compatibilityPlan: string;
  status: "proposed" | "accepted" | "rejected";
  reviewerActorType: string | null;
  reviewerActorId: string | null;
  reviewRationale: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOntologyPackPromotionInput {
  proposalKey: string;
  sourceOntologyId: string;
  sourceOntologyVersion: string;
  targetOntologyId: string;
  targetPackKind: "core" | "context" | "vertical" | "workflow";
  definitionKeys: string[];
  rationale: string;
  evidenceRefs: string[];
  compatibilityPlan: string;
}

export interface SemanticRegistryEventRecord {
  id: string;
  eventType: string;
  objectType: string;
  objectKey: string;
  actorType: string;
  actorId: string | null;
  payload: JsonObject;
  createdAt: string;
}

export interface KnowledgeGraphRecord {
  id: string;
  graphKey: string;
  label: string;
  description: string;
  graphType: KnowledgeGraphType;
  status: string;
  ownerOrganizationId: string | null;
  ownerUserId: string | null;
  businessContextProfileId: string | null;
  resolvedPackSetId: string | null;
  privacyProfile: "standard" | "restricted" | "locked_down";
  dataClassification: string;
  humanReviewRequired: boolean;
  retentionPolicy: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeGraphInput {
  graphKey: string;
  label: string;
  description?: string;
  graphType: KnowledgeGraphType;
  businessContextProfileId?: string | null;
  resolvedPackSetId?: string | null;
  privacyProfile?: "standard" | "restricted" | "locked_down";
  dataClassification?: string;
  humanReviewRequired?: boolean;
  retentionPolicy?: JsonObject;
}

export interface ConfigureKnowledgeGraphInput {
  resolvedPackSetId?: string | null;
  businessContextProfileId?: string | null;
  humanReviewRequired?: boolean;
}

export interface ResolvedPackSetSummary {
  id: string;
  resolutionKey: string;
  resolutionHash: string;
  status: string;
  contextProfileId: string | null;
  roots: Array<{ ontologyId: string; version: string }>;
  packs: Array<{
    ontologyId: string;
    ontologyVersion: string;
    packKind: string;
  }>;
  definitionCount: number;
  createdAt: string;
}

export interface WorkspaceGraphMountRecord {
  id: string;
  workspaceSlug: string;
  graphKey: string;
  graphLabel: string;
  graphType: KnowledgeGraphType;
  accessMode: KnowledgeGraphRole;
  purpose: string;
  expiresAt: string | null;
}

export interface GraphAccessGrantRecord {
  id: string;
  graphKey: string;
  granteeOrganizationId: string | null;
  granteeUserId: string | null;
  role: KnowledgeGraphRole;
  purpose: string;
  constraints: JsonObject;
  effectiveFrom: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface KnowledgeEntityRecord {
  id: string;
  graphKey: string;
  entityKey: string;
  typeRef: string;
  label: string;
  aliases: string[];
  properties: JsonObject;
  identity: JsonObject;
  status: string;
  dataClassification: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeEntityInput {
  entityKey: string;
  typeRef: string;
  label: string;
  aliases?: string[];
  properties?: JsonObject;
  identity?: JsonObject;
  dataClassification?: string;
}

export interface KnowledgeClaimEvidenceInput {
  sourceSpanId?: string | null;
  evidenceKind?: string;
  evidenceRole?: "support" | "contradict" | "context" | "authority";
  locator?: string | null;
  summary: string;
  contentHash?: string | null;
  visibility?: "private" | "exchange" | "public";
}

export interface KnowledgeClaimEvidenceRecord
  extends Required<
    Omit<
      KnowledgeClaimEvidenceInput,
      "sourceSpanId" | "locator" | "contentHash"
    >
  > {
  id: string;
  sourceSpanId: string | null;
  locator: string | null;
  contentHash: string | null;
  createdAt: string;
}

export interface KnowledgeClaimRecord {
  id: string;
  graphKey: string;
  claimKey: string;
  subjectEntityId: string | null;
  subjectEntityKey: string | null;
  predicateRef: string;
  objectEntityId: string | null;
  objectEntityKey: string | null;
  objectValue: JsonValue | null;
  statement: string;
  modality: KnowledgeClaimModality;
  polarity: "positive" | "negative";
  status: KnowledgeClaimLifecycleStatus;
  confidence: number | null;
  sourceAuthorityRef: string | null;
  businessContextProfileId: string | null;
  observedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reviewDueAt: string | null;
  recordedAt: string;
  contributorActorType: string;
  contributorActorId: string | null;
  contributorAuthorityScope: string | null;
  uncertainty: JsonObject;
  context: JsonObject;
  revision: number;
  supersedesClaimId: string | null;
  supersededByClaimId: string | null;
  retractedAt: string | null;
  evidence: KnowledgeClaimEvidenceRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeClaimInput {
  claimKey: string;
  subjectEntityKey?: string | null;
  predicateRef: string;
  objectEntityKey?: string | null;
  objectValue?: JsonValue;
  statement: string;
  modality: KnowledgeClaimModality;
  polarity?: "positive" | "negative";
  status?: "proposed" | "accepted";
  confidence?: number | null;
  sourceAuthorityRef?: string | null;
  businessContextProfileId?: string | null;
  observedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  reviewDueAt?: string | null;
  contributorAuthorityScope?: string | null;
  uncertainty?: JsonObject;
  context?: JsonObject;
  evidence?: KnowledgeClaimEvidenceInput[];
  supersedesClaimKey?: string | null;
}

export interface KnowledgeAttestationRecord {
  id: string;
  claimKey: string;
  attestorActorType: string;
  attestorActorId: string;
  attestorLabel: string;
  authorityScope: string;
  status: string;
  statement: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  signatureHash: string | null;
  retractedAt: string | null;
  createdAt: string;
}

export interface CreateKnowledgeAttestationInput {
  authorityScope: string;
  statement?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  signatureHash?: string | null;
}

export interface KnowledgeClaimDisputeRecord {
  id: string;
  claimKey: string;
  raisedByActorType: string;
  raisedByActorId: string;
  reason: string;
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AuthorityGrantRecord {
  id: string;
  graphKey: string;
  granteeActorType: string;
  granteeActorId: string;
  roleRef: string;
  authorityScope: JsonObject;
  approvalLimit: JsonObject;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  evidence: JsonValue[];
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateAuthorityGrantInput {
  granteeActorType: "user" | "organization" | "api_key" | "system";
  granteeActorId: string;
  roleRef: string;
  authorityScope: JsonObject;
  approvalLimit?: JsonObject;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  evidence?: JsonValue[];
}

export interface DecisionContextRecord {
  id: string;
  graphKey: string;
  contextKey: string;
  resolvedPackSetId: string | null;
  businessContextProfileId: string | null;
  question: string;
  decisionType: string;
  factClaimIds: string[];
  factSnapshot: JsonValue[];
  objective: JsonObject;
  policies: JsonValue[];
  alternatives: JsonValue[];
  assumptions: JsonValue[];
  forecasts: JsonValue[];
  uncertainty: JsonObject;
  freshness: JsonObject;
  requiredAuthority: JsonObject;
  decisionTemplateRef: JsonObject | null;
  reasoningMethod: string;
  reasoningVersion: string;
  status: string;
  contextHash: string;
  diagnostics: JsonValue[];
  createdAt: string;
}

export interface CreateDecisionContextInput {
  contextKey: string;
  question: string;
  decisionType: string;
  factClaimKeys: string[];
  objective: JsonObject;
  policies?: JsonValue[];
  alternatives: JsonValue[];
  assumptions?: JsonValue[];
  forecasts?: JsonValue[];
  uncertainty?: JsonObject;
  freshness?: JsonObject;
  requiredAuthority: JsonObject;
  reasoningMethod: string;
  reasoningVersion: string;
  resolvedPackSetId?: string | null;
  businessContextProfileId?: string | null;
}

export interface CreateDecisionContextFromTemplateInput {
  contextKey: string;
  templateRef: string;
  factBindings: Record<string, string>;
  additionalFactClaimKeys?: string[];
  question?: string;
  objective?: JsonObject;
  policies?: JsonValue[];
  assumptions?: JsonValue[];
  forecasts?: JsonValue[];
  resolvedPackSetId?: string | null;
  businessContextProfileId?: string | null;
}

export interface DecisionTemplateCatalogRecord {
  graphKey: string;
  resolvedPackSetId: string;
  definitionKey: string;
  ontologyId: string;
  ontologyVersion: string;
  localId: string;
  contentHash: string;
  question: string;
  decisionType: string;
  requiredContext: string[];
  requiredFacts: string[];
  objective: string;
  successMeasure: string;
  alternatives: string[];
  criteria: string[];
  comparisonMethod: string;
  policies: string[];
  authority: string;
  riskLevel: string;
  allowedActionProposals: string[];
  outcomeMeasures: string[];
  learningContract: DecisionLearningContract;
}

export interface DecisionRecommendationRecord {
  id: string;
  decisionContextId: string;
  recommendationKey: string;
  proposedAlternative: string;
  rationale: string;
  confidence: JsonObject;
  tradeoffs: JsonValue[];
  sensitivities: JsonValue[];
  reasoningTrace: JsonObject;
  status: string;
  createdAt: string;
}

export interface CreateDecisionRecommendationInput {
  recommendationKey: string;
  proposedAlternative: string;
  rationale: string;
  confidence?: JsonObject;
  tradeoffs?: JsonValue[];
  sensitivities?: JsonValue[];
  reasoningTrace?: JsonObject;
}

export interface AuthorizedDecisionRecord {
  id: string;
  decisionContextId: string;
  recommendationId: string | null;
  selectedAlternative: string;
  status: string;
  decisionMakerActorType: string;
  decisionMakerActorId: string;
  decisionMakerLabel: string;
  authorityGrantId: string | null;
  rationale: string;
  conditions: JsonValue[];
  dissent: JsonValue[];
  decidedAt: string;
}

export interface AuthorizeDecisionInput {
  recommendationId?: string | null;
  selectedAlternative: string;
  authorityGrantId?: string | null;
  rationale: string;
  conditions?: JsonValue[];
  dissent?: JsonValue[];
}

export interface DecisionActionRecord {
  id: string;
  decisionId: string;
  actionKey: string;
  actionType: string;
  payload: JsonObject;
  ownerActorType: string;
  ownerActorId: string;
  status: string;
  externalEffect: boolean;
  idempotencyKey: string;
  rollback: JsonObject;
  dueAt: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  reversedAt: string | null;
}

export interface CreateDecisionActionInput {
  actionKey: string;
  actionType: string;
  payload?: JsonObject;
  ownerActorType: string;
  ownerActorId: string;
  externalEffect?: boolean;
  idempotencyKey: string;
  rollback?: JsonObject;
  dueAt?: string | null;
}

export interface DecisionOutcomeRecord {
  id: string;
  decisionId: string;
  actionId: string | null;
  measureRef: string;
  observedValue: JsonValue;
  baselineValue: JsonValue | null;
  variance: JsonObject;
  observationWindow: string;
  sourceRefs: string[];
  lessons: string;
  observedAt: string;
  createdAt: string;
}

export interface CreateDecisionOutcomeInput {
  actionId?: string | null;
  measureRef: string;
  observedValue: JsonValue;
  baselineValue?: JsonValue | null;
  variance?: JsonObject;
  observationWindow: string;
  sourceRefs?: string[];
  lessons?: string;
  observedAt: string;
}

export const DECISION_LEARNING_MODES = [
  "none",
  "supervised_feedback",
  "contextual_bandit",
  "sequential_rl",
  "optimization",
] as const;
export type DecisionLearningMode = (typeof DECISION_LEARNING_MODES)[number];

export const REWARD_DIRECTIONS = [
  "maximize",
  "minimize",
  "target",
  "range",
] as const;
export type RewardDirection = (typeof REWARD_DIRECTIONS)[number];

export interface RewardDimensionSpec {
  measureRef: string;
  label: string;
  direction: RewardDirection;
  weight: number;
  required: boolean;
  guardrail: boolean;
  unit?: string;
  target?: number;
  minimum?: number;
  maximum?: number;
  tolerance?: number;
  observationWindow: string;
  aggregation: "latest" | "sum" | "average" | "minimum" | "maximum";
  baselineMethod: "explicit" | "previous_state" | "control" | "none";
  attributionMethod:
    | "direct"
    | "human_review"
    | "comparison"
    | "experiment"
    | "unknown";
}

export interface DecisionLearningContract {
  mode: DecisionLearningMode;
  stateSchema: JsonObject;
  actionSchema: JsonObject;
  rewardSpec: RewardDimensionSpec[];
  observationSchedule: string[];
  terminalConditions: string[];
  explorationPolicy: JsonObject;
  safetyConstraints: JsonValue[];
  promotionCriteria: JsonObject;
}

export interface ReasoningPolicyRecord {
  id: string;
  graphKey: string;
  policyKey: string;
  label: string;
  description: string;
  decisionType: string;
  status: string;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReasoningPolicyInput {
  policyKey: string;
  label: string;
  description?: string;
  decisionType: string;
}

export interface ReasoningPolicyVersionRecord {
  id: string;
  policyId: string;
  policyKey: string;
  policyVersion: string;
  learningMode: DecisionLearningMode;
  specification: JsonObject;
  rewardSpec: RewardDimensionSpec[];
  lifecycleStatus: string;
  contentHash: string;
  parentVersionId: string | null;
  rationale: string;
  evaluationSummary: JsonObject;
  reviewedAt: string | null;
  deployedAt: string | null;
  createdAt: string;
}

export interface ActiveReasoningPolicyRecord {
  policy: ReasoningPolicyRecord;
  version: ReasoningPolicyVersionRecord;
}

export interface CreateReasoningPolicyVersionInput {
  policyVersion: string;
  learningMode: DecisionLearningMode;
  specification: JsonObject;
  rewardSpec?: RewardDimensionSpec[];
  parentVersionId?: string | null;
  rationale: string;
}

export interface DecisionEpisodeRecord {
  id: string;
  graphKey: string;
  episodeKey: string;
  decisionContextId: string;
  decisionContextKey: string;
  authorizedDecisionId: string | null;
  policyVersionId: string | null;
  learningMode: DecisionLearningMode;
  stateSnapshot: JsonObject;
  learningContract: DecisionLearningContract;
  lifecycleStatus: string;
  openedAt: string;
  closedAt: string | null;
  closureRationale: string | null;
  createdAt: string;
}

export interface CreateDecisionEpisodeInput {
  episodeKey: string;
  decisionContextKey: string;
  authorizedDecisionId?: string | null;
  policyVersionId?: string | null;
  learningContract?: Partial<DecisionLearningContract>;
}

export interface ReasoningRunRecord {
  id: string;
  decisionEpisodeId: string;
  runKey: string;
  policyVersionId: string | null;
  recommendationId: string | null;
  modelRef: string;
  promptVersion: string;
  toolVersions: JsonObject;
  codeVersion: string;
  inputHash: string;
  outputHash: string;
  trace: JsonObject;
  selectedActionProbability: number | null;
  latencyMs: number | null;
  cost: JsonObject;
  lifecycleStatus: string;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateReasoningRunInput {
  runKey: string;
  policyVersionId?: string | null;
  recommendationId?: string | null;
  modelRef: string;
  promptVersion: string;
  toolVersions?: JsonObject;
  codeVersion: string;
  inputHash: string;
  outputHash: string;
  trace?: JsonObject;
  selectedActionProbability?: number | null;
  latencyMs?: number | null;
  cost?: JsonObject;
  lifecycleStatus?: "started" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string | null;
}

export interface ActionExecutionAttemptRecord {
  id: string;
  actionId: string;
  decisionEpisodeId: string | null;
  attemptKey: string;
  connectorRef: string;
  requestHash: string;
  request: JsonObject;
  lifecycleStatus: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateActionExecutionAttemptInput {
  decisionEpisodeId?: string | null;
  attemptKey: string;
  connectorRef: string;
  requestHash: string;
  request?: JsonObject;
  startedAt?: string;
}

export interface ExecutionReceiptRecord {
  id: string;
  executionAttemptId: string;
  receiptKey: string;
  externalTransactionId: string | null;
  outcome: "succeeded" | "failed" | "unknown";
  responseHash: string;
  response: JsonObject;
  error: JsonObject;
  reconciliationStatus: string;
  receivedAt: string;
  createdAt: string;
}

export interface CreateExecutionReceiptInput {
  receiptKey: string;
  externalTransactionId?: string | null;
  outcome: "succeeded" | "failed" | "unknown";
  responseHash: string;
  response?: JsonObject;
  error?: JsonObject;
  reconciliationStatus?: "pending" | "reconciled" | "mismatch";
  receivedAt?: string;
}

export interface EpisodeObservationRecord {
  id: string;
  decisionEpisodeId: string;
  actionId: string | null;
  measureRef: string;
  observedValue: JsonValue;
  baselineValue: JsonValue | null;
  unit: string | null;
  observationWindow: string;
  sourceRefs: string[];
  provenance: JsonObject;
  attributionConfidence: number | null;
  acceptedClaimId: string | null;
  observedAt: string;
  createdAt: string;
}

export interface CreateEpisodeObservationInput {
  actionId?: string | null;
  measureRef: string;
  observedValue: JsonValue;
  baselineValue?: JsonValue | null;
  unit?: string | null;
  observationWindow: string;
  sourceRefs?: string[];
  provenance?: JsonObject;
  attributionConfidence?: number | null;
  acceptedClaimId?: string | null;
  observedAt: string;
}

export interface RewardDimensionAssessment {
  measureRef: string;
  direction: RewardDirection;
  observedValue: JsonValue | null;
  baselineValue: JsonValue | null;
  score: number | null;
  weight: number;
  weightedScore: number | null;
  guardrail: boolean;
  guardrailViolated: boolean;
  complete: boolean;
  explanation: string;
}

export interface RewardAssessmentRecord {
  id: string;
  decisionEpisodeId: string;
  assessmentKey: string;
  rewardSpecHash: string;
  dimensions: RewardDimensionAssessment[];
  scalarReward: number | null;
  attribution: JsonObject;
  lifecycleStatus: string;
  assessedAt: string;
  waivedAt: string | null;
  waiverRationale: string | null;
  waivedByActorType: string | null;
  waivedByActorId: string | null;
  createdAt: string;
}

export interface CreateRewardAssessmentInput {
  assessmentKey: string;
  rewardSpec?: RewardDimensionSpec[];
  attribution?: JsonObject;
  assessedAt?: string;
}

export interface WaiveRewardAssessmentInput {
  rationale: string;
}

export interface LearningCandidateRecord {
  id: string;
  graphKey: string;
  candidateKey: string;
  policyId: string;
  sourcePolicyVersionId: string;
  proposedPolicyVersion: string;
  proposedSpecification: JsonObject;
  proposedRewardSpec: RewardDimensionSpec[];
  trainingEpisodeIds: string[];
  rationale: string;
  lifecycleStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLearningCandidateInput {
  candidateKey: string;
  policyKey: string;
  sourcePolicyVersionId: string;
  proposedPolicyVersion: string;
  proposedSpecification: JsonObject;
  proposedRewardSpec?: RewardDimensionSpec[];
  trainingEpisodeIds: string[];
  rationale: string;
}

export interface PolicyEvaluationRecord {
  id: string;
  learningCandidateId: string;
  evaluationKey: string;
  evaluationType: "historical_replay" | "shadow" | "canary" | "behavioral";
  baselinePolicyVersionId: string;
  lifecycleStatus: "passed" | "failed" | "needs_review";
  metrics: JsonObject;
  slices: JsonValue[];
  safetyResults: JsonValue[];
  evidenceRefs: string[];
  notes: string;
  createdAt: string;
}

export interface CreatePolicyEvaluationInput {
  evaluationKey: string;
  evaluationType: "historical_replay" | "shadow" | "canary" | "behavioral";
  holdoutEpisodeIds?: string[];
  lifecycleStatus?: "passed" | "failed" | "needs_review";
  metrics?: JsonObject;
  slices?: JsonValue[];
  safetyResults?: JsonValue[];
  evidenceRefs?: string[];
  notes?: string;
}

export interface PolicyPromotionRecord {
  id: string;
  learningCandidateId: string;
  promotedPolicyVersionId: string;
  targetCohort: JsonObject;
  lifecycleStatus: string;
  reviewRationale: string;
  deployedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
}

export interface DecisionLearningSnapshot {
  policies: ReasoningPolicyRecord[];
  policyVersions: ReasoningPolicyVersionRecord[];
  episodes: DecisionEpisodeRecord[];
  candidates: LearningCandidateRecord[];
  evaluations: PolicyEvaluationRecord[];
  promotions: PolicyPromotionRecord[];
  rewardAggregates: import("./reference-policy.js").PolicyRewardAggregate[];
}

export interface KnowledgePublicationItemInput {
  sourceObjectType: "entity" | "claim";
  sourceObjectKey: string;
  transformKind: "exact" | "redacted" | "aggregate";
  redactedFields?: string[];
}

export interface KnowledgePublicationRecord {
  id: string;
  publicationKey: string;
  sourceGraphKey: string;
  targetGraphKey: string;
  purpose: string;
  status: string;
  recipientOrganizationIds: string[];
  disclosurePolicy: JsonObject;
  publishedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgePublicationInput {
  publicationKey: string;
  targetGraphKey: string;
  purpose: string;
  recipientOrganizationIds?: string[];
  disclosurePolicy?: JsonObject;
  items: KnowledgePublicationItemInput[];
}

export interface SharedPatternCohortRecord {
  id: string;
  graphKey: string;
  cohortKey: string;
  label: string;
  contextSelector: JsonObject;
  minimumContributors: number;
  minimumSampleSize: number;
  status: string;
  governance: JsonObject;
}

export interface CreateSharedPatternCohortInput {
  cohortKey: string;
  label: string;
  contextSelector: JsonObject;
  minimumContributors?: number;
  minimumSampleSize?: number;
  governance?: JsonObject;
}

export interface SharedPatternRecord {
  id: string;
  graphKey: string;
  cohortId: string;
  patternKey: string;
  patternType: string;
  statement: string;
  measure: JsonObject;
  uncertainty: JsonObject;
  contributorCount: number;
  sampleSize: number;
  sourcePublicationIds: string[];
  status: string;
  reviewedAt: string | null;
}

export interface CreateSharedPatternInput {
  cohortKey: string;
  patternKey: string;
  patternType: string;
  statement: string;
  measure: JsonObject;
  uncertainty?: JsonObject;
  contributorCount: number;
  sampleSize: number;
  sourcePublicationIds?: string[];
}

export interface WorkspaceKnowledgeNetworkSnapshot {
  graphs: WorkspaceGraphMountRecord[];
  decisionContexts: DecisionContextRecord[];
  decisionTemplates: DecisionTemplateCatalogRecord[];
  publications: KnowledgePublicationRecord[];
  openDisputeCount: number;
  activeAuthorityGrantCount: number;
}
