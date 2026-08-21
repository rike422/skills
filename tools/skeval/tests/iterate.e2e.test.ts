import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { iterateSuite } from "../src/iterate.js";
import type { AgentAdapter, AgentExecutionInput } from "../src/agents/types.js";
import type { ProcessResult } from "../src/process.js";
import { makeTempDirectory } from "./support.js";

class IterationAdapter implements AgentAdapter {
  async preflight(executable: string) { return { executable, version: "fake 1.0" }; }
  async execute(input: AgentExecutionInput) {
    if (input.role === "executor" && input.prompt.includes("candidate-v2")) {
      await writeFile(join(input.cwd, "result.txt"), "done");
    }
    const finalResponse = input.role === "improver"
      ? "---\nname: portable\ndescription: Candidate guidance\n---\n\ncandidate-v2\n"
      : "Done";
    const process: ProcessResult = {
      argv: ["fake"], cwd: input.cwd, exitCode: 0, signal: null, stdout: finalResponse, stderr: "",
      timedOut: false, stdoutTruncated: false, stderrTruncated: false, durationMs: 1, environmentNames: []
    };
    return { finalResponse, process, metadata: {} };
  }
}

describe("iterateSuite", () => {
  it("preserves the canonical Skill and evaluates a separate candidate", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "skills", "portable");
    await mkdir(join(skill, "evals", "cases"), { recursive: true });
    await mkdir(join(skill, "evals", "fixture"));
    const currentSkill = "---\nname: portable\ndescription: Current guidance\n---\n\ncurrent-v1\n";
    await writeFile(join(skill, "SKILL.md"), currentSkill);
    await writeFile(join(skill, "evals", "fixture", "input.txt"), "input");
    await writeFile(join(skill, "evals", "cases", "one.yaml"), `
schema_version: 1
id: one
prompt: Complete the task.
workspace: { fixture: ../fixture }
checks: [{ type: file_exists, path: result.txt }]
`);
    const suitePath = join(skill, "evals", "eval.yaml");
    await writeFile(suitePath, `
schema_version: 1
skill: ../SKILL.md
agents:
  fake: { type: claude }
cases: [cases/*.yaml]
`);

    const result = await iterateSuite({
      suitePath,
      agentName: "fake",
      outputRoot: join(root, ".skills-eval"),
      adapterFactory: () => new IterationAdapter()
    });

    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe(currentSkill);
    expect(await readFile(result.candidatePath, "utf8")).toContain("candidate-v2");
    expect(result.current.score.withSkill).toBe(0);
    expect(result.candidate.score.withSkill).toBe(1);
    expect(result.delta).toBe(1);
    expect(result.comparison.current.deterministicPassRate).toBe(0);
    expect(result.comparison.candidate.deterministicPassRate).toBe(1);
    expect(result.comparison.deterministicRegressions).toEqual([]);

    const failingAdapter: AgentAdapter = {
      async preflight(executable: string) { return { executable, version: "fake 1.0" }; },
      async execute() { throw new Error("agent unavailable"); }
    };
    await expect(iterateSuite({
      suitePath,
      agentName: "fake",
      outputRoot: join(root, ".skills-eval-failed"),
      adapterFactory: () => failingAdapter
    })).rejects.toThrow(/inconclusive evaluation/i);
  });
});
