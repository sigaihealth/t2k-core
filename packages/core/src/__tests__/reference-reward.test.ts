import { describe, expect, it } from "vitest";

import {
  evaluateReferenceReward,
  ReferenceRewardError,
} from "../reference-reward.js";
import type { RewardDimensionSpec } from "../types.js";

const completionRate: RewardDimensionSpec = {
  measureRef: "service.on_time_completion_rate",
  label: "On-time completion rate",
  direction: "maximize",
  weight: 1,
  required: true,
  guardrail: false,
  unit: "ratio",
  observationWindow: "7d",
  aggregation: "latest",
  baselineMethod: "explicit",
  attributionMethod: "human_review",
};

describe("reference reward evaluation", () => {
  it("computes directional reward from observations and a baseline", () => {
    const result = evaluateReferenceReward({
      rewardSpec: [completionRate],
      observations: [
        {
          measureRef: completionRate.measureRef,
          observedValue: 0.8,
          baselineValue: 0.4,
          observationWindow: "7d",
          observedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
    });

    expect(result.lifecycleStatus).toBe("complete");
    expect(result.scalarReward).toBe(1);
    expect(result.evaluationReward).toBe(1);
    expect(result.dimensions[0]).toMatchObject({
      score: 1,
      weightedScore: 1,
      guardrailViolated: false,
      complete: true,
    });
  });

  it("blocks scalarization when a guardrail fails", () => {
    const result = evaluateReferenceReward({
      rewardSpec: [
        completionRate,
        {
          measureRef: "service.customer_impact",
          label: "Customer impact",
          direction: "range",
          weight: 1,
          required: true,
          guardrail: true,
          minimum: 0,
          maximum: 0.1,
          observationWindow: "7d",
          aggregation: "latest",
          baselineMethod: "none",
          attributionMethod: "direct",
        },
      ],
      observations: [
        {
          measureRef: completionRate.measureRef,
          observedValue: 0.8,
          baselineValue: 0.4,
          observationWindow: "7d",
          observedAt: "2026-07-18T00:00:00.000Z",
        },
        {
          measureRef: "service.customer_impact",
          observedValue: 0.2,
          baselineValue: null,
          observationWindow: "7d",
          observedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
    });

    expect(result.lifecycleStatus).toBe("guardrail_violation");
    expect(result.scalarReward).toBeNull();
    expect(result.evaluationReward).toBe(-1);
    expect(result.dimensions[1]?.guardrailViolated).toBe(true);
  });

  it("keeps missing required observations incomplete", () => {
    const result = evaluateReferenceReward({
      rewardSpec: [completionRate],
      observations: [],
    });

    expect(result.lifecycleStatus).toBe("incomplete");
    expect(result.scalarReward).toBeNull();
    expect(result.evaluationReward).toBeNull();
    expect(result.dimensions[0]?.complete).toBe(false);
  });

  it("rejects ambiguous duplicate dimensions", () => {
    expect(() =>
      evaluateReferenceReward({
        rewardSpec: [completionRate, completionRate],
        observations: [],
      })
    ).toThrow(ReferenceRewardError);
  });

  it("aggregates observations and baselines with the same method", () => {
    const result = evaluateReferenceReward({
      rewardSpec: [{ ...completionRate, aggregation: "average" }],
      observations: [
        {
          measureRef: completionRate.measureRef,
          observedValue: 0.6,
          baselineValue: 0.4,
          observationWindow: "7d",
          observedAt: "2026-07-17T00:00:00.000Z",
        },
        {
          measureRef: completionRate.measureRef,
          observedValue: 1,
          baselineValue: 0.6,
          observationWindow: "7d",
          observedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
    });

    expect(result.dimensions[0]).toMatchObject({
      observedValue: 0.8,
      baselineValue: 0.5,
    });
    expect(result.dimensions[0]?.score).toBeCloseTo(0.6);
  });

  it("rejects observations with invalid timestamps", () => {
    expect(() =>
      evaluateReferenceReward({
        rewardSpec: [completionRate],
        observations: [
          {
            measureRef: completionRate.measureRef,
            observedValue: 0.8,
            baselineValue: 0.4,
            observationWindow: "7d",
            observedAt: "not-a-date",
          },
        ],
      })
    ).toThrow(ReferenceRewardError);
  });

  it("rejects malformed runtime reward contracts", () => {
    expect(() =>
      evaluateReferenceReward({
        rewardSpec: [
          {
            ...completionRate,
            direction: "sideways",
          } as unknown as RewardDimensionSpec,
        ],
        observations: [],
      })
    ).toThrow("direction is unsupported");
  });
});
