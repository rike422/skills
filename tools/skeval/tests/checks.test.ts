import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateChecks } from "../src/checks.js";
import { captureOutcomeSnapshot } from "../src/snapshot.js";
import { stageWorkspace } from "../src/workspace.js";
import { makeTempDirectory } from "./support.js";

describe("evaluateChecks", () => {
  it("evaluates file checks", async () => {
    const root = await makeTempDirectory();
    await writeFile(join(root, "result.txt"), "done");
    const results = await evaluateChecks(root, [
      { type: "file_exists", path: "result.txt" },
      { type: "file_contains", path: "result.txt", contains: "done" }
    ]);
    expect(results.map((result) => result.passed)).toEqual([true, true]);
  });

  it("rejects path traversal and symlink escape", async () => {
    const root = await makeTempDirectory();
    await mkdir(join(root, "nested"));
    await symlink("/tmp", join(root, "nested", "escape"));
    await expect(evaluateChecks(root, [{ type: "file_exists", path: "../outside" }])).rejects.toThrow(/outside/i);
    await expect(evaluateChecks(root, [{ type: "file_exists", path: "nested/escape/file" }])).rejects.toThrow(/symlink/i);
  });

  it("reports changed, unchanged, and absent files", async () => {
    const fixture = await makeTempDirectory();
    await writeFile(join(fixture, "changed.txt"), "before");
    await writeFile(join(fixture, "same.txt"), "same");
    const staged = await stageWorkspace({ type: "fixture", path: fixture });
    await writeFile(join(staged.path, "changed.txt"), "after");
    const captured = await captureOutcomeSnapshot(staged, "completed", "Done");

    const results = await evaluateChecks(captured.workspacePath, [
      { type: "file_changed", path: "changed.txt" },
      { type: "file_not_changed", path: "same.txt" },
      { type: "file_not_exists", path: "absent.txt" }
    ], { changedPaths: new Set(captured.snapshot.changedPaths) });
    expect(results.map((result) => result.passed)).toEqual([true, true, true]);
  });

  it("records command evidence", async () => {
    const root = await makeTempDirectory();
    const [result] = await evaluateChecks(
      root,
      [{ type: "command", command: ["/bin/sh", "-c", "printf ok"] }],
      {
        sandboxBuilder: async (options) => {
          expect(options.cleanupProcessGroup).toBe(true);
          return options;
        }
      }
    );
    expect(result?.passed).toBe(true);
    expect(result?.command).toMatchObject({ exitCode: 0, stdout: "ok", timedOut: false });
  });
});
