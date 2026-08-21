import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { createAgentAdapter } from "./agents/index.js";
import {
  AgentExecutionError,
  type AgentAdapter,
  type AgentExecutionInput,
  type AgentExecutionResult,
  type AgentPreflight
} from "./agents/types.js";
import { RunArtifacts } from "./artifacts.js";
import { evaluateChecks } from "./checks.js";
import { buildAgentPrompt, buildJudgePrompt } from "./prompts.js";
import { scoreCase, scoreSuite, scoreTrial } from "./scoring.js";
import { materializeSkillBundle, snapshotSkillBundle, type SkillBundle } from "./skill-bundle.js";
import { captureOutcomeSnapshot } from "./snapshot.js";
import { loadSuite } from "./suite/loader.js";
import { stagePinnedWorkspace, stageWorkspace, type StagedWorkspace } from "./workspace.js";
import type { AgentDefinition, AgentOutcomeSnapshot, CaseDefinition, CheckResult, SuiteDefinition } from "./types.js";

export interface TrialResult {
  readonly trial: number;
  readonly status: "success" | "error";
  readonly score: number | null;
  readonly checks: readonly CheckResult[];
  readonly judgeScore: number | null;
  readonly judgeReason: string | null;
  readonly snapshot: AgentOutcomeSnapshot | null;
  readonly error: string | null;
}

export interface VariantResult {
  readonly score: number | null;
  readonly validTrials: number;
  readonly errorTrials: number;
  readonly trials: readonly TrialResult[];
}

export interface EvaluationCaseResult {
  readonly id: string;
  readonly withoutSkill: VariantResult;
  readonly withSkill: VariantResult;
  readonly delta: number | null;
  readonly pairedValidTrials: number;
  readonly pairedErrorTrials: number;
}

export interface EvaluationResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly skillName: string;
  readonly skillHash: string;
  readonly agent: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly cases: readonly EvaluationCaseResult[];
  readonly score: {
    readonly withoutSkill: number | null;
    readonly withSkill: number | null;
    readonly delta: number | null;
    readonly withoutValidCases: number;
    readonly withoutErrorCases: number;
    readonly withValidCases: number;
    readonly withErrorCases: number;
    readonly pairedValidCases: number;
    readonly pairedErrorCases: number;
  };
  readonly artifactDirectory: string;
}

export interface EvaluateOptions {
  readonly suitePath: string;
  readonly agentName: string;
  readonly outputRoot?: string;
  readonly candidateSkill?: string;
  readonly showPrompts?: boolean;
  readonly allowExternalWorkspaces?: boolean;
  readonly adapterFactory?: (type: string) => AgentAdapter;
}

const judgeOutputSchema = z.object({ score: z.number().min(0).max(1), reason: z.string() }).strict();

function runId(): string {
  return `${new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
}

function requireRole(agent: AgentDefinition, role: "executor" | "judge"): void {
  if (!agent.roles.includes(role)) throw new Error(`Agent ${agent.name} does not allow the ${role} role`);
}

async function writeAgentArtifacts(
  artifacts: RunArtifacts,
  prefix: string,
  process: AgentExecutionResult["process"]
): Promise<void> {
  await artifacts.writeJson(`${prefix}/process.json`, {
    argv: process.argv,
    cwd: process.cwd,
    exitCode: process.exitCode,
    signal: process.signal,
    timedOut: process.timedOut,
    durationMs: process.durationMs,
    stdoutTruncated: process.stdoutTruncated,
    stderrTruncated: process.stderrTruncated,
    environmentNames: process.environmentNames
  });
  await artifacts.writeText(`${prefix}/stdout.log`, process.stdout);
  await artifacts.writeText(`${prefix}/stderr.log`, process.stderr);
}

async function executeAuditedAgent(
  artifacts: RunArtifacts,
  prefix: string,
  adapter: AgentAdapter,
  input: AgentExecutionInput
): Promise<AgentExecutionResult> {
  await artifacts.writeText(`${prefix}/prompt.txt`, input.prompt);
  try {
    const execution = await adapter.execute(input);
    await writeAgentArtifacts(artifacts, prefix, execution.process);
    return execution;
  } catch (error) {
    if (error instanceof AgentExecutionError) await writeAgentArtifacts(artifacts, prefix, error.process);
    throw error;
  }
}

async function runJudge(
  suite: SuiteDefinition,
  evalCase: CaseDefinition,
  checks: readonly CheckResult[],
  snapshot: AgentOutcomeSnapshot,
  adapters: ReadonlyMap<string, AgentAdapter>,
  identities: ReadonlyMap<string, AgentPreflight>,
  artifacts: RunArtifacts,
  prefix: string
): Promise<{ score: number; reason: string } | undefined> {
  if (evalCase.judge === undefined) return undefined;
  const judgeAgent = suite.agents[evalCase.judge.agent];
  if (judgeAgent === undefined) throw new Error(`Unknown judge agent: ${evalCase.judge.agent}`);
  requireRole(judgeAgent, "judge");
  const prompt = buildJudgePrompt({
    task: evalCase.prompt,
    rubric: evalCase.judge.rubric,
    diff: snapshot.diff,
    checks,
    finalResponse: snapshot.finalResponse
  });
  const adapter = adapters.get(judgeAgent.name);
  const identity = identities.get(judgeAgent.name);
  if (adapter === undefined) throw new Error(`Judge adapter was not preflighted: ${judgeAgent.name}`);
  if (identity === undefined) throw new Error(`Judge identity was not fixed: ${judgeAgent.name}`);
  const judgePrefix = `${prefix}/judge`;
  const execution = await executeAuditedAgent(artifacts, judgePrefix, adapter, {
    executable: identity.executable,
    prompt,
    cwd: dirname(evalCase.sourcePath),
    timeoutMs: suite.defaults.timeoutSeconds * 1000,
    role: "judge",
    ...(judgeAgent.model === undefined ? {} : { model: judgeAgent.model })
  });
  return judgeOutputSchema.parse(JSON.parse(execution.finalResponse));
}

async function runTrial(
  suite: SuiteDefinition,
  evalCase: CaseDefinition,
  variant: "without_skill" | "with_skill",
  trial: number,
  skillContent: string,
  adapters: ReadonlyMap<string, AgentAdapter>,
  identities: ReadonlyMap<string, AgentPreflight>,
  artifacts: RunArtifacts,
  pinnedWorkspace: StagedWorkspace,
  bundle: SkillBundle
): Promise<TrialResult> {
  const prefix = `cases/${evalCase.id}/trial-${String(trial).padStart(3, "0")}/${variant}`;
  let staged: Awaited<ReturnType<typeof stageWorkspace>> | undefined;
  let materializedSkillPath: string | undefined;
  let captured: Awaited<ReturnType<typeof captureOutcomeSnapshot>> | undefined;
  try {
    staged = await stagePinnedWorkspace(pinnedWorkspace);
    if (variant === "with_skill") {
      materializedSkillPath = join(staged.path, ".skeval-skill");
      await materializeSkillBundle(bundle, materializedSkillPath);
    }
    const prompt = buildAgentPrompt({
      task: evalCase.prompt,
      skill: skillContent,
      variant,
      ...(materializedSkillPath === undefined ? {} : { resourcePath: ".skeval-skill" })
    });
    const adapter = adapters.get(suite.selectedAgent.name);
    const identity = identities.get(suite.selectedAgent.name);
    if (adapter === undefined) throw new Error(`Executor adapter was not preflighted: ${suite.selectedAgent.name}`);
    if (identity === undefined) throw new Error(`Executor identity was not fixed: ${suite.selectedAgent.name}`);
    const execution = await executeAuditedAgent(artifacts, `${prefix}/agent`, adapter, {
      executable: identity.executable,
      prompt,
      cwd: staged.path,
      timeoutMs: suite.defaults.timeoutSeconds * 1000,
      role: "executor",
      ...(suite.selectedAgent.model === undefined ? {} : { model: suite.selectedAgent.model })
    });
    if (materializedSkillPath !== undefined) {
      await rm(materializedSkillPath, { recursive: true, force: true });
      materializedSkillPath = undefined;
    }
    captured = await captureOutcomeSnapshot(staged, "completed", execution.finalResponse);
    const snapshot = captured.snapshot;
    await artifacts.writeText(`${prefix}/diff.patch`, snapshot.diff);
    await artifacts.writeJson(`${prefix}/snapshot.json`, snapshot);
    const checks = await evaluateChecks(captured.workspacePath, evalCase.checks, { changedPaths: new Set(snapshot.changedPaths) });
    await artifacts.writeJson(`${prefix}/checks.json`, checks);
    const judge = await runJudge(suite, evalCase, checks, snapshot, adapters, identities, artifacts, prefix);
    const score = scoreTrial({ checks: checks.map((check) => check.passed), ...(judge === undefined ? {} : { judgeScore: judge.score }) });
    return Object.freeze({
      trial,
      status: "success",
      score,
      checks,
      judgeScore: judge?.score ?? null,
      judgeReason: judge?.reason ?? null,
      snapshot,
      error: null
    });
  } catch (error) {
    if (materializedSkillPath !== undefined) await rm(materializedSkillPath, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await artifacts.writeJson(`${prefix}/error.json`, { error: message });
    return Object.freeze({ trial, status: "error", score: null, checks: [], judgeScore: null, judgeReason: null, snapshot: null, error: message });
  } finally {
    if (staged !== undefined) await rm(dirname(staged.path), { recursive: true, force: true });
    if (captured !== undefined) await rm(captured.temporaryRoot, { recursive: true, force: true });
  }
}

function aggregateVariant(trials: readonly TrialResult[]): VariantResult {
  const aggregate = scoreCase(trials.map((trial) => trial.score));
  return Object.freeze({ ...aggregate, trials: Object.freeze([...trials]) });
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function evaluateSuite(options: EvaluateOptions): Promise<EvaluationResult> {
  const suite = await loadSuite(options.suitePath, options.agentName, {
    allowExternalWorkspaces: options.allowExternalWorkspaces ?? false
  });
  requireRole(suite.selectedAgent, "executor");
  const bundle = await snapshotSkillBundle(suite.skillPath, options.candidateSkill);
  const skillContent = bundle.skillText;
  const outputRoot = options.outputRoot ?? resolve(dirname(suite.suitePath), "..", "..", "..", ".skills-eval");
  const id = runId();
  const artifacts = await RunArtifacts.create(outputRoot, suite.skillName, id);
  const startedAt = new Date().toISOString();
  const adapterFactory = options.adapterFactory ?? createAgentAdapter;
  const pinnedWorkspaceRoots: string[] = [];
  try {
    const agentNames = new Set([suite.selectedAgent.name, ...suite.cases.flatMap((evalCase) => evalCase.judge === undefined ? [] : [evalCase.judge.agent])]);
    const adapters = new Map<string, AgentAdapter>();
    const identities = new Map<string, AgentPreflight>();
    const preflights: Record<string, AgentPreflight> = {};
    for (const name of agentNames) {
      const definition = suite.agents[name];
      if (definition === undefined) throw new Error(`Unknown referenced agent: ${name}`);
      const adapter = adapterFactory(definition.type);
      const identity = await adapter.preflight(definition.executable);
      preflights[name] = identity;
      identities.set(name, identity);
      adapters.set(name, adapter);
    }
    const pinnedWorkspaces = new Map<string, StagedWorkspace>();
    for (const evalCase of suite.cases) {
      const baseline = await stageWorkspace(evalCase.workspace);
      pinnedWorkspaceRoots.push(dirname(baseline.path));
      pinnedWorkspaces.set(evalCase.id, baseline);
    }
    await artifacts.writeJson("run-context.json", {
      schemaVersion: 1,
      suitePath: suite.suitePath,
      skillPath: suite.skillPath,
      skillHash: bundle.hash,
      skillManifest: bundle.files.map(({ path, hash, size, mode }) => ({ path, hash, size, mode })),
      selectedAgent: suite.selectedAgent,
      preflights,
      cases: suite.cases.map((evalCase) => ({
        id: evalCase.id,
        sourcePath: evalCase.sourcePath,
        sourceWorkspace: evalCase.workspace,
        pinnedWorkspace: (() => {
          const pinned = pinnedWorkspaces.get(evalCase.id);
          return pinned === undefined ? undefined : { baseOid: pinned.baseOid, sourceOid: pinned.sourceOid };
        })(),
        checks: evalCase.checks
      })),
      showPrompts: options.showPrompts ?? false
    });

    const cases: EvaluationCaseResult[] = [];
    for (const evalCase of suite.cases) {
      const pinnedWorkspace = pinnedWorkspaces.get(evalCase.id);
      if (pinnedWorkspace === undefined) throw new Error(`Workspace was not pinned: ${evalCase.id}`);
      const withoutTrials: TrialResult[] = [];
      const withTrials: TrialResult[] = [];
      for (let trial = 1; trial <= suite.defaults.trials; trial += 1) {
        withoutTrials.push(await runTrial(suite, evalCase, "without_skill", trial, skillContent, adapters, identities, artifacts, pinnedWorkspace, bundle));
        withTrials.push(await runTrial(suite, evalCase, "with_skill", trial, skillContent, adapters, identities, artifacts, pinnedWorkspace, bundle));
      }
      const withoutSkill = aggregateVariant(withoutTrials);
      const withSkill = aggregateVariant(withTrials);
      const pairedDeltas = withoutTrials.flatMap((withoutTrial, index) => {
        const withTrial = withTrials[index];
        return withoutTrial.score === null || withTrial === undefined || withTrial.score === null
          ? []
          : [withTrial.score - withoutTrial.score];
      });
      cases.push(Object.freeze({
        id: evalCase.id,
        withoutSkill,
        withSkill,
        delta: mean(pairedDeltas),
        pairedValidTrials: pairedDeltas.length,
        pairedErrorTrials: suite.defaults.trials - pairedDeltas.length
      }));
    }
    const withoutSuite = scoreSuite(cases.map((item) => item.withoutSkill.score));
    const withSuite = scoreSuite(cases.map((item) => item.withSkill.score));
    const caseDeltas = cases.map((item) => item.delta).filter((delta): delta is number => delta !== null);
    const result: EvaluationResult = Object.freeze({
      schemaVersion: 1,
      runId: id,
      skillName: suite.skillName,
      skillHash: bundle.hash,
      agent: suite.selectedAgent.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      cases: Object.freeze(cases),
      score: Object.freeze({
        withoutSkill: withoutSuite.score,
        withSkill: withSuite.score,
        delta: mean(caseDeltas),
        withoutValidCases: withoutSuite.validCases,
        withoutErrorCases: withoutSuite.errorCases,
        withValidCases: withSuite.validCases,
        withErrorCases: withSuite.errorCases,
        pairedValidCases: caseDeltas.length,
        pairedErrorCases: cases.length - caseDeltas.length
      }),
      artifactDirectory: artifacts.runDirectory
    });
    await artifacts.finalize(result);
    return result;
  } catch (error) {
    await artifacts.fail(error);
    throw error;
  } finally {
    await Promise.all(pinnedWorkspaceRoots.map((path) => rm(path, { recursive: true, force: true })));
  }
}
