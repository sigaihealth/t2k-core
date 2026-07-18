import {
  DECISION_LEARNING_MODES,
  REWARD_DIRECTIONS,
  type DecisionLearningContract,
  type DecisionLearningMode,
  type JsonObject,
  type JsonValue,
  type RewardDimensionSpec,
  type RewardDirection,
} from "./types.js";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import ontologyPackSchema from "./schema/t2k-ontology-pack.v1.schema.json" with {
  type: "json",
};

export const ONTOLOGY_PACK_MANIFEST_TYPE = "t2k.ontology-pack";

export const ONTOLOGY_NODE_KINDS = [
  "person",
  "organization",
  "diagnosis",
  "symptom",
  "claim",
  "gap",
  "artifact",
  "risk",
  "workspace",
  "authority",
  "source",
  "operating-entity",
  "financial-event",
  "workflow",
  "case",
  "action",
  "freshness",
  "outcome",
  "reference",
] as const;

export type OntologyNodeKind = (typeof ONTOLOGY_NODE_KINDS)[number];
export type OntologyPackKind =
  | "core"
  | "context"
  | "vertical"
  | "workflow"
  | "project";
export type OntologyPackDialect = "t2k" | "transferos-legacy";

export interface OntologyPackPropertyDefinition {
  id: string;
  valueType: string;
  required: boolean;
  description: string;
  authorityDomain: string;
  temporal: boolean;
}

export interface OntologyPackObjectType {
  id: string;
  label: string;
  family: string;
  nodeKind: OntologyNodeKind | null;
  identity: string[];
  purpose: string;
  properties: OntologyPackPropertyDefinition[];
  specializes: string;
  replaces: string;
  compatibilityNote: string;
}

export interface OntologyPackStructuralRelationship {
  from: string;
  property: string;
  to: string;
  cardinality: string;
  description: string;
}

export interface OntologyPackCanonicalLink {
  link: string;
  use: string;
}

export interface OntologyPackSourceMapping {
  id: string;
  sourceType: string;
  sourceLocator: string;
  fields: string;
  sheet: string;
  range: string;
  headers: string;
  object: string;
  properties: string;
  transform: string;
  authority: string;
  riskTier: string;
  reviewStatus: string;
}

export interface OntologyPackAuthorityRule {
  domain: string;
  authority: string;
  status: string;
  scope: string;
  effectiveFrom: string;
  reviewDueAt: string;
}

export interface OntologyPackEventType {
  id: string;
  source: string;
  createsOrUpdates: string;
  humanCheckpoint: string;
}

export interface OntologyPackReasoningFunction {
  id: string;
  input: string;
  output: string;
  humanCheckpoint: string;
}

export interface OntologyPackOpenQuestion {
  id: string;
  question: string;
  owner: string;
  blocks: string;
}

export interface OntologyPackScope {
  domain: string;
  description: string;
  jurisdictions: string[];
  industries: string[];
  businessStages: string[];
  organizationSizes: string[];
  exclusions: string[];
}

export interface OntologyPackDependency {
  ontologyId: string;
  version: string;
  required: boolean;
}

export interface OntologyPackContextDimension {
  id: string;
  description: string;
  requirement: string;
  allowedValues: string[];
  sourceRequired: boolean;
}

export interface OntologyPackDecisionTemplate {
  id: string;
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
  assumptions: string[];
  forecasts: string[];
  uncertainties: string[];
  freshnessLimit: string;
  authority: string;
  delegation: string;
  approvalLimit: string;
  riskLevel: string;
  allowedActionProposals: string[];
  rollbackExpectation: string;
  outcomeMeasures: string[];
  reviewHorizon: string;
  learningContract: DecisionLearningContract;
}

export interface OntologyPackValidationRule {
  id: string;
  level: string;
  severity: string;
  target: string;
  assertion: string;
  message: string;
}

export interface OntologyPackManifest {
  dialect: OntologyPackDialect;
  manifestType: string;
  manifestVersion: string;
  ontologyVersion: string;
  ontologyId: string;
  label: string;
  description: string;
  packKind: OntologyPackKind | "legacy";
  status: string;
  scope: OntologyPackScope;
  extends: OntologyPackDependency[];
  contextDimensions: OntologyPackContextDimension[];
  objectTypes: OntologyPackObjectType[];
  structuralRelationships: OntologyPackStructuralRelationship[];
  canonicalLinks: OntologyPackCanonicalLink[];
  sourceMappings: OntologyPackSourceMapping[];
  authorityModel: OntologyPackAuthorityRule[];
  eventTypes: OntologyPackEventType[];
  reasoningFunctions: OntologyPackReasoningFunction[];
  decisionTemplates: OntologyPackDecisionTemplate[];
  normalizationRules: string[];
  validationRules: OntologyPackValidationRule[];
  openSemanticQuestions: OntologyPackOpenQuestion[];
  extensions: JsonObject;
}

export interface OntologyPackManifestValidationError {
  path: string;
  keyword: string;
  message: string;
}

export interface OntologyPackManifestValidationResult {
  valid: boolean;
  errors: OntologyPackManifestValidationError[];
}

const ontologyPackValidator = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
}).compile(ontologyPackSchema);

function formatValidationError(
  error: ErrorObject
): OntologyPackManifestValidationError {
  const missingProperty =
    error.keyword === "required" &&
    typeof error.params.missingProperty === "string"
      ? `/${error.params.missingProperty}`
      : "";
  const path = `${error.instancePath}${missingProperty}` || "/";
  return {
    path,
    keyword: error.keyword,
    message: error.message ?? "does not satisfy the ontology pack schema",
  };
}

/** Validate a current T2K manifest against the exact published JSON Schema. */
export function validateOntologyPackManifest(
  value: unknown
): OntologyPackManifestValidationResult {
  const valid = ontologyPackValidator(value);
  return {
    valid,
    errors: valid
      ? []
      : (ontologyPackValidator.errors ?? []).map(formatValidationError),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readString).filter((item) => item.length > 0)
    : [];
}

function readRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(readJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, readJsonValue(item)])
    );
  }
  return null;
}

function readJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? (readJsonValue(value) as JsonObject) : {};
}

function readLearningMode(value: unknown): DecisionLearningMode {
  const mode = readString(value) as DecisionLearningMode;
  return DECISION_LEARNING_MODES.includes(mode) ? mode : "none";
}

function readRewardDirection(value: unknown): RewardDirection {
  const direction = readString(value) as RewardDirection;
  return REWARD_DIRECTIONS.includes(direction) ? direction : "maximize";
}

function readRewardSpec(value: unknown): RewardDimensionSpec[] {
  return readRecordArray(value)
    .map((item) => {
      const aggregation = readString(item.aggregation);
      const baselineMethod = readString(item.baselineMethod);
      const attributionMethod = readString(item.attributionMethod);
      return {
        measureRef: readString(item.measureRef),
        label: readString(item.label) || readString(item.measureRef),
        direction: readRewardDirection(item.direction),
        weight: Math.max(0, readNumber(item.weight, 1)),
        required: readBoolean(item.required, true),
        guardrail: readBoolean(item.guardrail),
        ...(readString(item.unit) ? { unit: readString(item.unit) } : {}),
        ...(readOptionalNumber(item.target) === undefined
          ? {}
          : { target: readOptionalNumber(item.target) }),
        ...(readOptionalNumber(item.minimum) === undefined
          ? {}
          : { minimum: readOptionalNumber(item.minimum) }),
        ...(readOptionalNumber(item.maximum) === undefined
          ? {}
          : { maximum: readOptionalNumber(item.maximum) }),
        ...(readOptionalNumber(item.tolerance) === undefined
          ? {}
          : { tolerance: readOptionalNumber(item.tolerance) }),
        observationWindow: readString(item.observationWindow),
        aggregation:
          aggregation === "sum" ||
          aggregation === "average" ||
          aggregation === "minimum" ||
          aggregation === "maximum"
            ? aggregation
            : "latest",
        baselineMethod:
          baselineMethod === "previous_state" ||
          baselineMethod === "control" ||
          baselineMethod === "none"
            ? baselineMethod
            : "explicit",
        attributionMethod:
          attributionMethod === "direct" ||
          attributionMethod === "human_review" ||
          attributionMethod === "comparison" ||
          attributionMethod === "experiment"
            ? attributionMethod
            : "unknown",
      } satisfies RewardDimensionSpec;
    })
    .filter((item) => item.measureRef);
}

function readLearningContract(value: unknown): DecisionLearningContract {
  const contract = isRecord(value) ? value : {};
  return {
    mode: readLearningMode(contract.mode),
    stateSchema: readJsonObject(contract.stateSchema),
    actionSchema: readJsonObject(contract.actionSchema),
    rewardSpec: readRewardSpec(contract.rewardSpec),
    observationSchedule: readStringArray(contract.observationSchedule),
    terminalConditions: readStringArray(contract.terminalConditions),
    explorationPolicy: readJsonObject(contract.explorationPolicy),
    safetyConstraints: Array.isArray(contract.safetyConstraints)
      ? contract.safetyConstraints.map(readJsonValue)
      : [],
    promotionCriteria: readJsonObject(contract.promotionCriteria),
  };
}

function readNodeKind(value: unknown): OntologyNodeKind | null {
  const nodeKind = readString(value) as OntologyNodeKind;
  return ONTOLOGY_NODE_KINDS.includes(nodeKind) ? nodeKind : null;
}

const ONTOLOGY_PACK_KINDS = new Set<OntologyPackKind>([
  "core",
  "context",
  "vertical",
  "workflow",
  "project",
]);

/** Normalize a current T2K manifest or supported TransferOS legacy manifest. */
export function parseOntologyPackManifest(
  value: unknown
): OntologyPackManifest | null {
  if (!isRecord(value)) {
    return null;
  }

  const manifestType = readString(value.manifestType);
  const dialect: OntologyPackDialect = manifestType ? "t2k" : "transferos-legacy";

  if (manifestType && manifestType !== ONTOLOGY_PACK_MANIFEST_TYPE) {
    return null;
  }

  if (manifestType) {
    const validation = validateOntologyPackManifest(value);
    if (!validation.valid) {
      return null;
    }
  }

  const manifestVersion = readString(value.manifestVersion);
  const ontologyVersion = readString(value.ontologyVersion);
  const ontologyId = readString(value.ontologyId);
  const label = readString(value.label);
  const rawPackKind = readString(value.packKind);
  const scopeValue = isRecord(value.scope) ? value.scope : {};
  const scope: OntologyPackScope = {
    domain: readString(scopeValue.domain),
    description: readString(scopeValue.description),
    jurisdictions: readStringArray(scopeValue.jurisdictions),
    industries: readStringArray(scopeValue.industries),
    businessStages: readStringArray(scopeValue.businessStages),
    organizationSizes: readStringArray(scopeValue.organizationSizes),
    exclusions: readStringArray(scopeValue.exclusions),
  };
  const objectTypes = readRecordArray(value.objectTypes)
    .map((item) => ({
      id: readString(item.id),
      label: readString(item.label) || readString(item.id),
      family: readString(item.family),
      nodeKind: readNodeKind(item.nodeKind),
      identity: readStringArray(item.identity),
      purpose: readString(item.purpose),
      properties: readRecordArray(item.properties)
        .map((property) => ({
          id: readString(property.id),
          valueType: readString(property.valueType),
          required: readBoolean(property.required),
          description: readString(property.description),
          authorityDomain: readString(property.authorityDomain),
          temporal: readBoolean(property.temporal),
        }))
        .filter((property) => property.id && property.valueType),
      specializes: readString(item.specializes),
      replaces: readString(item.replaces),
      compatibilityNote: readString(item.compatibilityNote),
    }))
    .filter((item) => item.id && item.family);

  if (
    !manifestVersion ||
    !ontologyId ||
    objectTypes.length === 0 ||
    (dialect === "t2k" &&
      (!label ||
        !ontologyVersion ||
        !ONTOLOGY_PACK_KINDS.has(rawPackKind as OntologyPackKind) ||
        !scope.domain ||
        !scope.description))
  ) {
    return null;
  }

  return {
    dialect,
    manifestType: manifestType || "transferos.legacy-ontology-manifest",
    manifestVersion,
    ontologyVersion: ontologyVersion || manifestVersion,
    ontologyId,
    label: label || "TransferOS ontology manifest",
    description: readString(value.description),
    packKind:
      dialect === "transferos-legacy"
        ? "legacy"
        : (rawPackKind as OntologyPackKind),
    status: readString(value.status) || "unknown",
    scope,
    extends: readRecordArray(value.extends)
      .map((item) => ({
        ontologyId: readString(item.ontologyId),
        version: readString(item.version),
        required: readBoolean(item.required, true),
      }))
      .filter((item) => item.ontologyId && item.version),
    contextDimensions: readRecordArray(value.contextDimensions)
      .map((item) => ({
        id: readString(item.id),
        description: readString(item.description),
        requirement: readString(item.requirement),
        allowedValues: readStringArray(item.allowedValues),
        sourceRequired: readBoolean(item.sourceRequired),
      }))
      .filter((item) => item.id && item.description),
    objectTypes,
    structuralRelationships: readRecordArray(value.structuralRelationships)
      .map((item) => ({
        from: readString(item.from),
        property: readString(item.property),
        to: readString(item.to),
        cardinality: readString(item.cardinality),
        description: readString(item.description),
      }))
      .filter((item) => item.from && item.property && item.to),
    canonicalLinks: readRecordArray(value.canonicalLinks)
      .map((item) => ({
        link: readString(item.link),
        use: readString(item.use),
      }))
      .filter((item) => item.link && item.use),
    sourceMappings: readRecordArray(value.sourceMappings)
      .map((item) => ({
        id: readString(item.id),
        sourceType: readString(item.sourceType),
        sourceLocator: readString(item.sourceLocator),
        fields: readString(item.fields),
        sheet: readString(item.sheet),
        range: readString(item.range),
        headers: readString(item.headers),
        object: readString(item.object),
        properties: readString(item.properties),
        transform: readString(item.transform),
        authority: readString(item.authority),
        riskTier: readString(item.riskTier),
        reviewStatus: readString(item.reviewStatus),
      }))
      .filter((item) => item.id && item.object),
    authorityModel: readRecordArray(value.authorityModel)
      .map((item) => ({
        domain: readString(item.domain),
        authority: readString(item.authority),
        status: readString(item.status),
        scope: readString(item.scope),
        effectiveFrom: readString(item.effectiveFrom),
        reviewDueAt: readString(item.reviewDueAt),
      }))
      .filter((item) => item.domain && item.authority),
    eventTypes: readRecordArray(value.eventTypes)
      .map((item) => ({
        id: readString(item.id),
        source: readString(item.source),
        createsOrUpdates: readString(item.createsOrUpdates),
        humanCheckpoint: readString(item.humanCheckpoint),
      }))
      .filter((item) => item.id),
    reasoningFunctions: readRecordArray(value.reasoningFunctions)
      .map((item) => ({
        id: readString(item.id),
        input: readString(item.input),
        output: readString(item.output),
        humanCheckpoint: readString(item.humanCheckpoint),
      }))
      .filter((item) => item.id),
    decisionTemplates: readRecordArray(value.decisionTemplates)
      .map((item) => ({
        id: readString(item.id),
        question: readString(item.question),
        decisionType: readString(item.decisionType),
        requiredContext: readStringArray(item.requiredContext),
        requiredFacts: readStringArray(item.requiredFacts),
        objective: readString(item.objective),
        successMeasure: readString(item.successMeasure),
        alternatives: readStringArray(item.alternatives),
        criteria: readStringArray(item.criteria),
        comparisonMethod: readString(item.comparisonMethod),
        policies: readStringArray(item.policies),
        assumptions: readStringArray(item.assumptions),
        forecasts: readStringArray(item.forecasts),
        uncertainties: readStringArray(item.uncertainties),
        freshnessLimit: readString(item.freshnessLimit),
        authority: readString(item.authority),
        delegation: readString(item.delegation),
        approvalLimit: readString(item.approvalLimit),
        riskLevel: readString(item.riskLevel),
        allowedActionProposals: readStringArray(item.allowedActionProposals),
        rollbackExpectation: readString(item.rollbackExpectation),
        outcomeMeasures: readStringArray(item.outcomeMeasures),
        reviewHorizon: readString(item.reviewHorizon),
        learningContract: readLearningContract(item.learningContract),
      }))
      .filter((item) => item.id && item.question),
    normalizationRules: readStringArray(value.normalizationRules),
    validationRules: readRecordArray(value.validationRules)
      .map((item) => ({
        id: readString(item.id),
        level: readString(item.level),
        severity: readString(item.severity),
        target: readString(item.target),
        assertion: readString(item.assertion),
        message: readString(item.message),
      }))
      .filter((item) => item.id && item.assertion),
    openSemanticQuestions: readRecordArray(value.openSemanticQuestions)
      .map((item) => ({
        id: readString(item.id),
        question: readString(item.question),
        owner: readString(item.owner),
        blocks: readString(item.blocks),
      }))
      .filter((item) => item.id && item.question),
    extensions: readJsonObject(value.extensions),
  };
}
