import type { DecisionLearningMode, JsonObject, JsonValue } from "./types.js";

export const REFERENCE_POLICY_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "exists",
] as const;

export type ReferencePolicyOperator = (typeof REFERENCE_POLICY_OPERATORS)[number];

export interface ReferencePolicyCondition {
  path: string;
  operator: ReferencePolicyOperator;
  value?: JsonValue;
}

export interface ReferencePolicyRule {
  all: ReferencePolicyCondition[];
  action: string;
}

export interface ReferencePolicySpecification {
  rules: ReferencePolicyRule[];
  defaultAction: string;
  evaluation: {
    minimumEpisodes: number;
    minimumImprovement: number;
    confidenceZ: number;
    minimumCoverage: number;
  };
}

export interface ReferenceReplayEpisode {
  episodeId: string;
  state: JsonObject;
  loggedAction: string;
  scalarReward: number;
  learningMode: DecisionLearningMode;
  behaviorProbability: number | null;
  guardrailViolation: boolean;
}

export interface ReferencePolicyEstimate {
  estimatedReward: number;
  standardError: number;
  confidenceLower: number;
  confidenceUpper: number;
  matchingEpisodes: number;
  coverage: number;
  guardrailViolations: number;
}

export interface ReferenceReplayResult {
  method: "inverse_propensity_score";
  sampleSize: number;
  minimumEpisodes: number;
  minimumCoverage: number;
  statisticallyWeak: boolean;
  candidate: ReferencePolicyEstimate;
  baseline: ReferencePolicyEstimate;
  estimatedImprovement: number;
  improvementStandardError: number;
  improvementConfidenceLower: number;
  improvementConfidenceUpper: number;
  actionChanges: number;
  status: "passed" | "failed" | "needs_review";
  warnings: string[];
  episodeResults: Array<{
    episodeId: string;
    loggedAction: string;
    candidateAction: string;
    baselineAction: string;
    scalarReward: number;
    behaviorProbability: number;
    guardrailViolation: boolean;
  }>;
}

export interface PolicyRewardAggregate {
  policyVersionId: string;
  episodeCount: number;
  meanReward: number;
  standardError: number;
  confidenceLower: number;
  confidenceUpper: number;
  guardrailViolations: number;
}

export class ReferencePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferencePolicyError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string
) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new ReferencePolicyError(
      `${label} contains unsupported fields: ${unexpected.join(", ")}.`
    );
  }
}

function requireAction(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReferencePolicyError(`${label} must be a non-empty action string.`);
  }
  return value.trim();
}

function optionalFiniteNumber(
  value: unknown,
  label: string,
  fallback: number,
  options?: { minimum?: number; maximum?: number; integer?: boolean }
) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReferencePolicyError(`${label} must be a finite number.`);
  }
  if (options?.integer && !Number.isInteger(value)) {
    throw new ReferencePolicyError(`${label} must be an integer.`);
  }
  if (options?.minimum !== undefined && value < options.minimum) {
    throw new ReferencePolicyError(
      `${label} must be at least ${options.minimum}.`
    );
  }
  if (options?.maximum !== undefined && value > options.maximum) {
    throw new ReferencePolicyError(
      `${label} must be at most ${options.maximum}.`
    );
  }
  return value;
}

/** Parse the executable subset of a reasoning policy specification. */
export function parseReferencePolicySpecification(
  specification: JsonObject
): ReferencePolicySpecification {
  const raw = specification.referencePolicy;
  if (!isObject(raw)) {
    throw new ReferencePolicyError(
      "specification.referencePolicy is required for computed replay evaluation."
    );
  }
  assertOnlyKeys(raw, ["rules", "defaultAction", "evaluation"], "referencePolicy");
  if (!Array.isArray(raw.rules)) {
    throw new ReferencePolicyError("referencePolicy.rules must be an array.");
  }
  const rules = raw.rules.map((item, ruleIndex): ReferencePolicyRule => {
    if (!isObject(item) || !Array.isArray(item.all)) {
      throw new ReferencePolicyError(
        `referencePolicy.rules[${ruleIndex}].all must be an array.`
      );
    }
    assertOnlyKeys(item, ["all", "action"], `referencePolicy.rules[${ruleIndex}]`);
    const all = item.all.map((condition, conditionIndex): ReferencePolicyCondition => {
      if (!isObject(condition)) {
        throw new ReferencePolicyError(
          `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}] must be an object.`
        );
      }
      assertOnlyKeys(
        condition,
        ["path", "operator", "value"],
        `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}]`
      );
      const path = typeof condition.path === "string" ? condition.path.trim() : "";
      const operator = condition.operator;
      if (!path) {
        throw new ReferencePolicyError(
          `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}].path is required.`
        );
      }
      if (
        path.split(".").some((segment) =>
          ["__proto__", "prototype", "constructor"].includes(segment)
        )
      ) {
        throw new ReferencePolicyError(
          `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}].path is unsafe.`
        );
      }
      if (
        typeof operator !== "string" ||
        !REFERENCE_POLICY_OPERATORS.includes(operator as ReferencePolicyOperator)
      ) {
        throw new ReferencePolicyError(
          `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}].operator is unsupported.`
        );
      }
      if (operator !== "exists" && condition.value === undefined) {
        throw new ReferencePolicyError(
          `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}].value is required.`
        );
      }
      if (
        operator === "exists" &&
        condition.value !== undefined &&
        typeof condition.value !== "boolean"
      ) {
        throw new ReferencePolicyError(
          `referencePolicy.rules[${ruleIndex}].all[${conditionIndex}].value must be boolean for exists.`
        );
      }
      return {
        path,
        operator: operator as ReferencePolicyOperator,
        ...(condition.value === undefined ? {} : { value: condition.value as JsonValue }),
      };
    });
    return {
      all,
      action: requireAction(item.action, `referencePolicy.rules[${ruleIndex}].action`),
    };
  });
  if (raw.evaluation !== undefined && !isObject(raw.evaluation)) {
    throw new ReferencePolicyError("referencePolicy.evaluation must be an object.");
  }
  const evaluation = isObject(raw.evaluation) ? raw.evaluation : {};
  assertOnlyKeys(
    evaluation,
    ["minimumEpisodes", "minimumImprovement", "confidenceZ", "minimumCoverage"],
    "referencePolicy.evaluation"
  );
  const minimumEpisodes = optionalFiniteNumber(
    evaluation.minimumEpisodes,
    "referencePolicy.evaluation.minimumEpisodes",
    20,
    { minimum: 1, integer: true }
  );
  const minimumImprovement = optionalFiniteNumber(
    evaluation.minimumImprovement,
    "referencePolicy.evaluation.minimumImprovement",
    0
  );
  const confidenceZ = optionalFiniteNumber(
    evaluation.confidenceZ,
    "referencePolicy.evaluation.confidenceZ",
    1.96,
    { minimum: Number.EPSILON }
  );
  const minimumCoverage = optionalFiniteNumber(
    evaluation.minimumCoverage,
    "referencePolicy.evaluation.minimumCoverage",
    0.2,
    { minimum: Number.EPSILON, maximum: 1 }
  );

  return {
    rules,
    defaultAction: requireAction(raw.defaultAction, "referencePolicy.defaultAction"),
    evaluation: {
      minimumEpisodes,
      minimumImprovement,
      confidenceZ,
      minimumCoverage,
    },
  };
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (isObject(current)) {
      return current[segment];
    }
    return undefined;
  }, value);
}

function equivalent(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (
    (Array.isArray(left) || isObject(left)) &&
    (Array.isArray(right) || isObject(right))
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function conditionMatches(state: JsonObject, condition: ReferencePolicyCondition) {
  const actual = valueAtPath(state, condition.path);
  const expected = condition.value;
  switch (condition.operator) {
    case "eq":
      return equivalent(actual, expected);
    case "neq":
      return !equivalent(actual, expected);
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.some((item) => equivalent(actual, item));
    case "contains":
      return Array.isArray(actual) && actual.some((item) => equivalent(item, expected));
    case "exists":
      return expected === false ? actual === undefined : actual !== undefined;
  }
}

export function evaluateReferencePolicy(
  specification: JsonObject | ReferencePolicySpecification,
  state: JsonObject
) {
  const policy = "referencePolicy" in specification
    ? parseReferencePolicySpecification(specification as JsonObject)
    : (specification as ReferencePolicySpecification);
  return (
    policy.rules.find((rule) =>
      rule.all.every((condition) => conditionMatches(state, condition))
    )?.action ?? policy.defaultAction
  );
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardError(values: number[]) {
  if (values.length <= 1) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance / values.length);
}

function replayContributions(
  actions: string[],
  episodes: Array<ReferenceReplayEpisode & { probability: number }>
) {
  return episodes.map((episode, index) =>
    actions[index] === episode.loggedAction
      ? episode.scalarReward / episode.probability
      : 0
  );
}

function estimate(
  actions: string[],
  episodes: Array<ReferenceReplayEpisode & { probability: number }>,
  confidenceZ: number
): ReferencePolicyEstimate {
  const contributions = replayContributions(actions, episodes);
  const estimatedReward = mean(contributions);
  const estimateStandardError = standardError(contributions);
  const matchingEpisodes = actions.filter(
    (action, index) => action === episodes[index]?.loggedAction
  ).length;
  const guardrailViolations = actions.filter(
    (action, index) =>
      action === episodes[index]?.loggedAction && episodes[index]?.guardrailViolation
  ).length;
  return {
    estimatedReward,
    standardError: estimateStandardError,
    confidenceLower: estimatedReward - confidenceZ * estimateStandardError,
    confidenceUpper: estimatedReward + confidenceZ * estimateStandardError,
    matchingEpisodes,
    coverage: matchingEpisodes / episodes.length,
    guardrailViolations,
  };
}

/** Compute a deterministic held-out replay comparison; no caller-supplied verdict is accepted. */
export function evaluateReferenceReplay(input: {
  candidateSpecification: JsonObject;
  baselineSpecification: JsonObject;
  episodes: ReferenceReplayEpisode[];
}): ReferenceReplayResult {
  const candidate = parseReferencePolicySpecification(input.candidateSpecification);
  const baseline = parseReferencePolicySpecification(input.baselineSpecification);
  if (input.episodes.length === 0) {
    throw new ReferencePolicyError("Computed replay requires at least one held-out episode.");
  }
  const warnings: string[] = [];
  const episodes = input.episodes.map((episode) => {
    if (!Number.isFinite(episode.scalarReward)) {
      throw new ReferencePolicyError(
        `Episode ${episode.episodeId} does not have a finite scalar reward.`
      );
    }
    if (
      (episode.learningMode === "contextual_bandit" ||
        episode.learningMode === "sequential_rl") &&
      episode.behaviorProbability === null
    ) {
      throw new ReferencePolicyError(
        `Episode ${episode.episodeId} requires a behavior probability in (0, 1].`
      );
    }
    const probability = episode.behaviorProbability ?? 1;
    if (!Number.isFinite(probability) || probability <= 0 || probability > 1) {
      throw new ReferencePolicyError(
        `Episode ${episode.episodeId} has an invalid behavior probability.`
      );
    }
    return { ...episode, probability };
  });
  const candidateActions = episodes.map((episode) =>
    evaluateReferencePolicy(candidate, episode.state)
  );
  const baselineActions = episodes.map((episode) =>
    evaluateReferencePolicy(baseline, episode.state)
  );
  const confidenceZ = candidate.evaluation.confidenceZ;
  const candidateEstimate = estimate(candidateActions, episodes, confidenceZ);
  const baselineEstimate = estimate(baselineActions, episodes, confidenceZ);
  const estimatedImprovement =
    candidateEstimate.estimatedReward - baselineEstimate.estimatedReward;
  const candidateContributions = replayContributions(candidateActions, episodes);
  const baselineContributions = replayContributions(baselineActions, episodes);
  const improvementContributions = candidateContributions.map(
    (value, index) => value - (baselineContributions[index] ?? 0)
  );
  const improvementStandardError = standardError(improvementContributions);
  const improvementConfidenceLower =
    estimatedImprovement - confidenceZ * improvementStandardError;
  const improvementConfidenceUpper =
    estimatedImprovement + confidenceZ * improvementStandardError;
  const minimumEpisodes = candidate.evaluation.minimumEpisodes;
  const minimumCoverage = candidate.evaluation.minimumCoverage;
  const statisticallyWeak = episodes.length < Math.max(minimumEpisodes, 20);
  if (episodes.length < 20) {
    warnings.push(
      "Fewer than 20 held-out episodes: treat this estimate as directional evidence, not statistical generalization."
    );
  }
  const coverageInsufficient =
    candidateEstimate.coverage < minimumCoverage ||
    baselineEstimate.coverage < minimumCoverage;
  if (coverageInsufficient) {
    warnings.push(
      `Replay coverage is below the ${(minimumCoverage * 100).toFixed(0)}% policy threshold; the logged policy does not support promotion.`
    );
  }
  let status: ReferenceReplayResult["status"] = "needs_review";
  if (candidateEstimate.guardrailViolations > 0) {
    status = "failed";
  } else if (episodes.length >= minimumEpisodes) {
    if (
      improvementConfidenceUpper < candidate.evaluation.minimumImprovement ||
      estimatedImprovement < candidate.evaluation.minimumImprovement
    ) {
      status = "failed";
    } else if (coverageInsufficient) {
      status = "needs_review";
    } else if (
      improvementConfidenceLower >= candidate.evaluation.minimumImprovement
    ) {
      status = "passed";
    } else {
      warnings.push(
        "The paired improvement interval crosses the promotion threshold; independent review is required."
      );
    }
  }

  return {
    method: "inverse_propensity_score",
    sampleSize: episodes.length,
    minimumEpisodes,
    minimumCoverage,
    statisticallyWeak,
    candidate: candidateEstimate,
    baseline: baselineEstimate,
    estimatedImprovement,
    improvementStandardError,
    improvementConfidenceLower,
    improvementConfidenceUpper,
    actionChanges: candidateActions.filter(
      (action, index) => action !== baselineActions[index]
    ).length,
    status,
    warnings,
    episodeResults: episodes.map((episode, index) => ({
      episodeId: episode.episodeId,
      loggedAction: episode.loggedAction,
      candidateAction: candidateActions[index] ?? "",
      baselineAction: baselineActions[index] ?? "",
      scalarReward: episode.scalarReward,
      behaviorProbability: episode.probability,
      guardrailViolation: episode.guardrailViolation,
    })),
  };
}

export function aggregatePolicyRewards(
  samples: Array<{
    policyVersionId: string;
    scalarReward: number;
    guardrailViolation: boolean;
  }>,
  confidenceZ = 1.96
): PolicyRewardAggregate[] {
  const grouped = new Map<string, typeof samples>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.scalarReward)) continue;
    const values = grouped.get(sample.policyVersionId) ?? [];
    values.push(sample);
    grouped.set(sample.policyVersionId, values);
  }
  return Array.from(grouped, ([policyVersionId, values]) => {
    const rewards = values.map((item) => item.scalarReward);
    const meanReward = mean(rewards);
    const variance =
      rewards.length > 1
        ? rewards.reduce((total, value) => total + (value - meanReward) ** 2, 0) /
          (rewards.length - 1)
        : 0;
    const standardError = Math.sqrt(variance / rewards.length);
    return {
      policyVersionId,
      episodeCount: rewards.length,
      meanReward,
      standardError,
      confidenceLower: meanReward - confidenceZ * standardError,
      confidenceUpper: meanReward + confidenceZ * standardError,
      guardrailViolations: values.filter((item) => item.guardrailViolation).length,
    };
  }).sort((left, right) => left.policyVersionId.localeCompare(right.policyVersionId));
}
