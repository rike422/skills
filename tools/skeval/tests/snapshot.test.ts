import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureOutcomeSnapshot } from "../src/snapshot.js";
import { stageWorkspace } from "../src/workspace.js";
import { makeTempDirectory } from "./support.js";

describe("captureOutcomeSnapshot", () => {
  it("captures tracked and untracked changes in one immutable outcome", async () => {
    const fixture = await makeTempDirectory();
    await writeFile(join(fixture, "input.txt"), "base");
    const staged = await stageWorkspace({ type: "fixture", path: fixture });
    await writeFile(join(staged.path, "input.txt"), "changed");
    await writeFile(join(staged.path, "new.txt"), "new");

    const captured = await captureOutcomeSnapshot(staged, "completed", "Done");
    const snapshot = captured.snapshot;

    expect(snapshot.diff).toContain("new.txt");
    expect(snapshot.diff).toContain("changed");
    expect(snapshot.files.map((file) => file.path)).toEqual(["input.txt", "new.txt"]);
    expect(snapshot.finalOid).not.toBe(snapshot.baseOid);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("ignores agent-created Git hooks and uses evaluator-owned metadata", async () => {
    const fixture = await makeTempDirectory();
    await writeFile(join(fixture, "input.txt"), "base");
    const staged = await stageWorkspace({ type: "fixture", path: fixture });
    await rm(join(staged.path, ".git"));
    await mkdir(join(staged.path, ".git", "hooks"), { recursive: true });
    await writeFile(join(staged.path, ".git", "hooks", "post-index-change"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    await writeFile(join(staged.path, "input.txt"), "changed");

    const captured = await captureOutcomeSnapshot(staged, "completed", "Done");

    expect(captured.snapshot.diff).toContain("changed");
    expect(captured.snapshot.files.some((file) => file.path.startsWith(".git"))).toBe(false);
  });

  it("rejects symlinks introduced by the agent", async () => {
    const fixture = await makeTempDirectory();
    await writeFile(join(fixture, "input.txt"), "base");
    const staged = await stageWorkspace({ type: "fixture", path: fixture });
    await symlink("/tmp", join(staged.path, "escape"));
    await expect(captureOutcomeSnapshot(staged, "completed", "Done")).rejects.toThrow(/symlink/i);
  });
});
