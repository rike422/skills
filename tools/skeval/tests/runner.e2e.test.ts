import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSuite } from "../src/runner.js";
import type { AgentAdapter, AgentExecutionInput } from "../src/agents/types.js";
import type { ProcessResult } from "../src/process.js";
import { makeTempDirectory } from "./support.js";

const processResult: ProcessResult = {
  argv: ["fake"], cwd: "/tmp", exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false,
  stdoutTruncated: false, stderrTruncated: false, durationMs: 1, environmentNames: []
};

class FakeAdapter implements AgentAdapter {
  resourceSeen = false;
  async preflight(executable: string) { return { executable, version: "fake 1.0" }; }
  async execute(input: AgentExecutionInput) {
    if (input.role === "executor" && input.prompt.includes("Skill instructions")) {
      this.resourceSeen = await readFile(join(input.cwd, ".skeval-skill", "references", "guide.md"), "utf8") === "support";
      await writeFile(join(input.cwd, "result.txt"), "done");
    }
    return { finalResponse: "Done", process: { ...processResult, cwd: input.cwd }, metadata: {} };
  }
}

describe("evaluateSuite", () => {
  it("runs isolated without/with variants and reports their delta", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "skills", "portable");
    await mkdir(join(skill, "evals", "cases"), { recursive: true });
    await mkdir(join(skill, "evals", "fixture"));
    await mkdir(join(skill, "references"));
    await writeFile(join(skill, "SKILL.md"), "---\nname: portable\ndescription: Portable test guidance\n---\n\nUse the required output file.\n");
    await writeFile(join(skill, "references", "guide.md"), "support");
    await writeFile(join(skill, "evals", "fixture", "input.txt"), "input");
    await writeFile(join(skill, "evals", "cases", "one.yaml"), `
schema_version: 1
id: one
prompt: Complete the task.
workspace: { fixture: ../fixture }
checks:
  - { type: file_exists, path: result.txt }
`);
    const suitePath = join(skill, "evals", "eval.yaml");
    await writeFile(suitePath, `
schema_version: 1
skill: ../SKILL.md
agents:
  fake: { type: claude }
cases: [cases/*.yaml]
`);

    const adapter = new FakeAdapter();
    const result = await evaluateSuite({
      suitePath,
      agentName: "fake",
      outputRoot: join(root, ".skills-eval"),
      adapterFactory: () => adapter
    });

    expect(result.cases[0]?.withoutSkill.score).toBe(0);
    expect(result.cases[0]?.withSkill.score).toBe(1);
    expect(result.cases[0]?.delta).toBe(1);
    expect(result.score.withoutSkill).toBe(0);
    expect(result.score.withSkill).toBe(1);
    expect(adapter.resourceSeen).toBe(true);
    expect(result.cases[0]?.withSkill.trials[0]?.snapshot?.files.some((file) => file.path.startsWith(".skeval-skill"))).toBe(false);
    const evidence = JSON.parse(await readFile(join(result.artifactDirectory, "evidence.json"), "utf8")) as {
      kind: string;
      cases: { task: string; deterministicChecks: unknown[]; withSkill: { trials: { diff: { truncated: boolean; originalBytes: number; sha256: string } }[] } }[];
    };
    expect(evidence.kind).toBe("skeval-evaluation");
    expect(evidence.cases[0]?.task).toBe("Complete the task.");
    expect(evidence.cases[0]?.deterministicChecks).toHaveLength(1);
    expect(evidence.cases[0]?.withSkill.trials[0]?.diff).toMatchObject({ truncated: false, originalBytes: expect.any(Number) });
    expect(evidence.cases[0]?.withSkill.trials[0]?.diff.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
