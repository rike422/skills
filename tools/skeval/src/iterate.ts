import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createAgentAdapter } from "./agents/index.js";
import { AgentExecutionError, type AgentAdapter } from "./agents/types.js";
import { evaluateSuite, type EvaluationResult } from "./runner.js";
import { loadSuite } from "./suite/loader.js";

export interface FailureEvidence {
  readonly caseId: string;
  readonly prompt: string;
  readonly delta: number | null;
  readonly failures: readonly string[];
  readonly withoutScore?: number | null;
  readonly withScore?: number | null;
  readonly outcomes?: readonly {
    readonly trial: number;
    readonly score: number | null;
    readonly error: string | null;
    readonly judgeScore: number | null;
    readonly judgeReason: string | null;
    readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly detail: string }[];
    readonly diff: string;
    readonly finalResponse: string;
  }[];
}

export function buildImprovementPrompt(input: { readonly currentSkill: string; readonly evidence: readonly FailureEvidence[] }): string {
  return [
    "# Objective",
    "Propose one revised SKILL.md that improves general behavior based on the evaluation evidence.",
    "Do not overfit to case names, fixture paths, exact assertions, or expected output strings.",
    "Return only the complete candidate SKILL.md.",
    "",
    "# Analysis requirements",
    "For your internal analysis, distinguish: missing, ambiguous, overly broad, overly specific, contradictory, ineffective, or unnecessary-work guidance.",
    "Use this chain: Observed failure -> likely Skill-related cause -> generalizable improvement -> proposed modification.",
    "",
    "# Current Skill",
    input.currentSkill.trim(),
    "",
    "# Evaluation evidence",
    JSON.stringify(input.evidence, null, 2)
  ].join("\n");
}

export function extractCandidateSkill(output: string): string {
  const trimmed = output.trim();
  const match = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  const candidate = (match?.[1] ?? trimmed).trim();
  if (candidate.length === 0) throw new Error("Improver returned an empty candidate Skill");
  if (Buffer.byteLength(candidate) > 256 * 1024) throw new Error("Candidate Skill exceeds the 256 KiB limit");
  return `${candidate}\n`;
}

export async function nextCandidatePath(outputRoot: string, skillName: string): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(skillName)) throw new Error(`Invalid skill name: ${skillName}`);
  const directory = join(resolve(outputRoot), skillName, "candidates");
  await mkdir(directory, { recursive: true });
  const numbers = (await readdir(directory))
    .map((name) => /^iteration-(\d{3,})\./.exec(name)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number);
  const next = Math.max(0, ...numbers) + 1;
  return join(directory, `iteration-${String(next).padStart(3, "0")}.md`);
}

async function writeExclusiveAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function collectEvidence(result: EvaluationResult, prompts: ReadonlyMap<string, string>): FailureEvidence[] {
  return result.cases.map((evalCase) => ({
    caseId: evalCase.id,
    prompt: prompts.get(evalCase.id) ?? "",
    delta: evalCase.delta,
    withoutScore: evalCase.withoutSkill.score,
    withScore: evalCase.withSkill.score,
    failures: evalCase.withSkill.trials.flatMap((trial) => [
      ...trial.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`),
      ...(trial.judgeReason === null || trial.judgeScore === null || trial.judgeScore >= 0.8 ? [] : [`judge: ${trial.judgeReason}`])
    ]),
    outcomes: evalCase.withSkill.trials.map((trial) => ({
      trial: trial.trial,
      score: trial.score,
      error: trial.error,
      judgeScore: trial.judgeScore,
      judgeReason: trial.judgeReason,
      checks: trial.checks.map(({ name, passed, detail }) => ({ name, passed, detail })),
      diff: truncateEvidence(trial.snapshot?.diff ?? "", 100_000),
      finalResponse: truncateEvidence(trial.snapshot?.finalResponse ?? "", 20_000)
    }))
  })).filter((evidence) => evidence.delta === null || evidence.delta <= 0 || evidence.failures.length > 0);
}

function truncateEvidence(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n...[truncated by skeval]`;
}

export interface EvaluationSummary {
  readonly successfulTrials: number;
  readonly totalTrials: number;
  readonly successRate: number;
  readonly deterministicPassed: number;
  readonly deterministicTotal: number;
  readonly deterministicPassRate: number | null;
  readonly judgeMean: number | null;
}

export interface IterationComparison {
  readonly current: EvaluationSummary;
  readonly candidate: EvaluationSummary;
  readonly deterministicRegressions: readonly {
    readonly check: string;
    readonly currentPassRate: number;
    readonly candidatePassRate: number;
  }[];
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
  for (const check of result.cases.flatMap((evalCase) => evalCase.withSkill.trials.flatMap((trial) => trial.checks))) {
    const values = groups.get(check.name) ?? [];
    values.push(check.passed);
    groups.set(check.name, values);
  }
  return new Map([...groups].map(([name, values]) => [name, values.filter(Boolean).length / values.length]));
}

function compareEvaluations(current: EvaluationResult, candidate: EvaluationResult): IterationComparison {
  const currentRates = checkRates(current);
  const candidateRates = checkRates(candidate);
  const deterministicRegressions = [...currentRates].flatMap(([check, currentPassRate]) => {
    const candidatePassRate = candidateRates.get(check);
    return candidatePassRate !== undefined && candidatePassRate < currentPassRate
      ? [{ check, currentPassRate, candidatePassRate }]
      : [];
  });
  const frozenRegressions: IterationComparison["deterministicRegressions"] = Object.freeze(
    deterministicRegressions.map((regression) => Object.freeze(regression))
  );
  return Object.freeze({
    current: summarize(current),
    candidate: summarize(candidate),
    deterministicRegressions: frozenRegressions
  });
}

export interface IterateOptions {
  readonly suitePath: string;
  readonly agentName: string;
  readonly improverAgentName?: string;
  readonly outputRoot?: string;
  readonly allowExternalWorkspaces?: boolean;
  readonly adapterFactory?: (type: string) => AgentAdapter;
}

export interface IterationResult {
  readonly schemaVersion: 1;
  readonly candidatePath: string;
  readonly current: EvaluationResult;
  readonly candidate: EvaluationResult;
  readonly delta: number | null;
  readonly comparison: IterationComparison;
}

export async function iterateSuite(options: IterateOptions): Promise<IterationResult> {
  const suite = await loadSuite(options.suitePath, options.agentName, {
    allowExternalWorkspaces: options.allowExternalWorkspaces ?? false
  });
  const outputRoot = options.outputRoot ?? resolve(dirname(suite.suitePath), "..", "..", "..", ".skills-eval");
  const evaluationOptions = {
    allowExternalWorkspaces: options.allowExternalWorkspaces ?? false,
    ...(options.adapterFactory === undefined ? {} : { adapterFactory: options.adapterFactory })
  };
  const current = await evaluateSuite({ suitePath: options.suitePath, agentName: options.agentName, outputRoot, ...evaluationOptions });
  const infrastructureErrors = current.cases.flatMap((evalCase) => [
    ...evalCase.withoutSkill.trials,
    ...evalCase.withSkill.trials
  ]).filter((trial) => trial.status === "error");
  if (infrastructureErrors.length > 0) {
    throw new Error(`Cannot iterate from an inconclusive evaluation with ${infrastructureErrors.length} infrastructure error(s)`);
  }
  const improverName = options.improverAgentName ?? options.agentName;
  const improver = suite.agents[improverName];
  if (improver === undefined) throw new Error(`Unknown improver agent: ${improverName}`);
  if (!improver.roles.includes("improver")) throw new Error(`Agent ${improverName} does not allow the improver role`);
  const currentSkill = await readFile(suite.skillPath, "utf8");
  const prompts = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase.prompt]));
  const improvementPrompt = buildImprovementPrompt({ currentSkill, evidence: collectEvidence(current, prompts) });
  const candidatePath = await nextCandidatePath(outputRoot, suite.skillName);
  const candidateStem = candidatePath.replace(/\.md$/, "");
  await writeExclusiveAtomic(`${candidateStem}.prompt.txt`, `${improvementPrompt}\n`);
  const adapter = (options.adapterFactory ?? createAgentAdapter)(improver.type);
  const preflight = await adapter.preflight(improver.executable);
  let execution: Awaited<ReturnType<AgentAdapter["execute"]>>;
  try {
    execution = await adapter.execute({
      executable: preflight.executable,
      prompt: improvementPrompt,
      cwd: dirname(suite.skillPath),
      timeoutMs: suite.defaults.timeoutSeconds * 1000,
      role: "improver",
      ...(improver.model === undefined ? {} : { model: improver.model })
    });
  } catch (error) {
    await writeExclusiveAtomic(`${candidateStem}.error.json`, `${JSON.stringify({
      schemaVersion: 1,
      state: "improver_error",
      error: error instanceof Error ? error.message : String(error),
      process: error instanceof AgentExecutionError ? error.process : null
    }, null, 2)}\n`);
    throw error;
  }
  const candidateSkill = extractCandidateSkill(execution.finalResponse);
  await writeExclusiveAtomic(candidatePath, candidateSkill);
  let candidate: EvaluationResult;
  try {
    candidate = await evaluateSuite({
      suitePath: options.suitePath,
      agentName: options.agentName,
      outputRoot,
      candidateSkill,
      ...evaluationOptions
    });
    const candidateInfrastructureErrors = candidate.cases.flatMap((evalCase) => [
      ...evalCase.withoutSkill.trials,
      ...evalCase.withSkill.trials
    ]).filter((trial) => trial.status === "error");
    if (candidateInfrastructureErrors.length > 0) {
      throw new Error(`Candidate evaluation is inconclusive with ${candidateInfrastructureErrors.length} infrastructure error(s)`);
    }
  } catch (error) {
    await writeExclusiveAtomic(`${candidateStem}.error.json`, `${JSON.stringify({
      schemaVersion: 1,
      state: "candidate_evaluation_error",
      error: error instanceof Error ? error.message : String(error),
      process: execution.process
    }, null, 2)}\n`);
    throw error;
  }
  const delta = current.score.withSkill === null || candidate.score.withSkill === null
    ? null
    : candidate.score.withSkill - current.score.withSkill;
  const result: IterationResult = Object.freeze({
    schemaVersion: 1,
    candidatePath,
    current,
    candidate,
    delta,
    comparison: compareEvaluations(current, candidate)
  });
  await writeExclusiveAtomic(`${candidateStem}.json`, `${JSON.stringify({
    ...result,
    improvementPrompt,
    improver: { name: improverName, executable: improver.executable, model: improver.model ?? null, version: preflight.version },
    process: execution.process
  }, null, 2)}\n`);
  return result;
}
