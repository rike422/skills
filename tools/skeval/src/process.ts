import { spawn } from "node:child_process";

export interface ProcessOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly stdin?: string;
  readonly cleanupProcessGroup?: boolean;
}

export interface ProcessResult {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
  readonly environmentNames: readonly string[];
}

function appendCapped(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>, limit: number): { value: Buffer<ArrayBufferLike>; truncated: boolean } {
  if (current.length >= limit) return { value: current, truncated: chunk.length > 0 };
  const remaining = limit - current.length;
  return { value: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: chunk.length > remaining };
}

export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const [executable, ...args] = options.argv;
  if (executable === undefined || executable.length === 0) throw new Error("Process argv must not be empty");
  const limit = options.outputLimitBytes ?? 1024 * 1024;
  const startedAt = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : options.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      } else {
        child.kill("SIGTERM");
      }
      forceTimer = setTimeout(() => {
        if (child.pid !== undefined && process.platform !== "win32") {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        } else {
          child.kill("SIGKILL");
        }
      }, 1000);
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const appended = appendCapped(stdout, chunk, limit);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const appended = appendCapped(stderr, chunk, limit);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      if (options.cleanupProcessGroup === true && child.pid !== undefined && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* process group already exited */ }
      }
      resolvePromise({
        argv: options.argv,
        cwd: options.cwd,
        exitCode,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Date.now() - startedAt,
        environmentNames: Object.freeze(Object.keys(options.env ?? process.env).sort())
      });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

export async function runSuccessful(options: ProcessOptions): Promise<ProcessResult> {
  const result = await runProcess(options);
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`Command failed (${options.argv.join(" ")}): ${result.stderr || result.stdout}`);
  }
  return result;
}
