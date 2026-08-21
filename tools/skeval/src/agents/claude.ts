import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { runProcess, type ProcessOptions, type ProcessResult } from "../process.js";
import { AgentExecutionError, type AgentAdapter, type AgentExecutionInput, type AgentExecutionResult, type AgentPreflight } from "./types.js";

type ProcessRunner = (options: ProcessOptions) => Promise<ProcessResult>;
type ExecutableResolver = (executable: string) => Promise<{ path: string; hash?: string }>;

const preservedEnvironmentNames = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
  "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "GOOGLE_APPLICATION_CREDENTIALS"
] as const;

function allowlistedEnvironment(): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1", DISABLE_AUTOUPDATER: "1" };
  for (const name of preservedEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function resolveExecutable(executable: string): Promise<{ path: string; hash: string }> {
  const candidates = isAbsolute(executable) || executable.includes("/")
    ? [executable]
    : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      const path = await realpath(candidate);
      return { path, hash: await hashFile(path) };
    } catch {
      // Continue searching the fixed host PATH.
    }
  }
  throw new Error(`Unable to resolve trusted agent executable: ${executable}`);
}

export function buildClaudeInvocation(input: AgentExecutionInput): ProcessOptions {
  const tools = input.role === "executor" ? "Bash,Edit,Write" : "";
  const deniedReads = [tmpdir(), ...(process.env.HOME === undefined ? [] : [process.env.HOME])];
  const allowedReads = [
    input.cwd,
    ...(process.env.PATH ?? "").split(":").filter(Boolean)
  ];
  const settings = JSON.stringify({
    sandbox: {
      enabled: input.role === "executor",
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      network: { allowedDomains: [] },
      filesystem: { denyRead: deniedReads, allowRead: allowedReads }
    }
  });
  const argv = [
    input.executable,
    "--print",
    input.prompt,
    "--output-format", "json",
    "--safe-mode",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--permission-mode", "dontAsk",
    "--tools", tools,
    "--allowedTools", tools,
    "--settings", settings
  ];
  if (input.model !== undefined) argv.push("--model", input.model);
  return {
    argv,
    cwd: input.cwd,
    env: allowlistedEnvironment(),
    timeoutMs: input.timeoutMs,
    outputLimitBytes: 4 * 1024 * 1024,
    cleanupProcessGroup: true
  };
}

function parseClaudeOutput(output: string): { result: string; metadata: Readonly<Record<string, unknown>> } {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { throw new Error("Claude returned malformed JSON output"); }
  if (parsed === null || typeof parsed !== "object" || !("result" in parsed) || typeof parsed.result !== "string") {
    throw new Error("Claude JSON output does not contain a string result");
  }
  return { result: parsed.result, metadata: parsed as Record<string, unknown> };
}

export class ClaudeAdapter implements AgentAdapter {
  private readonly executableResolver: ExecutableResolver;

  constructor(private readonly processRunner: ProcessRunner = runProcess, executableResolver?: ExecutableResolver) {
    this.executableResolver = executableResolver ?? (processRunner === runProcess
      ? resolveExecutable
      : async (executable) => ({ path: executable }));
  }

  async preflight(executable: string): Promise<AgentPreflight> {
    const identity = await this.executableResolver(executable);
    const result = await this.processRunner({
      argv: [identity.path, "--version"],
      cwd: process.cwd(),
      env: allowlistedEnvironment(),
      timeoutMs: 10_000,
      outputLimitBytes: 64 * 1024
    });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`Claude preflight failed: ${result.stderr || result.stdout}`);
    return Object.freeze({
      executable: identity.path,
      version: result.stdout.trim(),
      ...(identity.hash === undefined ? {} : { executableHash: identity.hash })
    });
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const processResult = await this.processRunner(buildClaudeInvocation(input));
    if (processResult.timedOut) throw new AgentExecutionError("Claude execution timed out", processResult);
    if (processResult.exitCode !== 0) throw new AgentExecutionError(`Claude execution failed: ${processResult.stderr || processResult.stdout}`, processResult);
    let parsed: ReturnType<typeof parseClaudeOutput>;
    try {
      parsed = parseClaudeOutput(processResult.stdout);
    } catch (error) {
      throw new AgentExecutionError(error instanceof Error ? error.message : String(error), processResult);
    }
    return Object.freeze({ finalResponse: parsed.result, process: processResult, metadata: parsed.metadata });
  }
}
