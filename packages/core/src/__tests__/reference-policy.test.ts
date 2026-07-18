import { describe, expect, it } from "vitest";

import {
  aggregatePolicyRewards,
  evaluateReferencePolicy,
  evaluateReferenceReplay,
  ReferencePolicyError,
} from "../reference-policy.js";

const baseline = {
  referencePolicy: {
    rules: [],
    defaultAction: "hold",
    evaluation: { minimumEpisodes: 1 },
  },
};

const candidate = {
  referencePolicy: {
    rules: [
      {
        all: [{ path: "metrics.margin", operator: "lt", value: 0.2 }],
        action: "raise_price",
      },
    ],
    defaultAction: "hold",
    evaluation: { minimumEpisodes: 1 },
  },
};

describe("reference policy", () => {
  it("selects the first matching rule and otherwise uses the default action", () => {
    expect(
      evaluateReferencePolicy(candidate, { metrics: { margin: 0.18 } })
    ).toBe("raise_price");
    expect(
      evaluateReferencePolicy(candidate, { metrics: { margin: 0.3 } })
    ).toBe("hold");
  });

  it("computes replay status and metrics from held-out episode evidence", () => {
    const result = evaluateReferenceReplay({
      candidateSpecification: candidate,
      baselineSpecification: baseline,
      episodes: [
        {
          episodeId: "episode-1",
          state: { metrics: { margin: 0.18 } },
          loggedAction: "raise_price",
          scalarReward: 0.5,
          learningMode: "supervised_feedback",
          behaviorProbability: null,
          guardrailViolation: false,
        },
        {
          episodeId: "episode-2",
          state: { metrics: { margin: 0.3 } },
          loggedAction: "hold",
          scalarReward: 0.2,
          learningMode: "supervised_feedback",
          behaviorProbability: null,
          guardrailViolation: false,
        },
      ],
    });

    expect(result.status).toBe("needs_review");
    expect(result.candidate.estimatedReward).toBeCloseTo(0.35);
    expect(result.baseline.estimatedReward).toBeCloseTo(0.1);
    expect(result.estimatedImprovement).toBeCloseTo(0.25);
    expect(result.improvementConfidenceLower).toBeLessThan(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("paired improvement interval"),
      ])
    );
    expect(result.actionChanges).toBe(1);
    expect(result.statisticallyWeak).toBe(true);
  });

  it("fails replay when the candidate reproduces a guardrail violation", () => {
    const result = evaluateReferenceReplay({
      candidateSpecification: candidate,
      baselineSpecification: baseline,
      episodes: [
        {
          episodeId: "episode-unsafe",
          state: { metrics: { margin: 0.18 } },
          loggedAction: "raise_price",
          scalarReward: 0.8,
          learningMode: "supervised_feedback",
          behaviorProbability: null,
          guardrailViolation: true,
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.candidate.guardrailViolations).toBe(1);
  });

  it("requires logged propensities for bandit and sequential episodes", () => {
    expect(() =>
      evaluateReferenceReplay({
        candidateSpecification: candidate,
        baselineSpecification: baseline,
        episodes: [
          {
            episodeId: "episode-bandit",
            state: { metrics: { margin: 0.18 } },
            loggedAction: "raise_price",
            scalarReward: 0.5,
            learningMode: "contextual_bandit",
            behaviorProbability: null,
            guardrailViolation: false,
          },
        ],
      })
    ).toThrow(ReferencePolicyError);
  });

  it("rejects unknown policy fields and unsafe state paths", () => {
    expect(() =>
      evaluateReferencePolicy(
        {
          referencePolicy: {
            rules: [],
            defaultAction: "hold",
            secretBehavior: "silently ignored",
          },
        },
        {}
      )
    ).toThrow("unsupported fields");
    expect(() =>
      evaluateReferencePolicy(
        {
          referencePolicy: {
            rules: [
              {
                all: [{ path: "__proto__.polluted", operator: "exists" }],
                action: "raise_price",
              },
            ],
            defaultAction: "hold",
          },
        },
        {}
      )
    ).toThrow("path is unsafe");
    expect(() =>
      evaluateReferencePolicy(
        {
          referencePolicy: {
            rules: [],
            defaultAction: "hold",
            evaluation: { minimumEpisodes: "twenty" },
          },
        },
        {}
      )
    ).toThrow("minimumEpisodes must be a finite number");
  });

  it("does not pass a challenger without logged-action coverage", () => {
    const unsupported = {
      referencePolicy: {
        rules: [],
        defaultAction: "new_action",
        evaluation: { minimumEpisodes: 1, minimumCoverage: 0.2 },
      },
    };
    const result = evaluateReferenceReplay({
      candidateSpecification: unsupported,
      baselineSpecification: baseline,
      episodes: [
        {
          episodeId: "episode-no-support",
          state: {},
          loggedAction: "hold",
          scalarReward: -1,
          learningMode: "supervised_feedback",
          behaviorProbability: null,
          guardrailViolation: false,
        },
      ],
    });

    expect(result.estimatedImprovement).toBe(1);
    expect(result.candidate.coverage).toBe(0);
    expect(result.status).toBe("needs_review");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("does not support promotion")])
    );
  });

  it("aggregates evaluated rewards by policy version", () => {
    expect(
      aggregatePolicyRewards([
        { policyVersionId: "v1", scalarReward: 0.2, guardrailViolation: false },
        { policyVersionId: "v1", scalarReward: 0.6, guardrailViolation: true },
        { policyVersionId: "v2", scalarReward: 0.7, guardrailViolation: false },
      ])
    ).toEqual([
      expect.objectContaining({
        policyVersionId: "v1",
        episodeCount: 2,
        meanReward: 0.4,
        guardrailViolations: 1,
      }),
      expect.objectContaining({
        policyVersionId: "v2",
        episodeCount: 1,
        meanReward: 0.7,
        guardrailViolations: 0,
      }),
    ]);
  });
});
