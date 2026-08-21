import { cp, lstat, mkdtemp, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "./process.js";
import { sandboxCommand } from "./sandbox.js";
import type { CheckDefinition, CheckResult } from "./types.js";
import type { ProcessOptions } from "./process.js";

export interface CheckEvaluationDependencies {
  readonly sandboxBuilder?: (options: ProcessOptions, writableRoot: string) => Promise<ProcessOptions>;
  readonly changedPaths?: ReadonlySet<string>;
}

async function safePath(root: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) throw new Error(`Check path is outside the workspace: ${relativePath}`);
  const path = resolve(root, relativePath);
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Check path is outside the workspace: ${relativePath}`);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (info?.isSymbolicLink()) throw new Error(`Symlink is not allowed in a check path: ${relativePath}`);
    if (info === undefined) break;
  }
  return path;
}

async function runCommandCheck(
  workspace: string,
  check: Extract<CheckDefinition, { type: "command" }>,
  sandboxBuilder: (options: ProcessOptions, writableRoot: string) => Promise<ProcessOptions>
): Promise<CheckResult> {
  const root = await mkdtemp(join(tmpdir(), "skeval-check-"));
  try {
    const copy = join(root, "workspace");
    await cp(workspace, copy, { recursive: true });
    const home = join(copy, ".skeval-home");
    await mkdir(home);
    const options = await sandboxBuilder({
      argv: check.command,
      cwd: copy,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        TMPDIR: home,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null"
      },
      timeoutMs: (check.timeoutSeconds ?? 120) * 1000,
      outputLimitBytes: 1024 * 1024,
      cleanupProcessGroup: true
    }, copy);
    const result = await runProcess(options);
    return {
      name: check.command.join(" "),
      passed: result.exitCode === 0 && !result.timedOut,
      detail: result.timedOut ? "timed out" : (result.stderr || result.stdout).trim(),
      command: {
        argv: check.command,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated
      }
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function evaluateChecks(
  workspaceInput: string,
  checks: readonly CheckDefinition[],
  dependencies: CheckEvaluationDependencies = {}
): Promise<readonly CheckResult[]> {
  const workspace = await realpath(workspaceInput);
  const workspaceInfo = await stat(workspace);
  if (!workspaceInfo.isDirectory()) throw new Error(`Workspace is not a directory: ${workspace}`);
  const results: CheckResult[] = [];
  for (const check of checks) {
    if (check.type === "command") {
      results.push(await runCommandCheck(workspace, check, dependencies.sandboxBuilder ?? sandboxCommand));
      continue;
    }
    const path = await safePath(workspace, check.path);
    const info = await stat(path).catch(() => undefined);
    if (check.type === "file_exists" || check.type === "file_not_exists") {
      const exists = info?.isFile() === true;
      results.push({
        name: `${check.type}:${check.path}`,
        passed: check.type === "file_exists" ? exists : !exists,
        detail: exists ? "exists" : "missing"
      });
    } else if (check.type === "file_contains") {
      const content = info?.isFile() === true ? await readFile(path, "utf8") : "";
      results.push({ name: `file_contains:${check.path}`, passed: content.includes(check.contains), detail: info === undefined ? "missing" : "evaluated" });
    } else {
      if (dependencies.changedPaths === undefined) throw new Error("file_changed checks require immutable snapshot metadata");
      const changed = dependencies.changedPaths.has(check.path.replaceAll("\\", "/"));
      results.push({
        name: `${check.type}:${check.path}`,
        passed: check.type === "file_changed" ? changed : !changed,
        detail: changed ? "changed" : "unchanged"
      });
    }
  }
  const frozenResults: readonly CheckResult[] = Object.freeze(results.map((result) => Object.freeze(result)));
  return frozenResults;
}
