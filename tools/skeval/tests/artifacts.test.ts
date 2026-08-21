import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunArtifacts } from "../src/artifacts.js";
import { makeTempDirectory } from "./support.js";

describe("RunArtifacts", () => {
  it("writes namespaced files atomically and refuses overwrites", async () => {
    const root = await makeTempDirectory();
    const artifacts = await RunArtifacts.create(root, "rails", "fixed-run");
    await artifacts.writeText("prompts/case.txt", "prompt");
    await expect(artifacts.writeText("prompts/case.txt", "replacement")).rejects.toThrow(/exists/i);
    await artifacts.finalize({ schemaVersion: 1, ok: true });

    expect(await readFile(join(artifacts.runDirectory, "prompts", "case.txt"), "utf8")).toBe("prompt");
    const manifest = JSON.parse(await readFile(join(artifacts.runDirectory, "manifest.json"), "utf8")) as { files: unknown[] };
    expect(manifest.files.length).toBeGreaterThan(1);
  });

  it("preserves interrupted state and rejects escaping paths", async () => {
    const root = await makeTempDirectory();
    const artifacts = await RunArtifacts.create(root, "rails", "failed-run");
    await expect(artifacts.writeText("../escape", "bad")).rejects.toThrow(/escapes/i);
    await artifacts.fail(new Error("stopped"));
    expect(await readFile(join(artifacts.runDirectory, "state", "interrupted.json"), "utf8")).toContain("stopped");
  });
});
