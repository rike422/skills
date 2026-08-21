import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";
import { stageWorkspace } from "../src/workspace.js";
import { makeTempDirectory } from "./support.js";

describe("stageWorkspace", () => {
  it("creates an isolated git baseline from a fixture", async () => {
    const root = await makeTempDirectory();
    const fixture = join(root, "fixture");
    await mkdir(fixture);
    await writeFile(join(fixture, "input.txt"), "original");

    const staged = await stageWorkspace({ type: "fixture", path: fixture });
    await writeFile(join(staged.path, "input.txt"), "changed");

    expect(await readFile(join(fixture, "input.txt"), "utf8")).toBe("original");
    expect(staged.baseOid).toMatch(/^[a-f0-9]{40,64}$/);
  });

  it("rejects fixture symlinks", async () => {
    const root = await makeTempDirectory();
    const fixture = join(root, "fixture");
    await mkdir(fixture);
    await writeFile(join(root, "outside.txt"), "outside");
    await symlink(join(root, "outside.txt"), join(fixture, "link.txt"));

    await expect(stageWorkspace({ type: "fixture", path: fixture })).rejects.toThrow(/symlink/i);
  });

  it("rejects a symlinked fixture root", async () => {
    const root = await makeTempDirectory();
    const fixture = join(root, "fixture");
    await mkdir(fixture);
    await symlink(fixture, join(root, "linked-fixture"));
    await expect(stageWorkspace({ type: "fixture", path: join(root, "linked-fixture") })).rejects.toThrow(/root.*symlink/i);
  });

  it("resolves a git ref and clones without sharing local objects", async () => {
    const source = await makeTempDirectory();
    await runProcess({ argv: ["git", "init", "-q"], cwd: source });
    await writeFile(join(source, "file.txt"), "source");
    await runProcess({ argv: ["git", "add", "file.txt"], cwd: source });
    await runProcess({ argv: ["git", "-c", "user.name=skeval", "-c", "user.email=skeval@example.invalid", "commit", "-qm", "base"], cwd: source });

    const staged = await stageWorkspace({ type: "git", path: source, ref: "HEAD" });
    const alternates = await readFile(join(staged.gitDirectory, "objects", "info", "alternates"), "utf8").catch(() => "");

    expect(alternates).toBe("");
    expect(await readFile(join(staged.path, "file.txt"), "utf8")).toBe("source");
  });
});
