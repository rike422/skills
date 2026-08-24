import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog, loadEpisodeEvidence } from "../src/evidence.js";
import { episode } from "./helpers/episode.js";

describe("episode and catalog boundaries", () => {
  it("loads session episodes and separates catalog owners", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-evidence-"));
    await mkdir(join(root, "episodes"), { recursive: true });
    await writeFile(join(root, "episodes", "one.json"), JSON.stringify(episode("session-1", "lineage-1", "project-1")));
    await mkdir(join(root, "skills", "portable"), { recursive: true });
    await writeFile(join(root, "skills", "portable", "SKILL.md"), "---\nname: portable\ndescription: Focused guidance\n---\n");
    await writeFile(join(root, "AGENTS.md"), "Project rules.");
    const evidence = await loadEpisodeEvidence([join(root, "episodes")]);
    const catalog = await loadCatalog({ skillRoots: [join(root, "skills")], agentsPaths: [join(root, "AGENTS.md")] });
    expect(evidence).toHaveLength(1);
    expect(catalog.entries.map((entry) => entry.kind)).toEqual(["agents", "skill"]);
  });

  it("rejects raw sessions without task and project identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-session-"));
    const path = join(root, "session.json");
    await writeFile(path, JSON.stringify({ agent: "codex", transcript: "raw" }));
    await expect(loadEpisodeEvidence([path])).rejects.toThrow();
  });

  it("rejects a non-episode schema instead of silently adapting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-version-"));
    const path = join(root, "evidence.json");
    await writeFile(path, JSON.stringify({ schema_version: "session-evidence/v1", session: {} }));
    await expect(loadEpisodeEvidence([path])).rejects.toThrow();
  });
});
