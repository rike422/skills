import { describe, expect, it } from "vitest";
import { ClaudeAdapter, buildClaudeInvocation } from "../src/agents/claude.js";
import type { ProcessResult } from "../src/process.js";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("ClaudeAdapter", () => {
  it("uses safe mode, fixed tools, no persistence, and no permission bypass", () => {
    const invocation = buildClaudeInvocation({
      executable: "claude",
      prompt: "task",
      cwd: "/tmp/workspace",
      timeoutMs: 1000,
      role: "executor",
      model: "sonnet"
    });
    expect(invocation.argv).toContain("--safe-mode");
    expect(invocation.argv).toContain("--no-session-persistence");
    expect(invocation.argv.join(" ")).not.toContain("dangerously-skip-permissions");
    expect(invocation.argv).toContain("Bash,Edit,Write");
    expect(invocation.argv.join(" ")).toContain("failIfUnavailable");
    expect(invocation.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe("1");
    const settings = JSON.parse(invocation.argv[invocation.argv.indexOf("--settings") + 1] ?? "{}") as {
      sandbox?: { filesystem?: { denyRead?: string[]; allowRead?: string[] } };
    };
    expect(settings.sandbox?.filesystem?.denyRead).toContain(tmpdir());
    expect(settings.sandbox?.filesystem?.allowRead).toContain("/tmp/workspace");
  });

  it("removes tools for the judge role", () => {
    const invocation = buildClaudeInvocation({ executable: "claude", prompt: "task", cwd: "/tmp", timeoutMs: 1000, role: "judge" });
    const toolIndex = invocation.argv.indexOf("--tools");
    expect(invocation.argv[toolIndex + 1]).toBe("");
  });

  it("rejects malformed JSON output", async () => {
    const adapter = new ClaudeAdapter(async () => ({
      argv: [], cwd: "/tmp", exitCode: 0, signal: null, stdout: "not json", stderr: "", timedOut: false,
      stdoutTruncated: false, stderrTruncated: false, durationMs: 1, environmentNames: []
    }));
    await expect(adapter.execute({ executable: "claude", prompt: "task", cwd: "/tmp", timeoutMs: 1000, role: "judge" }))
      .rejects.toThrow(/JSON/i);
  });

  it("preflights and parses successful output", async () => {
    const adapter = new ClaudeAdapter(async (options) => ({
      argv: options.argv,
      cwd: options.cwd,
      exitCode: 0,
      signal: null,
      stdout: options.argv.includes("--version") ? "2.0.0\n" : JSON.stringify({ result: "Done", cost_usd: 0.01 }),
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 1,
      environmentNames: []
    }));
    await expect(adapter.preflight("claude")).resolves.toEqual({ executable: "claude", version: "2.0.0" });
    await expect(adapter.execute({ executable: "claude", prompt: "task", cwd: "/tmp", timeoutMs: 1000, role: "executor" }))
      .resolves.toMatchObject({ finalResponse: "Done" });
  });

  it("reports preflight, timeout, exit, and shape failures", async () => {
    const result = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
      argv: ["claude"], cwd: "/tmp", exitCode: 1, signal: null, stdout: "", stderr: "failed", timedOut: false,
      stdoutTruncated: false, stderrTruncated: false, durationMs: 1, environmentNames: [], ...overrides
    });
    await expect(new ClaudeAdapter(async () => result()).preflight("claude")).rejects.toThrow(/preflight/i);
    await expect(new ClaudeAdapter(async () => result({ timedOut: true })).execute({ executable: "claude", prompt: "x", cwd: "/tmp", timeoutMs: 1, role: "executor" })).rejects.toThrow(/timed out/i);
    await expect(new ClaudeAdapter(async () => result()).execute({ executable: "claude", prompt: "x", cwd: "/tmp", timeoutMs: 1, role: "executor" })).rejects.toThrow(/failed/i);
    await expect(new ClaudeAdapter(async () => result({ exitCode: 0, stdout: "{}" })).execute({ executable: "claude", prompt: "x", cwd: "/tmp", timeoutMs: 1, role: "executor" })).rejects.toThrow(/string result/i);
  });

  it("pins and hashes a real executable identity", async () => {
    const identity = await new ClaudeAdapter().preflight(process.execPath);
    expect(identity.executable).toBe(await realpath(process.execPath));
    expect(identity.executableHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.version).toMatch(/^v\d+/);
  });
});
