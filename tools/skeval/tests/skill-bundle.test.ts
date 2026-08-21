import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { materializeSkillBundle, snapshotSkillBundle } from "../src/skill-bundle.js";
import { makeTempDirectory } from "./support.js";

describe("snapshotSkillBundle", () => {
  it("includes portable resources and excludes eval data", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "portable");
    await mkdir(join(skill, "references"), { recursive: true });
    await mkdir(join(skill, "evals"));
    await writeFile(join(skill, "SKILL.md"), "---\nname: portable\ndescription: Portable guidance\n---\n\nBody\n");
    await writeFile(join(skill, "references", "guide.md"), "guide");
    await writeFile(join(skill, "evals", "secret.md"), "must not leak");

    const bundle = await snapshotSkillBundle(join(skill, "SKILL.md"));

    expect(bundle.files.map((file) => file.path)).toEqual(["SKILL.md", "references/guide.md"]);
    expect(bundle.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips binary assets while materializing a stable bundle", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "portable");
    await mkdir(join(skill, "assets"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: portable\ndescription: Portable guidance\n---\n");
    await writeFile(join(skill, "assets", "binary.dat"), Buffer.from([0, 255, 1, 2]));
    const bundle = await snapshotSkillBundle(join(skill, "SKILL.md"));
    const destination = join(root, "materialized");
    await materializeSkillBundle(bundle, destination);
    expect(await readFile(join(destination, "assets", "binary.dat"))).toEqual(Buffer.from([0, 255, 1, 2]));
  });

  it("rejects symlinks in the included resource tree", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "portable");
    await mkdir(join(skill, "assets"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: portable\ndescription: Portable guidance\n---\n");
    await symlink(join(skill, "SKILL.md"), join(skill, "assets", "linked.md"));

    await expect(snapshotSkillBundle(join(skill, "SKILL.md"))).rejects.toThrow(/symlink/i);
  });

  it("rejects missing or mismatched portable frontmatter", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "portable");
    await mkdir(skill);
    await writeFile(join(skill, "SKILL.md"), "Body only");
    await expect(snapshotSkillBundle(join(skill, "SKILL.md"))).rejects.toThrow(/frontmatter/i);
    await writeFile(join(skill, "SKILL.md"), "---\nname: wrong\ndescription: Wrong name\n---\n");
    await expect(snapshotSkillBundle(join(skill, "SKILL.md"))).rejects.toThrow(/match/i);
  });

  it("rejects a symlinked SKILL.md entrypoint", async () => {
    const root = await makeTempDirectory();
    const realSkill = join(root, "real", "SKILL.md");
    const linkedSkill = join(root, "portable", "SKILL.md");
    await mkdir(join(root, "real"));
    await mkdir(join(root, "portable"));
    await writeFile(realSkill, "---\nname: portable\ndescription: Guidance\n---\n");
    await symlink(realSkill, linkedSkill);
    await expect(snapshotSkillBundle(linkedSkill)).rejects.toThrow(/must not be a symlink/i);
  });
});
