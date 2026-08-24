import { spawn } from "node:child_process";
import type { GenerationRequest, GenerationResult, TextGenerator } from "./types.js";

const maxOutputBytes = 4 * 1024 * 1024;

export class GeneratorCommandError extends Error {
  constructor(message: string, readonly rawResponse: string, readonly stderr: string, readonly exitCode: number | null) {
    super(message);
    this.name = "GeneratorCommandError";
  }
}

function parseOutput(output: string): GenerationResult {
  const trimmed = output.trim();
  if (trimmed === "") throw new Error("Generator command returned an empty response");
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value !== null && typeof value === "object" && "result" in value && typeof value.result === "string") {
      const metadata = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "result"));
      return { text: value.result, metadata };
    }
  } catch {
    // Plain text is also a valid response for simple wrappers.
  }
  return { text: output, metadata: {} };
}

export class CommandGenerator implements TextGenerator {
  readonly type = "command";

  constructor(private readonly executable: string, private readonly args: readonly string[] = []) {}

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.executable, [...this.args], {
        cwd: request.cwd,
        env: process.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let timedOut = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
        if (current.length >= maxOutputBytes) return current;
        return Buffer.concat([current, chunk.subarray(0, maxOutputBytes - current.length)]);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined && process.platform !== "win32") {
          try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        } else child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          if (child.pid !== undefined && process.platform !== "win32") {
            try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          } else child.kill("SIGKILL");
        }, 1000);
      }, request.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.stdin.on("error", () => undefined);
      child.on("error", (error) => reject(error));
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (child.pid !== undefined && process.platform !== "win32") {
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* Process group already exited. */ }
        }
        const rawResponse = stdout.toString("utf8");
        const stderrText = stderr.toString("utf8");
        if (timedOut) {
          reject(new GeneratorCommandError("Generator command timed out", rawResponse, stderrText, null));
          return;
        }
        if (exitCode !== 0) {
          reject(new GeneratorCommandError(`Generator command failed (${exitCode ?? "signal"}): ${stderrText || rawResponse}`, rawResponse, stderrText, exitCode));
          return;
        }
        try { resolvePromise(parseOutput(rawResponse)); }
        catch (error) { reject(new GeneratorCommandError(error instanceof Error ? error.message : String(error), rawResponse, stderrText, exitCode)); }
      });
      child.stdin.end(request.prompt);
    });
  }
}
