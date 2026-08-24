import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadShokaEpisodeList, loadShokaEvidence } from "../src/shoka.js";
import { fakeShoka } from "./helpers/fake-shoka.js";

describe("Shoka transcript episode source", () => {
  it("searches the canonical episode endpoint with argument boundaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-"));
    const fake = await fakeShoka(root);

    const selection = await loadShokaEvidence({
      executable: fake.executable,
      query: "migration; rm -rf ignored",
      filters: {
        agent: "codex",
        repository: "/tmp/example repo",
        file: "internal/db.go",
        eventType: "error",
        from: "2026-08-01",
        to: "2026-08-22",
        top: 12,
        before: 2,
        after: 4
      }
    });

    expect(selection.episodeIds).toEqual(["codex:one:1:user_correction", "codex:two:1:user_correction"]);
    expect(selection.documents.map((item) => item.source)).toEqual([
      "shoka:codex:one:1:user_correction",
      "shoka:codex:two:1:user_correction"
    ]);
    expect(selection.documents[0]?.value).toMatchObject({ schema_version: "transcript-episode/v1" });
    const calls = (await readFile(fake.logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls).toEqual([[
      "transcript", "episode", "search", "migration; rm -rf ignored",
      "--agent", "codex",
      "--repository", "/tmp/example repo",
      "--file", "internal/db.go",
      "--event-type", "error",
      "--from", "2026-08-01",
      "--to", "2026-08-22",
      "--top", "12",
      "--before", "2",
      "--after", "4",
      "--json"
    ]]);
  });

  it("fails closed when Shoka returns an incompatible evidence version", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-version-"));
    const fake = await fakeShoka(root);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "invalid" })).rejects.toThrow(/transcript-episode\/v1/i);
  });

  it("summarizes, lists, and exports queryless episode candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-list-"));
    const fake = await fakeShoka(root);
    const selection = await loadShokaEpisodeList({
      executable: fake.executable,
      filters: { agent: "codex", eventType: "design_direction", from: "2026-08-01", to: "2026-08-22", before: 2, after: 4 }
    });
    expect(selection.selectionType).toBe("shoka-list");
    expect(selection.complete).toBe(true);
    expect(selection.episodeIds).toEqual(["codex:list:1:design_direction"]);
    expect(selection.summary).toMatchObject({ episodes: 1, sessions: 1, task_lineages: 1, projects: 1 });
    expect(selection.candidates[0]).toMatchObject({ episode_id: "codex:list:1:design_direction", task_status: "complete" });
    expect(selection.documents[0]?.value).toMatchObject({ schema_version: "transcript-episode/v1" });
    const calls = (await readFile(fake.logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toEqual([
      "transcript", "episode", "summary", "--agent", "codex", "--event-type", "design_direction",
      "--from", "2026-08-01", "--to", "2026-08-22", "--json"
    ]);
    expect(calls[1]).toEqual([
      "transcript", "episode", "list", "--agent", "codex", "--event-type", "design_direction",
      "--from", "2026-08-01", "--to", "2026-08-22", "--json"
    ]);
    expect(calls[2]).toEqual([
      "transcript", "episode", "export", "codex:list:1:design_direction",
      "--output", expect.any(String), "--before", "2", "--after", "4"
    ]);
  });

  it("accepts zero episodes from the list endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-list-empty-"));
    const fake = await fakeShoka(root);
    const selection = await loadShokaEpisodeList({ executable: fake.executable, filters: { eventType: "empty" } });
    expect(selection.documents).toHaveLength(0);
    expect(selection.summary.episodes).toBe(0);
  });

  it("deduplicates candidate IDs before export", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-list-dedup-"));
    const fake = await fakeShoka(root);
    const selection = await loadShokaEpisodeList({ executable: fake.executable, filters: { eventType: "duplicate" } });
    expect(selection.episodeIds).toEqual(["codex:list:1:design_direction"]);
    const calls = (await readFile(fake.logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[2] === "export")).toHaveLength(1);
  });

  it("fails closed on summary/list mismatch, excessive candidates, and incompatible exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-list-contract-"));
    const fake = await fakeShoka(root);
    await expect(loadShokaEpisodeList({ executable: fake.executable, filters: { eventType: "mismatch" } })).rejects.toThrow(/summary.*list/i);
    await expect(loadShokaEpisodeList({ executable: fake.executable, filters: { eventType: "too-many" } })).rejects.toThrow(/500.*narrow/i);
    await expect(loadShokaEpisodeList({ executable: fake.executable, filters: { eventType: "invalid" } })).rejects.toThrow(/transcript-episode\/v1/i);
    await expect(loadShokaEpisodeList({ executable: fake.executable, filters: { eventType: "oversized-export" } })).rejects.toThrow(/exceeds 1048576 bytes/i);
  });

  it("stops before generation when no episode matched", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-empty-"));
    const fake = await fakeShoka(root);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "empty" })).rejects.toThrow(/no Shoka transcript episodes/i);
  });

  it("rejects invalid queries, limits, search output, subprocess failures, and oversized episodes", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-codify-shoka-errors-"));
    const fake = await fakeShoka(root);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "  " })).rejects.toThrow(/must not be empty/i);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "ok", filters: { top: 101 } })).rejects.toThrow(/1 to 100/i);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "malformed" })).rejects.toThrow(/malformed JSON/i);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "failure" })).rejects.toThrow(/index unavailable/i);
    await expect(loadShokaEvidence({ executable: fake.executable, query: "oversized" })).rejects.toThrow(/exceeds 1048576 bytes/i);
  });
});
