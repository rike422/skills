import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runAnalyze, runDraft } from "../src/workflows.js";
import { sha256 } from "../src/output.js";
import type { GenerationRequest, GenerationResult, TextGenerator } from "../src/types.js";
import { episode } from "./helpers/episode.js";

class QueueGenerator implements TextGenerator {
  readonly type = "fake";
  readonly prompts: string[] = [];
  constructor(private readonly outputs: string[]) {}
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.prompts.push(request.prompt);
    const text = this.outputs.shift();
    if (text === undefined) throw new Error("No fake output");
    return { text, metadata: {} };
  }
}

function tempDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-codify-test-"));
}

function analysisResult() {
  return {
    schema_version: 1,
    kind: "agent-codify-analysis",
    summary: "Repeated successful corrections support a portable decision rule.",
    clusters: [{
      id: "consolidate-owner",
      problem: "The agent added a parallel abstraction and the user redirected it to the canonical owner.",
      meaning: "TECHNICAL_DECISION_RULE",
      destination: "NEW_SKILL",
      evidence_counts: { raw_occurrences: 3, sessions: 3, task_lineages: 2, projects: 2, successful_corrections: 3 },
      evidence_sources: ["evidence-001", "evidence-002", "evidence-003"],
      correction_evidence: [{
        agent_decision_before: "Add a second abstraction.",
        user_correction: "Use the existing abstraction.",
        requested_alternative: "Consolidate the canonical owner.",
        implementation_after: "Updated the existing abstraction.",
        observed_result: "Tests passed.",
        task_lineage_ids: ["lineage-1", "lineage-2"],
        success: true
      }],
      observed_effects: ["Tests passed after the correction."],
      existing_owners: [],
      deterministic_actions: [],
      skill_gate: {
        non_trivial_decision_rule: true,
        multiple_task_lineages: true,
        successful_correction_observed: true,
        project_independent: true,
        deterministic_controls_insufficient: true,
        no_existing_owner_overlap: true,
        trigger_is_explicit: true,
        eligible: true
      },
      recommendation: "Draft a narrow portable Skill and evaluate it."
    }]
  };
}

function candidate() {
  return {
    name: "canonical-owner-decisions",
    skill_markdown: "---\nname: canonical-owner-decisions\ndescription: Consolidate overlapping responsibilities before adding an abstraction.\n---\n\nInspect existing owners before introducing a parallel policy or adapter.\n",
    rationale: "The same corrected decision succeeded across independent task lineages.",
    eval_proposals: [{ id: "owner-positive", kind: "positive", prompt: "Choose an owner for an overlapping responsibility.", rationale: "Tests the decision rule." }]
  };
}

function critic() {
  const checks = [
    "NO_GENERIC_ADVICE", "NO_CASE_OVERGENERALIZATION", "DISTINCT_DESCRIPTION", "NARROW_RESPONSIBILITY",
    "AVAILABLE_REFERENCES_ONLY", "PROGRESSIVE_DISCLOSURE", "SCOPE_PRESERVED", "NO_EXISTING_OWNER_OVERLAP"
  ] as const;
  return {
    schema_version: 1,
    kind: "skill-creator-critic",
    candidate_name: "canonical-owner-decisions",
    passed: true,
    findings: checks.map((check) => ({ check, passed: true, explanation: "The candidate satisfies this check." }))
  };
}

async function writeEpisodes(root: string): Promise<string> {
  const directory = join(root, "episodes");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "one.json"), JSON.stringify(episode("session-1", "lineage-1", "project-1")));
  await writeFile(join(directory, "two.json"), JSON.stringify(episode("session-2", "lineage-1", "project-2")));
  await writeFile(join(directory, "three.json"), JSON.stringify(episode("session-3", "lineage-2", "project-2")));
  return directory;
}

describe("canonical analyze/draft workflow", () => {
  it("analyzes correction evidence without creating a Skill", async () => {
    const root = await tempDirectory();
    const episodes = await writeEpisodes(root);
    const generator = new QueueGenerator([JSON.stringify(analysisResult())]);
    const run = await runAnalyze({ generator, episodePaths: [episodes], outputRoot: join(root, "output") });
    expect(run.artifacts.candidatePaths).toEqual([]);
    expect(await readFile(join(run.artifacts.directory, "result.json"), "utf8")).toContain("successful_corrections");
    expect(await readFile(join(run.artifacts.directory, "inputs", "evidence-001.json"), "utf8")).toContain("transcript-episode/v1");
    expect(generator.prompts[0]).toContain("Do not write or propose a SKILL.md");
  });

  it("retries invalid analysis and preserves raw response plus validation", async () => {
    const root = await tempDirectory();
    const episodes = await writeEpisodes(root);
    const generator = new QueueGenerator(["{\"schema_version\":1,\"unexpected\":true}", JSON.stringify(analysisResult())]);
    const run = await runAnalyze({ generator, episodePaths: [episodes], outputRoot: join(root, "output") });
    expect(await readFile(join(run.artifacts.directory, "attempts", "analysis-001.raw.txt"), "utf8")).toContain("unexpected");
    expect(await readFile(join(run.artifacts.directory, "attempts", "analysis-001.validation.json"), "utf8")).toContain("\"ok\": false");
    expect(generator.prompts).toHaveLength(2);
  });

  it("drafts only an approved cluster and independently criticizes it", async () => {
    const root = await tempDirectory();
    const episodes = await writeEpisodes(root);
    const analyze = await runAnalyze({
      generator: new QueueGenerator([JSON.stringify(analysisResult())]),
      episodePaths: [episodes],
      outputRoot: join(root, "output")
    });
    const analysisPath = join(analyze.artifacts.directory, "result.json");
    const approvalPath = join(root, "approval.json");
    await writeFile(approvalPath, JSON.stringify({
      schema_version: 1,
      analysis_result_sha256: sha256(await readFile(analysisPath, "utf8")),
      approved_clusters: [{ cluster_id: "consolidate-owner", notes: "Approved after human review." }],
      reviewer: "human",
      approved_at: "2026-08-23T00:00:00Z"
    }));
    const generator = new QueueGenerator([JSON.stringify({
      schema_version: 1,
      kind: "agent-codify-draft",
      cluster_id: "consolidate-owner",
      destination: "NEW_SKILL",
      candidate: candidate()
    }), JSON.stringify(critic())]);
    const run = await runDraft({ generator, analysisPath, approvalPath, outputRoot: join(root, "output") });
    expect(run.result.drafts[0]?.critic.passed).toBe(true);
    expect(run.artifacts.candidatePaths[0]).toMatch(/candidate\/canonical-owner-decisions\/SKILL\.md$/);
    expect(await readFile(run.artifacts.candidatePaths[0] ?? "", "utf8")).toContain("canonical-owner-decisions");
    expect(await readFile(join(run.artifacts.directory, "critic.json"), "utf8")).toContain("skill-creator-critic");
  });

  it("rejects approval for a cluster that fails the Skill gate", async () => {
    const root = await tempDirectory();
    const episodes = await writeEpisodes(root);
    const invalid = analysisResult();
    invalid.clusters[0].destination = "PROJECT_RULE";
    invalid.clusters[0].skill_gate.project_independent = false;
    invalid.clusters[0].skill_gate.eligible = false;
    const analyze = await runAnalyze({ generator: new QueueGenerator([JSON.stringify(invalid)]), episodePaths: [episodes], outputRoot: join(root, "output") });
    const analysisPath = join(analyze.artifacts.directory, "result.json");
    const approvalPath = join(root, "approval.json");
    await writeFile(approvalPath, JSON.stringify({
      schema_version: 1,
      analysis_result_sha256: sha256(await readFile(analysisPath, "utf8")),
      approved_clusters: [{ cluster_id: "consolidate-owner" }],
      reviewer: "human",
      approved_at: "2026-08-23T00:00:00Z"
    }));
    await expect(runDraft({ generator: new QueueGenerator([]), analysisPath, approvalPath, outputRoot: join(root, "output") })).rejects.toThrow(/cannot produce a Skill draft/i);
  });
});
