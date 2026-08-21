import { describe, expect, it } from "vitest";
import { runProcess, runSuccessful } from "../src/process.js";

describe("runProcess", () => {
  it("caps captured output and records truncation", async () => {
    const result = await runProcess({
      argv: [process.execPath, "-e", "process.stdout.write('x'.repeat(100))"],
      cwd: process.cwd(),
      outputLimitBytes: 16
    });
    expect(result.stdout).toHaveLength(16);
    expect(result.stdoutTruncated).toBe(true);
  });

  it("terminates a process after its timeout", async () => {
    const result = await runProcess({
      argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 50
    });
    expect(result.timedOut).toBe(true);
  });

  it("passes stdin, captures stderr, and rejects unsuccessful commands", async () => {
    const success = await runSuccessful({
      argv: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
      cwd: process.cwd(),
      stdin: "hello"
    });
    expect(success.stdout).toBe("hello");
    await expect(runSuccessful({
      argv: [process.execPath, "-e", "process.stderr.write('bad'); process.exit(2)"],
      cwd: process.cwd()
    })).rejects.toThrow(/bad/);
  });

  it("can clean up the spawned process group after success", async () => {
    const result = await runProcess({
      argv: [process.execPath, "-e", "process.stdout.write('done')"],
      cwd: process.cwd(),
      cleanupProcessGroup: true
    });
    expect(result.stdout).toBe("done");
  });
});
