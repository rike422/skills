export interface AggregateScore {
  readonly score: number | null;
  readonly validTrials: number;
  readonly errorTrials: number;
}

export interface SuiteScore {
  readonly score: number | null;
  readonly validCases: number;
  readonly errorCases: number;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scoreTrial(input: { readonly checks: readonly boolean[]; readonly judgeScore?: number }): number {
  if (input.checks.length === 0 && input.judgeScore === undefined) {
    throw new Error("A trial requires deterministic checks or a judge score");
  }
  if (input.judgeScore !== undefined && (input.judgeScore < 0 || input.judgeScore > 1)) {
    throw new Error("Judge score must be between 0 and 1");
  }
  const deterministic = input.checks.length === 0
    ? 1
    : input.checks.filter(Boolean).length / input.checks.length;
  return deterministic * (input.judgeScore ?? 1);
}

export function scoreCase(scores: readonly (number | null)[]): AggregateScore {
  const valid = scores.filter((score): score is number => score !== null);
  return { score: mean(valid), validTrials: valid.length, errorTrials: scores.length - valid.length };
}

export function scoreSuite(scores: readonly (number | null)[]): SuiteScore {
  const valid = scores.filter((score): score is number => score !== null);
  return { score: mean(valid), validCases: valid.length, errorCases: scores.length - valid.length };
}
