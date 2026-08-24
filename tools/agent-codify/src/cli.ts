#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandGenerator } from "./command-generator.js";
import type { ShokaEpisodeListFilters, ShokaSearchFilters } from "./shoka.js";
import { runAnalyze, runDraft, runShokaAnalyze, runShokaListAnalyze, type WorkflowResult } from "./workflows.js";

type Command = "analyze" | "draft";

export interface CliOptions {
  readonly command: Command;
  readonly episodePaths: readonly string[];
  readonly analysisPath?: string;
  readonly approvalPath?: string;
  readonly generatorCommand: string;
  readonly generatorArgs: readonly string[];
  readonly skillsRoots: readonly string[];
  readonly agentsPaths: readonly string[];
  readonly projectRoot?: string;
  readonly quickValidateScript?: string;
  readonly evalResultPaths: readonly string[];
  readonly outputRoot: string;
  readonly timeoutMs: number;
  readonly showPrompt: boolean;
  readonly shokaQuery?: string;
  readonly shokaList: boolean;
  readonly shokaExecutable: string;
  readonly shokaFilters: ShokaSearchFilters;
}

function usage(): string {
  return "Usage:\n" +
    "  agent-codify analyze --generator-command <executable> [--generator-arg <arg>] --from <transcript-episode.json-or-directory> [--from <path>...] [--skills <directory>] [--agents <AGENTS.md>] [--project-root <directory>] [--output <directory>]\n" +
    "  agent-codify analyze --generator-command <executable> [--generator-arg <arg>] --shoka-list [--shoka-agent <agent>] [--shoka-event-type <type>] [--shoka-from <date>] [--shoka-to <date>] [--shoka <executable>]\n" +
    "  agent-codify analyze --generator-command <executable> [--generator-arg <arg>] --shoka-query <query> [--shoka-agent <agent>] [--shoka-repository <path>] [--shoka-file <path>] [--shoka-event-type <type>] [--shoka-from <date>] [--shoka-to <date>] [--shoka-top <number>] [--shoka-before <number>] [--shoka-after <number>] [--shoka <executable>]\n" +
    "  agent-codify draft --generator-command <executable> [--generator-arg <arg>] --analysis <analysis-result.json> --approval <approval.json> [--eval-result <result.json>] [--output <directory>] [--quick-validate <script>] [--show-prompt]\n\n" +
    "analyze never creates a Skill. draft requires explicit human approval and writes only an untrusted candidate artifact.";
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(flag + " requires a positive integer");
  return parsed;
}

function nonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(flag + " requires a non-negative integer");
  return parsed;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const [commandInput, ...rest] = argv;
  if (commandInput !== "analyze" && commandInput !== "draft") throw new Error(usage());
  const episodePaths: string[] = [];
  const skillsRoots: string[] = [resolve("skills")];
  const agentsPaths: string[] = [];
  const evalResultPaths: string[] = [];
  let analysisPath: string | undefined;
  let approvalPath: string | undefined;
  let generatorCommand: string | undefined;
  const generatorArgs: string[] = [];
  let projectRoot: string | undefined;
  let quickValidateScript: string | undefined;
  let outputRoot = resolve(".agent-codify");
  let timeoutMs = 15 * 60 * 1000;
  let showPrompt = false;
  let shokaQuery: string | undefined;
  let shokaList = false;
  let shokaExecutable = "shoka";
  const shokaFilters: { agent?: ShokaSearchFilters["agent"]; repository?: string; file?: string; eventType?: string; from?: string; to?: string; top?: number; before?: number; after?: number } = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--show-prompt") { showPrompt = true; continue; }
    if (!["--from", "--analysis", "--approval", "--eval-result", "--generator-command", "--generator-arg", "--skills", "--agents", "--project-root", "--quick-validate", "--output", "--timeout-seconds", "--shoka-query", "--shoka-list", "--shoka", "--shoka-agent", "--shoka-repository", "--shoka-file", "--shoka-event-type", "--shoka-from", "--shoka-to", "--shoka-top", "--shoka-before", "--shoka-after"].includes(flag ?? "")) throw new Error("Unknown option: " + flag);
    if (flag === "--shoka-list") { shokaList = true; continue; }
    const value = rest[index + 1];
    if (value === undefined) throw new Error("Missing value for " + flag);
    if (flag === "--from") episodePaths.push(resolve(value));
    else if (flag === "--analysis") analysisPath = resolve(value);
    else if (flag === "--approval") approvalPath = resolve(value);
    else if (flag === "--eval-result") evalResultPaths.push(resolve(value));
    else if (flag === "--generator-command") generatorCommand = value;
    else if (flag === "--generator-arg") generatorArgs.push(value);
    else if (flag === "--skills") skillsRoots.push(resolve(value));
    else if (flag === "--agents") agentsPaths.push(resolve(value));
    else if (flag === "--project-root") projectRoot = resolve(value);
    else if (flag === "--quick-validate") quickValidateScript = resolve(value);
    else if (flag === "--output") outputRoot = resolve(value);
    else if (flag === "--timeout-seconds") timeoutMs = positiveInteger(value, flag) * 1000;
    else if (flag === "--shoka-query") shokaQuery = value;
    else if (flag === "--shoka") shokaExecutable = value;
    else if (flag === "--shoka-agent") {
      if (!["codex", "claude", "opencode", "cursor", "pi"].includes(value)) throw new Error("Unsupported Shoka agent: " + value);
      shokaFilters.agent = value as ShokaSearchFilters["agent"];
    } else if (flag === "--shoka-repository") shokaFilters.repository = value;
    else if (flag === "--shoka-file") shokaFilters.file = value;
    else if (flag === "--shoka-event-type") shokaFilters.eventType = value;
    else if (flag === "--shoka-from") shokaFilters.from = value;
    else if (flag === "--shoka-to") shokaFilters.to = value;
    else if (flag === "--shoka-top") shokaFilters.top = positiveInteger(value, flag);
    else if (flag === "--shoka-before") shokaFilters.before = nonNegativeInteger(value, flag);
    else if (flag === "--shoka-after") shokaFilters.after = nonNegativeInteger(value, flag);
    index += 1;
  }
  const hasShokaOptions = shokaList || shokaQuery !== undefined || shokaExecutable !== "shoka" || Object.keys(shokaFilters).length > 0;
  if (commandInput === "analyze" && episodePaths.length === 0 && shokaQuery === undefined && !shokaList) throw new Error("analyze requires --from, --shoka-list, or --shoka-query");
  if (commandInput === "analyze" && episodePaths.length > 0 && (shokaQuery !== undefined || shokaList)) throw new Error("--from cannot be combined with Shoka selection");
  if (commandInput === "analyze" && shokaQuery !== undefined && shokaList) throw new Error("--shoka-list and --shoka-query cannot be combined");
  if (commandInput === "analyze" && shokaList && (shokaFilters.repository !== undefined || shokaFilters.file !== undefined || shokaFilters.top !== undefined || shokaFilters.before !== undefined || shokaFilters.after !== undefined)) throw new Error("--shoka-list only supports agent, event type, and date filters");
  if (commandInput === "draft" && (analysisPath === undefined || approvalPath === undefined)) throw new Error("draft requires --analysis and --approval");
  if (commandInput === "draft" && hasShokaOptions) throw new Error("Shoka options are only valid for analyze");
  if (commandInput === "draft" && episodePaths.length > 0) throw new Error("--from is only valid for analyze");
  if (generatorCommand === undefined) throw new Error("analyze/draft requires --generator-command <executable>");
  return {
    command: commandInput,
    episodePaths: Object.freeze(episodePaths),
    evalResultPaths: Object.freeze(evalResultPaths),
    skillsRoots: Object.freeze(skillsRoots),
    agentsPaths: Object.freeze(agentsPaths),
    generatorCommand,
    generatorArgs: Object.freeze(generatorArgs),
    outputRoot,
    timeoutMs,
    showPrompt,
    shokaList,
    shokaExecutable,
    shokaFilters: Object.freeze({ ...shokaFilters }) as ShokaSearchFilters,
    ...(analysisPath === undefined ? {} : { analysisPath }),
    ...(approvalPath === undefined ? {} : { approvalPath }),
    ...(projectRoot === undefined ? {} : { projectRoot }),
    ...(quickValidateScript === undefined ? {} : { quickValidateScript }),
    ...(shokaQuery === undefined ? {} : { shokaQuery })
  };
}

function printResult(result: WorkflowResult<unknown>): void {
  process.stdout.write("Report: " + result.artifacts.reportPath + "\nArtifacts: " + result.artifacts.directory + "\n");
  for (const candidatePath of result.artifacts.candidatePaths) process.stdout.write("Candidate: " + candidatePath + "\n");
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const generator = new CommandGenerator(options.generatorCommand, options.generatorArgs);
  const shared = {
    generator,
    skillsRoots: options.skillsRoots,
    agentsPaths: options.agentsPaths,
    outputRoot: options.outputRoot,
    timeoutMs: options.timeoutMs,
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    ...(options.quickValidateScript === undefined ? {} : { quickValidateScript: options.quickValidateScript }),
    evalResultPaths: options.evalResultPaths,
    ...(options.showPrompt ? { onPrompt: (prompt: string) => process.stdout.write("--- prompt ---\n" + prompt + "\n--- end prompt ---\n\n") } : {}),
  };
  if (options.command === "analyze") {
    if (options.shokaQuery !== undefined) {
      printResult(await runShokaAnalyze({ ...shared, query: options.shokaQuery, filters: options.shokaFilters, shokaExecutable: options.shokaExecutable }));
    } else if (options.shokaList) {
      const filters: ShokaEpisodeListFilters = {
        ...(options.shokaFilters.agent === undefined ? {} : { agent: options.shokaFilters.agent }),
        ...(options.shokaFilters.eventType === undefined ? {} : { eventType: options.shokaFilters.eventType }),
        ...(options.shokaFilters.from === undefined ? {} : { from: options.shokaFilters.from }),
        ...(options.shokaFilters.to === undefined ? {} : { to: options.shokaFilters.to })
      };
      printResult(await runShokaListAnalyze({ ...shared, filters, shokaExecutable: options.shokaExecutable }));
    } else {
      printResult(await runAnalyze({ ...shared, episodePaths: options.episodePaths }));
    }
    return;
  }
  if (options.analysisPath === undefined || options.approvalPath === undefined) throw new Error(usage());
  printResult(await runDraft({ ...shared, analysisPath: options.analysisPath, approvalPath: options.approvalPath }));
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
