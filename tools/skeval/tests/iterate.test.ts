import { describe, expect, it } from "vitest";
import { buildImprovementPrompt, extractCandidateSkill, nextCandidatePath } from "../src/iterate.js";
import { makeTempDirectory } from "./support.js";

describe("iteration", () => {
  it("builds an evidence-oriented improvement prompt", () => {
    const prompt = buildImprovementPrompt({
      currentSkill: "Current skill",
      evidence: [{ caseId: "one", prompt: "Task", delta: -0.2, failures: ["tests failed"] }]
    });
    expect(prompt).toContain("Observed failure");
    expect(prompt).toContain("overfit");
    expect(prompt).toContain("tests failed");
  });

  it("accepts a fenced candidate while removing the fence", () => {
    expect(extractCandidateSkill("```markdown\n---\nname: candidate\n---\nBody\n```"))
      .toBe("---\nname: candidate\n---\nBody\n");
  });

  it("allocates monotonically numbered candidate paths", async () => {
    const root = await makeTempDirectory();
    const first = await nextCandidatePath(root, "portable");
    expect(first).toMatch(/iteration-001\.md$/);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(first, "candidate"));
    expect(await nextCandidatePath(root, "portable")).toMatch(/iteration-002\.md$/);
    await expect(nextCandidatePath(root, "../bad")).rejects.toThrow(/invalid/i);
    expect(() => extractCandidateSkill(" ")).toThrow(/empty/i);
    expect(() => extractCandidateSkill("x".repeat(256 * 1024 + 1))).toThrow(/256 KiB/i);
  });
});
