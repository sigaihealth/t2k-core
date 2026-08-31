import type {
  JsonObject,
  JsonValue,
  RewardDimensionAssessment,
  RewardDimensionSpec,
} from "./types.js";
import { canonicalJson, compareCanonicalStrings } from "./compiler.js";
import { parseExplicitTimestamp } from "./reference-time.js";

export interface ReferenceRewardObservation {
  measureRef: string;
  observedValue: JsonValue;
  baselineValue: JsonValue | null;
  observationWindow: string;
  observedAt: string;
  sourceRefs?: string[];
  provenance?: JsonObject;
  attributionConfidence?: number | null;
  acceptedClaimId?: string | null;
}

export type ReferenceRewardEvidenceMode = "legacy" | "strict";

export interface ReferenceRewardEvaluation {
  dimensions: RewardDimensionAssessment[];
  scalarReward: number | null;
  evaluationReward: number | null;
  lifecycleStatus: "complete" | "incomplete" | "guardrail_violation";
}

export const REFERENCE_GUARDRAIL_EVALUATION_PENALTY = -1;

export class ReferenceRewardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceRewardError";
  }
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReferenceRewardError(`${label} must be a finite number.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string) {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw new ReferenceRewardError(`${label} must be greater than zero.`);
  }
  return number;
}

function validateRewardSpec(rewardSpec: RewardDimensionSpec[]) {
  if (!Array.isArray(rewardSpec) || rewardSpec.length === 0) {
    throw new ReferenceRewardError("Reward evaluation requires at least one dimension.");
  }
  const keys = new Set<string>();
  return rewardSpec.map((dimension, index) => {
    const label = `rewardSpec[${index}]`;
    if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)) {
      throw new ReferenceRewardError(`${label} must be an object.`);
    }
    if (!dimension.measureRef?.trim()) {
      throw new ReferenceRewardError(`${label}.measureRef is required.`);
    }
    if (!dimension.observationWindow?.trim()) {
      throw new ReferenceRewardError(`${label}.observationWindow is required.`);
    }
    const key = `${dimension.measureRef.trim()}\u0000${dimension.observationWindow.trim()}`;
    if (keys.has(key)) {
      throw new ReferenceRewardError(
        `${label} duplicates the same measure and observation window.`
      );
    }
    keys.add(key);
    if (!(["maximize", "minimize", "target", "range"] as const).includes(
      dimension.direction
    )) {
      throw new ReferenceRewardError(`${label}.direction is unsupported.`);
    }
    if (
      !(["latest", "sum", "average", "minimum", "maximum"] as const).includes(
        dimension.aggregation
      )
    ) {
      throw new ReferenceRewardError(`${label}.aggregation is unsupported.`);
    }
    if (
      !(["explicit", "previous_state", "control", "none"] as const).includes(
        dimension.baselineMethod
      )
    ) {
      throw new ReferenceRewardError(`${label}.baselineMethod is unsupported.`);
    }
    if (
      !([
        "direct",
        "human_review",
        "comparison",
        "experiment",
        "unknown",
      ] as const).includes(dimension.attributionMethod)
    ) {
      throw new ReferenceRewardError(`${label}.attributionMethod is unsupported.`);
    }
    if (typeof dimension.required !== "boolean") {
      throw new ReferenceRewardError(`${label}.required must be boolean.`);
    }
    if (typeof dimension.guardrail !== "boolean") {
      throw new ReferenceRewardError(`${label}.guardrail must be boolean.`);
    }
    positiveNumber(dimension.weight, `${label}.weight`);
    if (dimension.tolerance !== undefined) {
      positiveNumber(dimension.tolerance, `${label}.tolerance`);
    }
    if (dimension.direction === "target") {
      finiteNumber(dimension.target, `${label}.target`);
    }
    if (dimension.direction === "range") {
      const minimum = finiteNumber(dimension.minimum, `${label}.minimum`);
      const maximum = finiteNumber(dimension.maximum, `${label}.maximum`);
      if (minimum > maximum) {
        throw new ReferenceRewardError(
          `${label}.minimum must be less than or equal to maximum.`
        );
      }
    }
    return {
      ...dimension,
      measureRef: dimension.measureRef.trim(),
      observationWindow: dimension.observationWindow.trim(),
    };
  });
}

function clampScore(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function aggregateNumbers(
  values: number[],
  aggregation: RewardDimensionSpec["aggregation"]
) {
  if (aggregation === "sum") {
    return values.reduce((total, value) => total + value, 0);
  }
  if (aggregation === "average") {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  if (aggregation === "minimum") return Math.min(...values);
  return Math.max(...values);
}

function aggregateObservation(
  spec: RewardDimensionSpec,
  observations: ReferenceRewardObservation[]
) {
  const matches = observations
    .filter(
      (observation) =>
        observation.measureRef === spec.measureRef &&
        observation.observationWindow === spec.observationWindow
    )
    .sort((left, right) => {
      const timestampOrder = compareCanonicalStrings(
        left.observedAt,
        right.observedAt
      );
      return (
        timestampOrder ||
        compareCanonicalStrings(canonicalJson(left), canonicalJson(right))
      );
    });
  if (matches.length === 0) {
    return {
      observedValue: null as JsonValue | null,
      baselineValue: null as JsonValue | null,
      matches,
    };
  }
  const latest = matches[matches.length - 1]!;
  if (spec.aggregation === "latest") {
    const latestValues = new Set(
      matches
        .filter((match) => match.observedAt === latest.observedAt)
        .map((match) =>
          canonicalJson({
            observedValue: match.observedValue,
            baselineValue: match.baselineValue,
          })
        )
    );
    if (latestValues.size > 1) {
      throw new ReferenceRewardError(
        `Reward dimension ${spec.measureRef} has conflicting latest observations at ${latest.observedAt}.`
      );
    }
    return {
      observedValue: latest.observedValue,
      baselineValue: latest.baselineValue,
      matches,
    };
  }
  const observedValues = matches.map((item) => item.observedValue);
  if (
    observedValues.some(
      (value) => typeof value !== "number" || !Number.isFinite(value)
    )
  ) {
    throw new ReferenceRewardError(
      `Reward dimension ${spec.measureRef} requires only finite numeric observations for ${spec.aggregation} aggregation.`
    );
  }
  const baselineValues = matches.map((item) => item.baselineValue);
  const baselineValue = baselineValues.every((value) => value === null)
    ? null
    : baselineValues.every(
          (value) => typeof value === "number" && Number.isFinite(value)
        )
      ? aggregateNumbers(baselineValues as number[], spec.aggregation)
      : (() => {
          throw new ReferenceRewardError(
            `Reward dimension ${spec.measureRef} requires baselines to be all finite numbers or all null for ${spec.aggregation} aggregation.`
          );
        })();
  return {
    observedValue: aggregateNumbers(
      observedValues as number[],
      spec.aggregation
    ),
    baselineValue,
    matches,
  };
}

function hasProvenanceRef(
  observation: ReferenceRewardObservation,
  field: string
) {
  const value = observation.provenance?.[field];
  return typeof value === "string" && value.trim().length > 0;
}

function strictEvidenceFailure(
  spec: RewardDimensionSpec,
  observations: ReferenceRewardObservation[]
) {
  if (observations.length === 0) return null;
  if (
    spec.baselineMethod === "previous_state" &&
    !observations.every((observation) =>
      hasProvenanceRef(observation, "previousStateRef")
    )
  ) {
    return "Previous-state baselines require provenance.previousStateRef on every matched observation.";
  }
  if (
    spec.baselineMethod === "control" &&
    !observations.every((observation) =>
      hasProvenanceRef(observation, "controlRef")
    )
  ) {
    return "Control baselines require provenance.controlRef on every matched observation.";
  }
  if (
    spec.baselineMethod === "none" &&
    (spec.direction === "maximize" || spec.direction === "minimize")
  ) {
    return "Directional reward evaluation requires a declared baseline method.";
  }

  if (spec.attributionMethod === "unknown") {
    return "Unknown attribution cannot complete strict reward evidence evaluation.";
  }
  if (
    spec.attributionMethod === "direct" &&
    !observations.every(
      (observation) =>
        Boolean(observation.acceptedClaimId?.trim()) ||
        Boolean(observation.sourceRefs?.some((sourceRef) => sourceRef.trim()))
    )
  ) {
    return "Direct attribution requires a source reference or accepted claim on every matched observation.";
  }
  const attributionRefByMethod = {
    human_review: "humanReviewRef",
    comparison: "comparisonRef",
    experiment: "experimentRef",
  } as const;
  if (spec.attributionMethod in attributionRefByMethod) {
    const evidenceRef =
      attributionRefByMethod[
        spec.attributionMethod as keyof typeof attributionRefByMethod
      ];
    if (
      !observations.every((observation) =>
        hasProvenanceRef(observation, evidenceRef)
      )
    ) {
      return `${spec.attributionMethod} attribution requires provenance.${evidenceRef} on every matched observation.`;
    }
  }
  return null;
}

/** Compute a governed reward vector from observations; callers cannot provide a verdict. */
export function evaluateReferenceReward(input: {
  rewardSpec: RewardDimensionSpec[];
  observations: ReferenceRewardObservation[];
  evidenceMode?: ReferenceRewardEvidenceMode;
}): ReferenceRewardEvaluation {
  const rewardSpec = validateRewardSpec(input.rewardSpec);
  const evidenceMode = input.evidenceMode ?? "legacy";
  if (evidenceMode !== "legacy" && evidenceMode !== "strict") {
    throw new ReferenceRewardError("evidenceMode must be legacy or strict.");
  }
  if (!Array.isArray(input.observations)) {
    throw new ReferenceRewardError("observations must be an array.");
  }
  const observations = input.observations.map((observation, index) => {
    if (
      !observation ||
      typeof observation !== "object" ||
      Array.isArray(observation)
    ) {
      throw new ReferenceRewardError(`observations[${index}] must be an object.`);
    }
    if (!observation.measureRef?.trim()) {
      throw new ReferenceRewardError(`observations[${index}].measureRef is required.`);
    }
    if (!observation.observationWindow?.trim()) {
      throw new ReferenceRewardError(
        `observations[${index}].observationWindow is required.`
      );
    }
    const observedAt =
      typeof observation.observedAt === "string"
        ? parseExplicitTimestamp(observation.observedAt)
        : null;
    if (observedAt === null) {
      throw new ReferenceRewardError(
        `observations[${index}].observedAt must be a valid ISO timestamp with an explicit UTC offset.`
      );
    }
    if (observation.observedValue === undefined) {
      throw new ReferenceRewardError(
        `observations[${index}].observedValue is required.`
      );
    }
    if (
      (typeof observation.observedValue === "number" &&
        !Number.isFinite(observation.observedValue)) ||
      (typeof observation.baselineValue === "number" &&
        !Number.isFinite(observation.baselineValue))
    ) {
      throw new ReferenceRewardError(
        `observations[${index}] contains a non-finite number.`
      );
    }
    if (
      observation.sourceRefs !== undefined &&
      (!Array.isArray(observation.sourceRefs) ||
        observation.sourceRefs.some(
          (sourceRef) => typeof sourceRef !== "string" || !sourceRef.trim()
        ))
    ) {
      throw new ReferenceRewardError(
        `observations[${index}].sourceRefs must contain only nonblank strings.`
      );
    }
    if (
      observation.provenance !== undefined &&
      (!observation.provenance ||
        typeof observation.provenance !== "object" ||
        Array.isArray(observation.provenance))
    ) {
      throw new ReferenceRewardError(
        `observations[${index}].provenance must be an object.`
      );
    }
    if (
      observation.attributionConfidence !== undefined &&
      observation.attributionConfidence !== null &&
      (typeof observation.attributionConfidence !== "number" ||
        !Number.isFinite(observation.attributionConfidence) ||
        observation.attributionConfidence < 0 ||
        observation.attributionConfidence > 1)
    ) {
      throw new ReferenceRewardError(
        `observations[${index}].attributionConfidence must be between zero and one.`
      );
    }
    if (
      observation.acceptedClaimId !== undefined &&
      observation.acceptedClaimId !== null &&
      (typeof observation.acceptedClaimId !== "string" ||
        !observation.acceptedClaimId.trim())
    ) {
      throw new ReferenceRewardError(
        `observations[${index}].acceptedClaimId must be a nonblank string or null.`
      );
    }
    return {
      ...observation,
      measureRef: observation.measureRef.trim(),
      observationWindow: observation.observationWindow.trim(),
      observedAt: new Date(observedAt).toISOString(),
    };
  });
  const dimensions: RewardDimensionAssessment[] = rewardSpec.map((spec) => {
    const { observedValue, baselineValue, matches } = aggregateObservation(
      spec,
      observations
    );
    const evidenceFailure =
      evidenceMode === "strict" ? strictEvidenceFailure(spec, matches) : null;
    if (evidenceFailure) {
      return {
        measureRef: spec.measureRef,
        direction: spec.direction,
        observedValue,
        baselineValue,
        score: null,
        weight: spec.weight,
        weightedScore: null,
        guardrail: spec.guardrail,
        guardrailViolated: false,
        complete: !spec.required,
        explanation: evidenceFailure,
      };
    }
    if (typeof observedValue !== "number" || !Number.isFinite(observedValue)) {
      return {
        measureRef: spec.measureRef,
        direction: spec.direction,
        observedValue,
        baselineValue,
        score: null,
        weight: spec.weight,
        weightedScore: null,
        guardrail: spec.guardrail,
        guardrailViolated: false,
        complete: !spec.required,
        explanation: "No numeric observation matched the required measurement window.",
      };
    }

    let score: number | null = null;
    let explanation = "";
    if (spec.direction === "maximize" || spec.direction === "minimize") {
      if (typeof baselineValue !== "number" || !Number.isFinite(baselineValue)) {
        explanation = "A numeric baseline is required for directional reward evaluation.";
      } else {
        const scale = Math.max(Math.abs(baselineValue), spec.tolerance ?? 1e-9);
        const delta = (observedValue - baselineValue) / scale;
        score = clampScore(spec.direction === "maximize" ? delta : -delta);
        explanation = `${spec.direction} score compares the observation with its baseline.`;
      }
    } else if (spec.direction === "target") {
      const target = spec.target!;
      const tolerance = spec.tolerance ?? Math.max(Math.abs(target) * 0.1, 1e-9);
      score = clampScore(1 - Math.abs(observedValue - target) / tolerance);
      explanation = "Target score reflects distance from the declared target and tolerance.";
    } else {
      const minimum = spec.minimum!;
      const maximum = spec.maximum!;
      if (observedValue >= minimum && observedValue <= maximum) {
        score = 1;
      } else {
        const width = Math.max(maximum - minimum, spec.tolerance ?? 1e-9);
        const distance =
          observedValue < minimum
            ? minimum - observedValue
            : observedValue - maximum;
        score = clampScore(-distance / width);
      }
      explanation =
        "Range score is positive only when the observation remains inside the guardrail.";
    }
    return {
      measureRef: spec.measureRef,
      direction: spec.direction,
      observedValue,
      baselineValue,
      score,
      weight: spec.weight,
      weightedScore: score === null ? null : score * spec.weight,
      guardrail: spec.guardrail,
      guardrailViolated: spec.guardrail && score !== null && score < 0,
      complete: score !== null || !spec.required,
      explanation,
    };
  });

  const requiredComplete = dimensions.every((dimension) => dimension.complete);
  const scored = dimensions.filter(
    (dimension): dimension is RewardDimensionAssessment & { weightedScore: number } =>
      dimension.weightedScore !== null
  );
  const totalWeight = scored.reduce(
    (total, dimension) => total + dimension.weight,
    0
  );
  const guardrailViolated = dimensions.some(
    (dimension) => dimension.guardrailViolated
  );
  const weightedReward =
    requiredComplete && totalWeight > 0
      ? scored.reduce(
          (total, dimension) => total + dimension.weightedScore,
          0
        ) / totalWeight
      : null;
  const scalarReward = guardrailViolated ? null : weightedReward;
  const evaluationReward = guardrailViolated
    ? REFERENCE_GUARDRAIL_EVALUATION_PENALTY
    : weightedReward;

  return {
    dimensions,
    scalarReward,
    evaluationReward,
    lifecycleStatus: requiredComplete
      ? guardrailViolated
        ? "guardrail_violation"
        : "complete"
      : "incomplete",
  };
}
