import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareEvaluationResults, compareSuite } from "../src/compare.js";
import type { EvaluationResult } from "../src/runner.js";
import type { AgentAdapter, AgentExecutionInput } from "../src/agents/types.js";
import type { ProcessResult } from "../src/process.js";
import { makeTempDirectory } from "./support.js";

class ComparisonAdapter implements AgentAdapter {
  async preflight(executable: string) { return { executable, version: "fake 1.0" }; }
  async execute(input: AgentExecutionInput) {
    if (input.role === "executor" && input.prompt.includes("candidate-v2")) {
      await writeFile(join(input.cwd, "result.txt"), "done");
    }
    const process: ProcessResult = {
      argv: ["fake"], cwd: input.cwd, exitCode: 0, signal: null, stdout: "Done", stderr: "",
      timedOut: false, stdoutTruncated: false, stderrTruncated: false, durationMs: 1, environmentNames: []
    };
    return { finalResponse: "Done", process, metadata: {} };
  }
}

describe("compareSuite", () => {
  it("evaluates a separate candidate Skill directory without modifying the canonical Skill", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "skills", "portable");
    const candidate = join(root, "candidates", "portable");
    await mkdir(join(skill, "evals", "cases"), { recursive: true });
    await mkdir(join(skill, "evals", "fixture"));
    await mkdir(candidate, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: portable\ndescription: Current guidance\n---\n\ncurrent-v1\n");
    await writeFile(join(candidate, "SKILL.md"), "---\nname: portable\ndescription: Candidate guidance\n---\n\ncandidate-v2\n");
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

    const result = await compareSuite({
      suitePath,
      agentName: "fake",
      candidateSkillPath: join(candidate, "SKILL.md"),
      outputRoot: join(root, ".skills-eval"),
      adapterFactory: () => new ComparisonAdapter()
    });

    expect(result.current.score.withSkill).toBe(0);
    expect(result.candidate.score.withSkill).toBe(1);
    expect(result.delta).toBe(1);
    expect(result.comparison.deterministicRegressions).toEqual([]);
    expect(JSON.parse(await readFile(result.artifactPath, "utf8"))).toMatchObject({ delta: 1, skillName: "portable" });
  });

  it("keeps identical check names separate across cases", () => {
    const evaluation = (first: boolean, second: boolean): EvaluationResult => ({
      schemaVersion: 1,
      runId: "run",
      skillName: "portable",
      skillHash: "hash",
      suiteFingerprint: "suite",
      agent: "fake",
      startedAt: "start",
      finishedAt: "finish",
      cases: [["first", first], ["second", second]].map(([id, passed]) => {
        const variant = {
          score: passed ? 1 : 0,
          validTrials: 1,
          errorTrials: 0,
          trials: [{
            trial: 1,
            status: "success" as const,
            score: passed ? 1 : 0,
            checks: [{ name: "file_exists:result.txt", passed: Boolean(passed), detail: "" }],
            judgeScore: null,
            judgeReason: null,
            snapshot: null,
            error: null
          }]
        };
        return {
          id: String(id),
          withoutSkill: variant,
          withSkill: variant,
          delta: 0,
          pairedValidTrials: 1,
          pairedErrorTrials: 0
        };
      }),
      score: {
        withoutSkill: 0.5, withSkill: 0.5, delta: 0,
        withoutValidCases: 2, withoutErrorCases: 0, withValidCases: 2, withErrorCases: 0,
        pairedValidCases: 2, pairedErrorCases: 0
      },
      artifactDirectory: "/tmp/run"
    });

    const comparison = compareEvaluationResults(evaluation(true, false), evaluation(false, true));
    expect(comparison.deterministicRegressions).toEqual([{
      check: "first#1:file_exists:result.txt",
      currentPassRate: 1,
      candidatePassRate: 0
    }]);
    expect(() => compareEvaluationResults(
      evaluation(true, false),
      { ...evaluation(false, true), suiteFingerprint: "different" }
    )).toThrow(/same suite/i);
  });
});
