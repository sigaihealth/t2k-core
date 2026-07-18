import type {
  ActiveReasoningPolicyRecord,
  AuthorityGrantRecord,
  AuthorizeDecisionInput,
  AuthorizedDecisionRecord,
  BusinessContextProfileRecord,
  ConfigureKnowledgeGraphInput,
  CreateBusinessContextProfileInput,
  CreateAuthorityGrantInput,
  CreateActionExecutionAttemptInput,
  CreateDecisionActionInput,
  CreateDecisionContextInput,
  CreateDecisionContextFromTemplateInput,
  CreateDecisionEpisodeInput,
  CreateDecisionOutcomeInput,
  CreateDecisionRecommendationInput,
  CreateEpisodeObservationInput,
  CreateExecutionReceiptInput,
  CreateKnowledgeAttestationInput,
  CreateKnowledgeClaimInput,
  CreateKnowledgeEntityInput,
  CreateKnowledgeGraphInput,
  CreateKnowledgePublicationInput,
  CreateOntologyPackEvaluationInput,
  CreateOntologyPackPromotionInput,
  CreateLearningCandidateInput,
  CreatePolicyEvaluationInput,
  CreateReasoningPolicyInput,
  CreateReasoningPolicyVersionInput,
  CreateReasoningRunInput,
  CreateRewardAssessmentInput,
  CreateSharedPatternCohortInput,
  CreateSharedPatternInput,
  DecisionActionRecord,
  DecisionContextRecord,
  DecisionEpisodeRecord,
  DecisionLearningSnapshot,
  DecisionOutcomeRecord,
  DecisionRecommendationRecord,
  DecisionTemplateCatalogRecord,
  GraphAccessGrantRecord,
  ActionExecutionAttemptRecord,
  EpisodeObservationRecord,
  ExecutionReceiptRecord,
  JsonObject,
  KnowledgeAttestationRecord,
  KnowledgeClaimDisputeRecord,
  KnowledgeClaimRecord,
  KnowledgeEntityRecord,
  KnowledgeGraphRecord,
  KnowledgeGraphRole,
  KnowledgePublicationRecord,
  OntologyPackDiffRecord,
  OntologyPackEvaluationRecord,
  OntologyPackPromotionRecord,
  OntologyPackRegistryRecord,
  OntologyPackVersionDetail,
  LearningCandidateRecord,
  PolicyEvaluationRecord,
  PolicyPromotionRecord,
  ReasoningPolicyRecord,
  ReasoningPolicyVersionRecord,
  ReasoningRunRecord,
  RewardAssessmentRecord,
  ReviewOntologyPackVersionInput,
  ResolvedPackSetSummary,
  SemanticRegistryEventRecord,
  SharedPatternCohortRecord,
  SharedPatternRecord,
  WorkspaceGraphMountRecord,
  WorkspaceKnowledgeNetworkSnapshot,
} from "./types.js";

type FetchLike = typeof fetch;

export class T2kApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "T2kApiError";
  }
}

export class T2kClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetcher: FetchLike;

  constructor(input: { baseUrl: string; apiKey?: string; fetch?: FetchLike }) {
    this.baseUrl = input.baseUrl.replace(/\/$/, "");
    this.apiKey = input.apiKey;
    this.fetcher = input.fetch ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        ...init?.headers,
      },
    });
    const responseText = await response.text();
    let body: unknown;

    if (responseText.trim()) {
      try {
        body = JSON.parse(responseText);
      } catch {
        throw new T2kApiError(
          response.ok
            ? `T2K API returned a non-JSON response with status ${response.status}.`
            : `T2K API request failed with status ${response.status}.`,
          response.status,
          responseText
        );
      }
    } else if (response.status === 204) {
      body = undefined;
    } else {
      throw new T2kApiError(
        response.ok
          ? `T2K API returned an empty response with status ${response.status}.`
          : `T2K API request failed with status ${response.status}.`,
        response.status,
        null
      );
    }

    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `T2K API request failed with status ${response.status}.`;
      throw new T2kApiError(message, response.status, body);
    }
    return body as T;
  }

  private post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  listOntologyPacks() {
    return this.request<OntologyPackRegistryRecord[]>("/api/v1/ontology-packs");
  }

  registerOntologyPack(manifest: unknown, visibility = "private") {
    return this.post<{
      packId: string;
      packVersionId: string;
      ontologyId: string;
      ontologyVersion: string;
      contentHash: string;
      created: boolean;
    }>("/api/v1/ontology-packs", { manifest, visibility });
  }

  getOntologyPack(ontologyId: string) {
    return this.request<
      Omit<OntologyPackRegistryRecord, "versions"> & {
        versions: OntologyPackVersionDetail[];
      }
    >(`/api/v1/ontology-packs/${encodeURIComponent(ontologyId)}`);
  }

  compareOntologyPackVersions(
    ontologyId: string,
    fromVersion: string,
    toVersion: string
  ) {
    return this.request<OntologyPackDiffRecord>(
      `/api/v1/ontology-packs/${encodeURIComponent(ontologyId)}/diff?from=${encodeURIComponent(fromVersion)}&to=${encodeURIComponent(toVersion)}`
    );
  }

  reviewOntologyPackVersion(
    ontologyId: string,
    ontologyVersion: string,
    input: ReviewOntologyPackVersionInput
  ) {
    return this.post<OntologyPackVersionDetail>(
      `/api/v1/ontology-packs/${encodeURIComponent(ontologyId)}/versions/${encodeURIComponent(ontologyVersion)}/review`,
      input
    );
  }

  listOntologyPackEvaluations(ontologyId: string, ontologyVersion: string) {
    return this.request<OntologyPackEvaluationRecord[]>(
      `/api/v1/ontology-packs/${encodeURIComponent(ontologyId)}/versions/${encodeURIComponent(ontologyVersion)}/evaluations`
    );
  }

  evaluateOntologyPackVersion(
    ontologyId: string,
    ontologyVersion: string,
    input: CreateOntologyPackEvaluationInput
  ) {
    return this.post<OntologyPackEvaluationRecord>(
      `/api/v1/ontology-packs/${encodeURIComponent(ontologyId)}/versions/${encodeURIComponent(ontologyVersion)}/evaluations`,
      input
    );
  }

  listOntologyPackPromotions() {
    return this.request<OntologyPackPromotionRecord[]>(
      "/api/v1/ontology-pack-promotions"
    );
  }

  proposeOntologyPackPromotion(input: CreateOntologyPackPromotionInput) {
    return this.post<OntologyPackPromotionRecord>(
      "/api/v1/ontology-pack-promotions",
      input
    );
  }

  reviewOntologyPackPromotion(
    proposalKey: string,
    input: { status: "accepted" | "rejected"; rationale: string }
  ) {
    return this.post<OntologyPackPromotionRecord>(
      `/api/v1/ontology-pack-promotions/${encodeURIComponent(proposalKey)}/review`,
      input
    );
  }

  listSemanticRegistryEvents(limit = 100) {
    return this.request<SemanticRegistryEventRecord[]>(
      `/api/v1/semantic-registry/events?limit=${encodeURIComponent(String(limit))}`
    );
  }

  createBusinessContext(input: CreateBusinessContextProfileInput) {
    return this.post<BusinessContextProfileRecord>(
      "/api/v1/business-contexts",
      input
    );
  }

  listBusinessContexts() {
    return this.request<BusinessContextProfileRecord[]>(
      "/api/v1/business-contexts"
    );
  }

  resolvePackSet(input: {
    resolutionKey?: string;
    roots: Array<{ ontologyId: string; version: string }>;
    businessContextProfileId?: string | null;
  }) {
    return this.post<{
      id: string;
      resolutionKey: string;
      resolutionHash: string;
      status: string;
      compiled: unknown;
    }>("/api/v1/pack-sets/resolve", input);
  }

  listResolvedPackSets() {
    return this.request<ResolvedPackSetSummary[]>("/api/v1/pack-sets");
  }

  listKnowledgeGraphs() {
    return this.request<KnowledgeGraphRecord[]>("/api/v1/knowledge-graphs");
  }

  createKnowledgeGraph(input: CreateKnowledgeGraphInput) {
    return this.post<KnowledgeGraphRecord>("/api/v1/knowledge-graphs", input);
  }

  getKnowledgeGraph(graphKey: string) {
    return this.request<KnowledgeGraphRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}`
    );
  }

  configureKnowledgeGraph(
    graphKey: string,
    input: ConfigureKnowledgeGraphInput
  ) {
    return this.request<KnowledgeGraphRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}`,
      { method: "PATCH", body: JSON.stringify(input) }
    );
  }

  mountKnowledgeGraph(
    graphKey: string,
    input: {
      workspaceSlug: string;
      accessMode: KnowledgeGraphRole;
      purpose: string;
      expiresAt?: string | null;
    }
  ) {
    return this.post<WorkspaceGraphMountRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/mounts`,
      input
    );
  }

  unmountKnowledgeGraph(graphKey: string, workspaceSlug: string) {
    return this.request<{ graphKey: string; workspaceSlug: string; unmounted: true }>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/mounts/${encodeURIComponent(workspaceSlug)}`,
      { method: "DELETE" }
    );
  }

  listGraphAccessGrants(graphKey: string) {
    return this.request<GraphAccessGrantRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/grants`
    );
  }

  grantGraphAccess(
    graphKey: string,
    input: {
      granteeOrganizationId?: string | null;
      granteeUserId?: string | null;
      role: KnowledgeGraphRole;
      purpose: string;
      constraints?: JsonObject;
      effectiveFrom?: string;
      expiresAt?: string | null;
    }
  ) {
    return this.post<GraphAccessGrantRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/grants`,
      input
    );
  }

  revokeGraphAccess(graphKey: string, grantId: string) {
    return this.post<{ graphKey: string; grantId: string; revoked: true }>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/grants/${encodeURIComponent(grantId)}/revoke`
    );
  }

  listWorkspaceKnowledgeGraphs(workspaceSlug: string) {
    return this.request<WorkspaceGraphMountRecord[]>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge-graphs`
    );
  }

  createEntity(graphKey: string, input: CreateKnowledgeEntityInput) {
    return this.post<KnowledgeEntityRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/entities`,
      input
    );
  }

  listEntities(graphKey: string) {
    return this.request<KnowledgeEntityRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/entities`
    );
  }

  listClaims(graphKey: string) {
    return this.request<KnowledgeClaimRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims`
    );
  }

  createClaim(graphKey: string, input: CreateKnowledgeClaimInput) {
    return this.post<KnowledgeClaimRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims`,
      input
    );
  }

  getClaim(graphKey: string, claimKey: string) {
    return this.request<KnowledgeClaimRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims/${encodeURIComponent(claimKey)}`
    );
  }

  listClaimAttestations(graphKey: string, claimKey: string) {
    return this.request<KnowledgeAttestationRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims/${encodeURIComponent(claimKey)}/attestations`
    );
  }

  attestClaim(
    graphKey: string,
    claimKey: string,
    input: CreateKnowledgeAttestationInput
  ) {
    return this.post<KnowledgeAttestationRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims/${encodeURIComponent(claimKey)}/attestations`,
      input
    );
  }

  listClaimDisputes(graphKey: string, claimKey: string) {
    return this.request<KnowledgeClaimDisputeRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims/${encodeURIComponent(claimKey)}/disputes`
    );
  }

  disputeClaim(graphKey: string, claimKey: string, reason: string) {
    return this.post<KnowledgeClaimDisputeRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/claims/${encodeURIComponent(claimKey)}/disputes`,
      { reason }
    );
  }

  resolveClaimDispute(
    graphKey: string,
    disputeId: string,
    input: {
      resolution: string;
      claimStatus: "proposed" | "accepted" | "retracted";
    }
  ) {
    return this.post<{
      disputeId: string;
      status: "resolved";
      claimStatus: "proposed" | "accepted" | "retracted";
    }>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/disputes/${encodeURIComponent(disputeId)}/resolve`,
      input
    );
  }

  listAuthorityGrants(graphKey: string) {
    return this.request<AuthorityGrantRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/authority-grants`
    );
  }

  createAuthorityGrant(graphKey: string, input: CreateAuthorityGrantInput) {
    return this.post<AuthorityGrantRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/authority-grants`,
      input
    );
  }

  revokeAuthorityGrant(graphKey: string, grantId: string) {
    return this.post<{ graphKey: string; grantId: string; revoked: true }>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/authority-grants/${encodeURIComponent(grantId)}/revoke`
    );
  }

  createDecisionContext(graphKey: string, input: CreateDecisionContextInput) {
    return this.post<DecisionContextRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts`,
      input
    );
  }

  listDecisionTemplates(graphKey: string) {
    return this.request<DecisionTemplateCatalogRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-templates`
    );
  }

  createDecisionContextFromTemplate(
    graphKey: string,
    input: CreateDecisionContextFromTemplateInput
  ) {
    return this.post<DecisionContextRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/from-template`,
      input
    );
  }

  listDecisionContexts(graphKey: string, limit = 50) {
    return this.request<DecisionContextRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts?limit=${encodeURIComponent(String(limit))}`
    );
  }

  getDecisionContext(graphKey: string, contextKey: string) {
    return this.request<DecisionContextRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/${encodeURIComponent(contextKey)}`
    );
  }

  reviewDecisionContext(
    graphKey: string,
    contextKey: string,
    input: { status: "ready" | "rejected"; rationale: string }
  ) {
    return this.post<DecisionContextRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/${encodeURIComponent(contextKey)}/review`,
      input
    );
  }

  addRecommendation(
    graphKey: string,
    contextKey: string,
    input: CreateDecisionRecommendationInput
  ) {
    return this.post<DecisionRecommendationRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/${encodeURIComponent(contextKey)}/recommendations`,
      input
    );
  }

  listRecommendations(graphKey: string, contextKey: string) {
    return this.request<DecisionRecommendationRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/${encodeURIComponent(contextKey)}/recommendations`
    );
  }

  authorizeDecision(
    graphKey: string,
    contextKey: string,
    input: AuthorizeDecisionInput
  ) {
    return this.post<AuthorizedDecisionRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/${encodeURIComponent(contextKey)}/decisions`,
      input
    );
  }

  listAuthorizedDecisions(graphKey: string, contextKey: string) {
    return this.request<AuthorizedDecisionRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-contexts/${encodeURIComponent(contextKey)}/decisions`
    );
  }

  createAction(decisionId: string, input: CreateDecisionActionInput) {
    return this.post<DecisionActionRecord>(
      `/api/v1/decisions/${encodeURIComponent(decisionId)}/actions`,
      input
    );
  }

  listActions(decisionId: string) {
    return this.request<DecisionActionRecord[]>(
      `/api/v1/decisions/${encodeURIComponent(decisionId)}/actions`
    );
  }

  transitionAction(
    actionId: string,
    transition: "approve" | "execute" | "reverse" | "cancel"
  ) {
    return this.request<DecisionActionRecord>(
      `/api/v1/decision-actions/${encodeURIComponent(actionId)}`,
      { method: "PATCH", body: JSON.stringify({ transition }) }
    );
  }

  recordOutcome(decisionId: string, input: CreateDecisionOutcomeInput) {
    return this.post<DecisionOutcomeRecord>(
      `/api/v1/decisions/${encodeURIComponent(decisionId)}/outcomes`,
      input
    );
  }

  listOutcomes(decisionId: string) {
    return this.request<DecisionOutcomeRecord[]>(
      `/api/v1/decisions/${encodeURIComponent(decisionId)}/outcomes`
    );
  }

  listReasoningPolicies(graphKey: string) {
    return this.request<ReasoningPolicyRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies`
    );
  }

  getActiveReasoningPolicy(graphKey: string, decisionType: string) {
    return this.request<ActiveReasoningPolicyRecord | null>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies/active?decisionType=${encodeURIComponent(decisionType)}`
    );
  }

  createReasoningPolicy(graphKey: string, input: CreateReasoningPolicyInput) {
    return this.post<ReasoningPolicyRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies`,
      input
    );
  }

  listReasoningPolicyVersions(graphKey: string, policyKey: string) {
    return this.request<ReasoningPolicyVersionRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies/${encodeURIComponent(policyKey)}/versions`
    );
  }

  createReasoningPolicyVersion(
    graphKey: string,
    policyKey: string,
    input: CreateReasoningPolicyVersionInput
  ) {
    return this.post<ReasoningPolicyVersionRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies/${encodeURIComponent(policyKey)}/versions`,
      input
    );
  }

  reviewReasoningPolicyVersion(
    graphKey: string,
    policyKey: string,
    policyVersion: string,
    input: { status: "accepted" | "rejected"; rationale: string }
  ) {
    return this.post<ReasoningPolicyVersionRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies/${encodeURIComponent(policyKey)}/versions/${encodeURIComponent(policyVersion)}/review`,
      input
    );
  }

  deployReasoningPolicyVersion(
    graphKey: string,
    policyKey: string,
    policyVersion: string
  ) {
    return this.post<ReasoningPolicyVersionRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/reasoning-policies/${encodeURIComponent(policyKey)}/versions/${encodeURIComponent(policyVersion)}/deploy`
    );
  }

  getDecisionLearningSnapshot(graphKey: string) {
    return this.request<DecisionLearningSnapshot>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-learning`
    );
  }

  createDecisionEpisode(graphKey: string, input: CreateDecisionEpisodeInput) {
    return this.post<DecisionEpisodeRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-episodes`,
      input
    );
  }

  listDecisionEpisodes(graphKey: string) {
    return this.request<DecisionEpisodeRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/decision-episodes`
    );
  }

  getDecisionEpisode(episodeId: string) {
    return this.request<DecisionEpisodeRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}`
    );
  }

  bindDecisionEpisode(episodeId: string, authorizedDecisionId: string) {
    return this.request<DecisionEpisodeRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}`,
      { method: "PATCH", body: JSON.stringify({ authorizedDecisionId }) }
    );
  }

  recordReasoningRun(episodeId: string, input: CreateReasoningRunInput) {
    return this.post<ReasoningRunRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/reasoning-runs`,
      input
    );
  }

  listReasoningRuns(episodeId: string) {
    return this.request<ReasoningRunRecord[]>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/reasoning-runs`
    );
  }

  createExecutionAttempt(
    actionId: string,
    input: CreateActionExecutionAttemptInput
  ) {
    return this.post<ActionExecutionAttemptRecord>(
      `/api/v1/decision-actions/${encodeURIComponent(actionId)}/execution-attempts`,
      input
    );
  }

  listExecutionAttempts(actionId: string) {
    return this.request<ActionExecutionAttemptRecord[]>(
      `/api/v1/decision-actions/${encodeURIComponent(actionId)}/execution-attempts`
    );
  }

  recordExecutionReceipt(
    attemptId: string,
    input: CreateExecutionReceiptInput
  ) {
    return this.post<ExecutionReceiptRecord>(
      `/api/v1/execution-attempts/${encodeURIComponent(attemptId)}/receipts`,
      input
    );
  }

  listExecutionReceipts(attemptId: string) {
    return this.request<ExecutionReceiptRecord[]>(
      `/api/v1/execution-attempts/${encodeURIComponent(attemptId)}/receipts`
    );
  }

  recordEpisodeObservation(
    episodeId: string,
    input: CreateEpisodeObservationInput
  ) {
    return this.post<EpisodeObservationRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/observations`,
      input
    );
  }

  listEpisodeObservations(episodeId: string) {
    return this.request<EpisodeObservationRecord[]>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/observations`
    );
  }

  assessEpisodeReward(episodeId: string, input: CreateRewardAssessmentInput) {
    return this.post<RewardAssessmentRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/reward-assessments`,
      input
    );
  }

  waiveRewardAssessmentGuardrail(
    episodeId: string,
    assessmentId: string,
    rationale: string
  ) {
    return this.post<RewardAssessmentRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/reward-assessments/${encodeURIComponent(assessmentId)}/waive`,
      { rationale }
    );
  }

  listRewardAssessments(episodeId: string) {
    return this.request<RewardAssessmentRecord[]>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/reward-assessments`
    );
  }

  closeDecisionEpisode(episodeId: string, rationale: string) {
    return this.post<DecisionEpisodeRecord>(
      `/api/v1/decision-episodes/${encodeURIComponent(episodeId)}/close`,
      { rationale }
    );
  }

  createLearningCandidate(graphKey: string, input: CreateLearningCandidateInput) {
    return this.post<LearningCandidateRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/learning-candidates`,
      input
    );
  }

  listLearningCandidates(graphKey: string) {
    return this.request<LearningCandidateRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/learning-candidates`
    );
  }

  evaluateLearningCandidate(candidateId: string, input: CreatePolicyEvaluationInput) {
    return this.post<PolicyEvaluationRecord>(
      `/api/v1/learning-candidates/${encodeURIComponent(candidateId)}/evaluations`,
      input
    );
  }

  listPolicyEvaluations(candidateId: string) {
    return this.request<PolicyEvaluationRecord[]>(
      `/api/v1/learning-candidates/${encodeURIComponent(candidateId)}/evaluations`
    );
  }

  promoteLearningCandidate(
    candidateId: string,
    input: { targetCohort?: JsonObject; reviewRationale: string; deploy?: boolean }
  ) {
    return this.post<{
      promotion: PolicyPromotionRecord;
      policyVersion: ReasoningPolicyVersionRecord;
    }>(`/api/v1/learning-candidates/${encodeURIComponent(candidateId)}/promote`, input);
  }

  rollbackPolicyPromotion(promotionId: string, rationale: string) {
    return this.post<PolicyPromotionRecord>(
      `/api/v1/policy-promotions/${encodeURIComponent(promotionId)}/rollback`,
      { rationale }
    );
  }

  draftPublication(
    sourceGraphKey: string,
    input: CreateKnowledgePublicationInput
  ) {
    return this.post<KnowledgePublicationRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(sourceGraphKey)}/publications`,
      input
    );
  }

  listPublications(
    graphKey: string,
    direction: "source" | "target" | "both" = "both"
  ) {
    return this.request<KnowledgePublicationRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/publications?direction=${direction}`
    );
  }

  publishPublication(publicationKey: string) {
    return this.post<KnowledgePublicationRecord>(
      `/api/v1/publications/${encodeURIComponent(publicationKey)}/publish`
    );
  }

  revokePublication(publicationKey: string, reason: string) {
    return this.post<KnowledgePublicationRecord>(
      `/api/v1/publications/${encodeURIComponent(publicationKey)}/revoke`,
      { reason }
    );
  }

  listSharedPatternCohorts(graphKey: string) {
    return this.request<SharedPatternCohortRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/shared-pattern-cohorts`
    );
  }

  createSharedPatternCohort(
    graphKey: string,
    input: CreateSharedPatternCohortInput
  ) {
    return this.post<SharedPatternCohortRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/shared-pattern-cohorts`,
      input
    );
  }

  listSharedPatterns(graphKey: string) {
    return this.request<SharedPatternRecord[]>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/shared-patterns`
    );
  }

  createSharedPattern(graphKey: string, input: CreateSharedPatternInput) {
    return this.post<SharedPatternRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/shared-patterns`,
      input
    );
  }

  reviewSharedPattern(
    graphKey: string,
    patternKey: string,
    status: "accepted" | "rejected"
  ) {
    return this.post<SharedPatternRecord>(
      `/api/v1/knowledge-graphs/${encodeURIComponent(graphKey)}/shared-patterns/${encodeURIComponent(patternKey)}/review`,
      { status }
    );
  }

  getWorkspaceKnowledgeNetwork(workspaceSlug: string) {
    return this.request<WorkspaceKnowledgeNetworkSnapshot>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/knowledge-network`
    );
  }
}
