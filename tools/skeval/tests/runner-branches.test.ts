import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSuite } from "../src/runner.js";
import type { AgentAdapter, AgentExecutionInput } from "../src/agents/types.js";
import type { ProcessResult } from "../src/process.js";
import { AgentExecutionError } from "../src/agents/types.js";
import { makeTempDirectory } from "./support.js";

class BranchAdapter implements AgentAdapter {
  readonly prompts: string[] = [];
  async preflight(executable: string) { return { executable, version: "branch 1" }; }
  async execute(input: AgentExecutionInput) {
    this.prompts.push(input.prompt);
    const finalResponse = input.role === "judge" ? JSON.stringify({ score: 0.8, reason: "clear" }) : "Done";
    const process: ProcessResult = {
      argv: ["fake"], cwd: input.cwd, exitCode: 0, signal: null, stdout: finalResponse, stderr: "", timedOut: false,
      stdoutTruncated: false, stderrTruncated: false, durationMs: 1, environmentNames: ["PATH"]
    };
    if (input.role === "executor" && (
      input.prompt.includes("Infrastructure failure") ||
      (input.prompt.includes("One-sided failure") && !input.prompt.includes("Skill instructions"))
    )) throw new AgentExecutionError("agent unavailable", { ...process, exitCode: 1, stderr: "agent unavailable" });
    return { finalResponse, process, metadata: {} };
  }
}

async function createSuite(root: string, roles = "[executor, judge, improver]"): Promise<string> {
  const skill = join(root, "skills", "branches");
  await mkdir(join(skill, "evals", "cases"), { recursive: true });
  await mkdir(join(skill, "evals", "fixture"));
  await writeFile(join(skill, "SKILL.md"), "---\nname: branches\ndescription: Branch test guidance\n---\n\nPortable guidance\n");
  await writeFile(join(skill, "evals", "fixture", "input.txt"), "input");
  await writeFile(join(skill, "evals", "cases", "judge.yaml"), `
schema_version: 1
id: judge-only
prompt: Judge this outcome.
workspace: { fixture: ../fixture }
judge:
  agent: fake
  rubric: Prefer clarity.
`);
  await writeFile(join(skill, "evals", "cases", "error.yaml"), `
schema_version: 1
id: infrastructure
prompt: Infrastructure failure.
workspace: { fixture: ../fixture }
checks: [{ type: file_exists, path: result.txt }]
`);
  await writeFile(join(skill, "evals", "cases", "one-sided.yaml"), `
schema_version: 1
id: one-sided
prompt: One-sided failure.
workspace: { fixture: ../fixture }
checks: [{ type: file_exists, path: result.txt }]
`);
  const suitePath = join(skill, "evals", "eval.yaml");
  await writeFile(suitePath, `
schema_version: 1
skill: ../SKILL.md
agents:
  fake:
    type: claude
    model: fixed-model
    roles: ${roles}
cases: [cases/*.yaml]
`);
  return suitePath;
}

describe("evaluation branches", () => {
  it("runs a blinded judge and excludes infrastructure errors", async () => {
    const root = await makeTempDirectory();
    const adapter = new BranchAdapter();
    const result = await evaluateSuite({
      suitePath: await createSuite(root),
      agentName: "fake",
      adapterFactory: () => adapter
    });
    expect(result.cases.find((item) => item.id === "judge-only")?.withSkill.score).toBe(0.8);
    expect(result.cases.find((item) => item.id === "infrastructure")?.withSkill.score).toBeNull();
    expect(result.score.withSkill).toBe(0.4);
    expect(result.score.withoutSkill).toBe(0.8);
    expect(result.score.delta).toBe(0);
    expect(result.score.pairedValidCases).toBe(1);
    const judgePrompt = adapter.prompts.find((prompt) => prompt.includes("Prefer clarity"));
    expect(judgePrompt).not.toMatch(/with_skill|without_skill|Portable guidance/);
    const failedProcess = JSON.parse(await readFile(join(
      result.artifactDirectory,
      "cases", "infrastructure", "trial-001", "without_skill", "agent", "process.json"
    ), "utf8")) as { exitCode: number };
    expect(failedProcess.exitCode).toBe(1);
  });

  it("rejects an executor without the executor role", async () => {
    const root = await makeTempDirectory();
    await expect(evaluateSuite({
      suitePath: await createSuite(root, "[judge]"),
      agentName: "fake",
      adapterFactory: () => new BranchAdapter()
    })).rejects.toThrow(/executor role/i);
  });
});
