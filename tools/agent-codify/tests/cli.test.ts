import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("agent-codify CLI", () => {
  it("parses analyze Shoka filters", () => {
    expect(parseArgs([
      "analyze",
      "--generator-command", "/opt/generator",
      "--generator-arg", "--json",
      "--shoka-query", "migration failures",
      "--shoka", "/opt/bin/shoka",
      "--shoka-agent", "codex",
      "--shoka-repository", "/repo",
      "--shoka-file", "internal/db.go",
      "--shoka-event-type", "test_failure",
      "--shoka-from", "2026-08-01",
      "--shoka-to", "2026-08-22",
      "--shoka-top", "30"
    ])).toMatchObject({
      command: "analyze",
      generatorCommand: "/opt/generator",
      generatorArgs: ["--json"],
      shokaQuery: "migration failures",
      shokaExecutable: "/opt/bin/shoka",
      shokaFilters: {
        agent: "codex",
        repository: "/repo",
        file: "internal/db.go",
        eventType: "test_failure",
        from: "2026-08-01",
        to: "2026-08-22",
        top: 30
      }
    });
  });

  it("requires analyze evidence mode and draft approval inputs", () => {
    expect(() => parseArgs(["analyze"])).toThrow(/--from, --shoka-list, or --shoka-query/);
    expect(() => parseArgs(["analyze", "--from", "episode.json", "--shoka-query", "history"])).toThrow(/cannot be combined/i);
    expect(() => parseArgs(["draft"])).toThrow(/--analysis and --approval/);
  });

  it("parses queryless Shoka episode listing filters", () => {
    expect(parseArgs([
      "analyze",
      "--generator-command", "/opt/generator",
      "--shoka-list",
      "--shoka-agent", "codex",
      "--shoka-event-type", "design_direction",
      "--shoka-from", "2026-08-01",
      "--shoka-to", "2026-08-22",
      "--shoka-before", "2",
      "--shoka-after", "4"
    ])).toMatchObject({
      command: "analyze",
      shokaList: true,
      shokaFilters: { agent: "codex", eventType: "design_direction", from: "2026-08-01", to: "2026-08-22", before: 2, after: 4 }
    });
  });

  it("does not accept the removed one-shot synthesize command", () => {
    expect(() => parseArgs(["synthesize", "--from", "evidence.json"])).toThrow();
  });

  it("does not select a model provider implicitly", () => {
    expect(() => parseArgs(["analyze", "--from", "episode.json"])).toThrow(/--generator-command/);
  });
});
