#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareSuite } from "./compare.js";
import { evaluateSuite, type EvaluationResult } from "./runner.js";
import { snapshotSkillBundle } from "./skill-bundle.js";
import { loadSuite } from "./suite/loader.js";

interface CliOptions {
  readonly command: "validate" | "eval" | "compare";
  readonly target: string;
  readonly agent: string;
  readonly candidatePath?: string;
  readonly outputRoot?: string;
  readonly showPrompts: boolean;
  readonly allowExternalWorkspaces: boolean;
}

function usage(): string {
  return `Usage:
  skeval validate <suite-or-skill> [--agent <name>] [--candidate <SKILL.md-or-directory>] [--allow-external-workspaces]
  skeval eval <suite-or-skill> [--agent <name>] [--candidate <SKILL.md-or-directory>] [--show-prompts] [--allow-external-workspaces] [--output <directory>]
  skeval compare <suite-or-skill> --candidate <SKILL.md-or-directory> [--agent <name>] [--show-prompts] [--allow-external-workspaces] [--output <directory>]

Targets may be eval.yaml, a Skill directory, or a Skill name under ./skills.`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const [commandInput, target, ...rest] = argv;
  if (commandInput !== "validate" && commandInput !== "eval" && commandInput !== "compare") throw new Error(usage());
  if (target === undefined || target.startsWith("--")) throw new Error(usage());
  let agent = "claude";
  let candidatePath: string | undefined;
  let outputRoot: string | undefined;
  let showPrompts = false;
  let allowExternalWorkspaces = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--show-prompts") showPrompts = true;
    else if (flag === "--allow-external-workspaces") allowExternalWorkspaces = true;
    else if (flag === "--agent" || flag === "--candidate" || flag === "--output") {
      const value = rest[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${flag}`);
      if (flag === "--agent") agent = value;
      else if (flag === "--candidate") candidatePath = value;
      else outputRoot = resolve(value);
      index += 1;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (commandInput === "compare" && candidatePath === undefined) throw new Error("skeval compare requires --candidate");
  return {
    command: commandInput,
    target,
    agent,
    showPrompts,
    allowExternalWorkspaces,
    ...(candidatePath === undefined ? {} : { candidatePath }),
    ...(outputRoot === undefined ? {} : { outputRoot })
  };
}

async function resolveSuitePath(target: string): Promise<string> {
  const direct = resolve(target);
  const directInfo = await stat(direct).catch(() => undefined);
  if (directInfo?.isFile()) return direct;
  if (directInfo?.isDirectory()) return join(direct, "evals", "eval.yaml");
  return resolve("skills", target, "evals", "eval.yaml");
}

async function resolveSkillPath(target: string): Promise<string> {
  const direct = resolve(target);
  const info = await stat(direct).catch(() => undefined);
  if (info?.isFile()) return direct;
  if (info?.isDirectory()) return join(direct, "SKILL.md");
  throw new Error(`Candidate Skill does not exist: ${target}`);
}

function formatScore(score: number | null): string {
  return score === null ? "ERROR" : score.toFixed(3);
}

function printResult(result: EvaluationResult): void {
  process.stdout.write(`Skill: ${result.skillName}\nAgent: ${result.agent}\n\n`);
  process.stdout.write("Case\twithout\twith\tdelta\n");
  for (const evalCase of result.cases) {
    process.stdout.write(`${evalCase.id}\t${formatScore(evalCase.withoutSkill.score)}\t${formatScore(evalCase.withSkill.score)}\t${formatScore(evalCase.delta)}\n`);
  }
  process.stdout.write(`suite\t${formatScore(result.score.withoutSkill)}\t${formatScore(result.score.withSkill)}\t${formatScore(result.score.delta)}\n`);
  process.stdout.write(`Valid/error cases: without ${result.score.withoutValidCases}/${result.score.withoutErrorCases}, with ${result.score.withValidCases}/${result.score.withErrorCases}, paired ${result.score.pairedValidCases}/${result.score.pairedErrorCases}\n`);
  process.stdout.write(`\nArtifacts: ${result.artifactDirectory}\n`);
}

async function collectPromptFiles(path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectPromptFiles(child));
    else if (entry.isFile() && entry.name === "prompt.txt") files.push(child);
  }
  return files.sort();
}

async function showPrompts(result: EvaluationResult): Promise<void> {
  for (const path of await collectPromptFiles(result.artifactDirectory)) {
    process.stdout.write(`\n--- ${relative(result.artifactDirectory, path)} ---\n${await readFile(path, "utf8")}\n`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const suitePath = await resolveSuitePath(options.target);
  const candidateSkillPath = options.candidatePath === undefined ? undefined : await resolveSkillPath(options.candidatePath);
  if (options.command === "validate") {
    const suite = await loadSuite(suitePath, options.agent, { allowExternalWorkspaces: options.allowExternalWorkspaces });
    const bundle = await snapshotSkillBundle(candidateSkillPath ?? suite.skillPath);
    if (bundle.name !== suite.skillName) throw new Error(`Candidate Skill name ${bundle.name} must match evaluated Skill ${suite.skillName}`);
    process.stdout.write(`Valid: ${basename(candidateSkillPath ?? suite.skillPath)} (${suite.cases.length} cases, sha256 ${bundle.hash})\n`);
    return;
  }
  const shared = {
    suitePath,
    agentName: options.agent,
    showPrompts: options.showPrompts,
    allowExternalWorkspaces: options.allowExternalWorkspaces,
    ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot })
  };
  if (options.command === "eval") {
    const result = await evaluateSuite({ ...shared, ...(candidateSkillPath === undefined ? {} : { candidateSkillPath }) });
    printResult(result);
    if (options.showPrompts) await showPrompts(result);
    return;
  }
  if (candidateSkillPath === undefined) throw new Error("skeval compare requires --candidate");
  const result = await compareSuite({ ...shared, candidateSkillPath });
  process.stdout.write(`Current: ${formatScore(result.current.score.withSkill)}\nCandidate: ${formatScore(result.candidate.score.withSkill)}\nDelta: ${formatScore(result.delta)}\n`);
  process.stdout.write(`Deterministic pass rate: ${formatScore(result.comparison.current.deterministicPassRate)} -> ${formatScore(result.comparison.candidate.deterministicPassRate)}\n`);
  for (const regression of result.comparison.deterministicRegressions) {
    process.stdout.write(`REGRESSION ${regression.check}: ${regression.currentPassRate.toFixed(3)} -> ${regression.candidatePassRate.toFixed(3)}\n`);
  }
  process.stdout.write(`\nComparison: ${result.artifactPath}\nCurrent artifacts: ${result.current.artifactDirectory}\nCandidate artifacts: ${result.candidate.artifactDirectory}\n`);
  if (options.showPrompts) {
    await showPrompts(result.current);
    await showPrompts(result.candidate);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
