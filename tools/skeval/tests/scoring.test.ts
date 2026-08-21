import { describe, expect, it } from "vitest";
import { scoreCase, scoreTrial, scoreSuite } from "../src/scoring.js";

describe("scoring", () => {
  it("multiplies deterministic and judge scores", () => {
    expect(scoreTrial({ checks: [true, false, true, true], judgeScore: 0.8 })).toBeCloseTo(0.6);
  });

  it("uses one for deterministic score when a judge is the only grader", () => {
    expect(scoreTrial({ checks: [], judgeScore: 0.75 })).toBe(0.75);
  });

  it("excludes infrastructure errors from arithmetic means", () => {
    expect(scoreCase([0.5, null, 1])).toEqual({ score: 0.75, validTrials: 2, errorTrials: 1 });
    expect(scoreSuite([0.25, null, 0.75])).toEqual({ score: 0.5, validCases: 2, errorCases: 1 });
  });

  it("rejects invalid trials", () => {
    expect(() => scoreTrial({ checks: [] })).toThrow(/requires/i);
    expect(() => scoreTrial({ checks: [true], judgeScore: 2 })).toThrow(/between/i);
  });
});
