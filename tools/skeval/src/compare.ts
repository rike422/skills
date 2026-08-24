import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { evaluateSuite, type EvaluateOptions, type EvaluationResult } from "./runner.js";

export interface EvaluationSummary {
  readonly successfulTrials: number;
  readonly totalTrials: number;
  readonly successRate: number;
  readonly deterministicPassed: number;
  readonly deterministicTotal: number;
  readonly deterministicPassRate: number | null;
  readonly judgeMean: number | null;
}

export interface EvaluationComparison {
  readonly current: EvaluationSummary;
  readonly candidate: EvaluationSummary;
  readonly deterministicRegressions: readonly {
    readonly check: string;
    readonly currentPassRate: number;
    readonly candidatePassRate: number;
  }[];
}

export interface CompareOptions extends Omit<EvaluateOptions, "candidateSkillPath"> {
  readonly candidateSkillPath: string;
}

export interface CompareResult {
  readonly schemaVersion: 1;
  readonly current: EvaluationResult;
  readonly candidate: EvaluationResult;
  readonly delta: number | null;
  readonly comparison: EvaluationComparison;
  readonly artifactPath: string;
}

function summarize(result: EvaluationResult): EvaluationSummary {
  const trials = result.cases.flatMap((evalCase) => evalCase.withSkill.trials);
  const checks = trials.flatMap((trial) => trial.checks);
  const judgeScores = trials.map((trial) => trial.judgeScore).filter((score): score is number => score !== null);
  const successfulTrials = trials.filter((trial) => trial.status === "success").length;
  const deterministicPassed = checks.filter((check) => check.passed).length;
  return Object.freeze({
    successfulTrials,
    totalTrials: trials.length,
    successRate: trials.length === 0 ? 0 : successfulTrials / trials.length,
    deterministicPassed,
    deterministicTotal: checks.length,
    deterministicPassRate: checks.length === 0 ? null : deterministicPassed / checks.length,
    judgeMean: judgeScores.length === 0 ? null : judgeScores.reduce((sum, score) => sum + score, 0) / judgeScores.length
  });
}

function checkRates(result: EvaluationResult): Map<string, number> {
  const groups = new Map<string, boolean[]>();
  for (const evalCase of result.cases) {
    for (const trial of evalCase.withSkill.trials) {
      trial.checks.forEach((check, index) => {
        const key = `${evalCase.id}#${index + 1}:${check.name}`;
        const values = groups.get(key) ?? [];
        values.push(check.passed);
        groups.set(key, values);
      });
    }
  }
  return new Map([...groups].map(([name, values]) => [name, values.filter(Boolean).length / values.length]));
}

export function compareEvaluationResults(current: EvaluationResult, candidate: EvaluationResult): EvaluationComparison {
  if (current.skillName !== candidate.skillName) throw new Error("Evaluation results must target the same Skill");
  if (current.agent !== candidate.agent) throw new Error("Evaluation results must use the same agent");
  if (current.suiteFingerprint !== candidate.suiteFingerprint) throw new Error("Evaluation results must use the same suite and pinned workspaces");
  const topology = (result: EvaluationResult) => result.cases.map((evalCase) => ({
    id: evalCase.id,
    withoutSkill: evalCase.withoutSkill.trials.map((trial) => trial.checks.map((check) => check.name)),
    withSkill: evalCase.withSkill.trials.map((trial) => trial.checks.map((check) => check.name))
  }));
  if (JSON.stringify(topology(current)) !== JSON.stringify(topology(candidate))) {
    throw new Error("Evaluation results have different case, trial, or check topology");
  }
  const currentRates = checkRates(current);
  const candidateRates = checkRates(candidate);
  const regressions = [...currentRates].flatMap(([check, currentPassRate]) => {
    const candidatePassRate = candidateRates.get(check);
    return candidatePassRate !== undefined && candidatePassRate < currentPassRate
      ? [{ check, currentPassRate, candidatePassRate }]
      : [];
  });
  return Object.freeze({
    current: summarize(current),
    candidate: summarize(candidate),
    deterministicRegressions: Object.freeze(regressions.map((regression) => Object.freeze(regression)))
  });
}

function assertConclusive(label: string, result: EvaluationResult): void {
  const errors = result.cases.flatMap((evalCase) => [
    ...evalCase.withoutSkill.trials,
    ...evalCase.withSkill.trials
  ]).filter((trial) => trial.status === "error");
  if (errors.length > 0) throw new Error(`${label} evaluation is inconclusive with ${errors.length} infrastructure error(s)`);
}

export async function compareSuite(options: CompareOptions): Promise<CompareResult> {
  const shared = {
    suitePath: options.suitePath,
    agentName: options.agentName,
    ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
    ...(options.showPrompts === undefined ? {} : { showPrompts: options.showPrompts }),
    ...(options.allowExternalWorkspaces === undefined ? {} : { allowExternalWorkspaces: options.allowExternalWorkspaces }),
    ...(options.adapterFactory === undefined ? {} : { adapterFactory: options.adapterFactory })
  };
  const current = await evaluateSuite(shared);
  assertConclusive("Current", current);
  const candidate = await evaluateSuite({ ...shared, candidateSkillPath: options.candidateSkillPath });
  assertConclusive("Candidate", candidate);
  const delta = current.score.withSkill === null || candidate.score.withSkill === null
    ? null
    : candidate.score.withSkill - current.score.withSkill;
  const comparison = compareEvaluationResults(current, candidate);
  const comparisonDirectory = join(dirname(dirname(current.artifactDirectory)), "comparisons");
  await mkdir(comparisonDirectory, { recursive: true });
  const artifactPath = join(comparisonDirectory, `${current.runId}--${candidate.runId}.json`);
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: 1,
    skillName: current.skillName,
    agent: current.agent,
    current: { runId: current.runId, skillHash: current.skillHash, score: current.score, artifactDirectory: current.artifactDirectory },
    candidate: { runId: candidate.runId, skillHash: candidate.skillHash, score: candidate.score, artifactDirectory: candidate.artifactDirectory },
    suiteFingerprint: current.suiteFingerprint,
    delta,
    comparison
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return Object.freeze({
    schemaVersion: 1,
    current,
    candidate,
    delta,
    comparison,
    artifactPath
  });
}
