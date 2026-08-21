import { describe, expect, it } from "vitest";
import { buildAgentPrompt, buildJudgePrompt } from "../src/prompts.js";

describe("prompt construction", () => {
  it("keeps all framework-owned skill delivery text in PromptBuilder", () => {
    const prompt = buildAgentPrompt({ task: "Do the task.", skill: "Use small methods.", variant: "with_skill", resourcePath: ".skeval-skill" });
    expect(prompt).toContain("Do the task.");
    expect(prompt).toContain("Use small methods.");
    expect(prompt).toContain("Skill instructions");
    expect(prompt).toContain(".skeval-skill");
  });

  it("does not reveal branch labels or skill text to the judge", () => {
    const prompt = buildJudgePrompt({
      task: "Refactor.",
      rubric: "Prefer clarity.",
      diff: "diff --git a/a b/a",
      checks: [{ name: "tests", passed: true, detail: "ok" }],
      finalResponse: "Done"
    });
    expect(prompt).not.toMatch(/with_skill|without_skill|Skill instructions/);
    expect(prompt).toContain("Prefer clarity.");
  });
});
