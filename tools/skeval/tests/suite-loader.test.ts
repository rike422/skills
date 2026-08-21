import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSuite } from "../src/suite/loader.js";
import { makeTempDirectory } from "./support.js";

describe("loadSuite", () => {
  it("normalizes suite paths from their documented bases", async () => {
    const root = await makeTempDirectory();
    const skill = join(root, "skills", "rails");
    await mkdir(join(skill, "evals", "cases"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: rails\ndescription: Rails guidance\n---\n");
    await writeFile(join(skill, "evals", "fixtures.txt"), "fixture");
    await writeFile(join(skill, "evals", "cases", "one.yaml"), `
schema_version: 1
id: one
prompt: Refactor this code.
workspace:
  fixture: ../fixtures.txt
checks:
  - type: file_contains
    path: result.txt
    contains: done
`);
    await writeFile(join(skill, "evals", "eval.yaml"), `
schema_version: 1
skill: ../SKILL.md
agents:
  claude:
    type: claude
    model: sonnet
defaults:
  trials: 2
  timeout_seconds: 60
  skill_delivery: prompt
cases:
  - cases/*.yaml
`);

    const suite = await loadSuite(join(skill, "evals", "eval.yaml"), "claude");

    expect(suite.skillPath).toBe(await realpath(join(skill, "SKILL.md")));
    expect(suite.cases[0]?.workspace).toEqual({
      type: "fixture",
      path: join(await realpath(skill), "evals", "fixtures.txt")
    });
    expect(suite.defaults.trials).toBe(2);
    expect(suite.selectedAgent.name).toBe("claude");
    expect(Object.isFrozen(suite)).toBe(true);
  });

  it("rejects cases with neither deterministic checks nor a judge", async () => {
    const root = await makeTempDirectory();
    await mkdir(join(root, "evals", "cases"), { recursive: true });
    await writeFile(join(root, "SKILL.md"), "skill");
    await writeFile(join(root, "evals", "cases", "invalid.yaml"), `
schema_version: 1
id: invalid
prompt: Do it.
workspace:
  fixture: .
`);
    await writeFile(join(root, "evals", "eval.yaml"), `
schema_version: 1
skill: ../SKILL.md
agents:
  claude: { type: claude }
cases: [cases/*.yaml]
`);

    await expect(loadSuite(join(root, "evals", "eval.yaml"), "claude"))
      .rejects.toThrow(/check.*judge/i);
  });

  it("rejects unknown agents and unsupported case globs", async () => {
    const root = await makeTempDirectory();
    await mkdir(join(root, "evals", "cases"), { recursive: true });
    await writeFile(join(root, "SKILL.md"), "skill");
    await writeFile(join(root, "evals", "cases", "one.yaml"), `
schema_version: 1
id: one
prompt: Do it.
workspace: { fixture: . }
checks: [{ type: file_exists, path: x }]
`);
    const suitePath = join(root, "evals", "eval.yaml");
    await writeFile(suitePath, `
schema_version: 1
skill: ../SKILL.md
agents: { claude: { type: claude } }
cases: [cases/**/nested.yaml]
`);
    await expect(loadSuite(suitePath, "missing")).rejects.toThrow(/unknown agent/i);
    await expect(loadSuite(suitePath, "claude")).rejects.toThrow(/unsupported case pattern/i);
  });

  it("rejects suite-controlled executables", async () => {
    const root = await makeTempDirectory();
    await mkdir(join(root, "evals", "cases"), { recursive: true });
    await writeFile(join(root, "SKILL.md"), "skill");
    await writeFile(join(root, "evals", "cases", "one.yaml"), `
schema_version: 1
id: one
prompt: Do it.
workspace: { fixture: . }
checks: [{ type: file_exists, path: x }]
`);
    const suitePath = join(root, "evals", "eval.yaml");
    await writeFile(suitePath, `
schema_version: 1
skill: ../SKILL.md
agents:
  claude: { type: claude, executable: ./malicious }
cases: [cases/*.yaml]
`);
    await expect(loadSuite(suitePath, "claude")).rejects.toThrow();
  });

  it("loads an explicitly trusted external Git workspace", async () => {
    const root = await makeTempDirectory();
    const repository = join(root, "repository");
    await mkdir(repository);
    await mkdir(join(root, "skill", "evals", "cases"), { recursive: true });
    await writeFile(join(root, "skill", "SKILL.md"), "skill");
    await writeFile(join(root, "skill", "evals", "cases", "git.yaml"), `
schema_version: 1
id: git-case
prompt: Do it.
workspace:
  git:
    path: ../../../repository
    ref: main
    trusted: true
checks: [{ type: file_exists, path: x }]
`);
    const suitePath = join(root, "skill", "evals", "eval.yaml");
    await writeFile(suitePath, `
schema_version: 1
skill: ../SKILL.md
agents: { claude: { type: claude } }
cases: [cases/git.yaml]
`);
    await expect(loadSuite(suitePath, "claude")).rejects.toThrow(/allow-external-workspaces/i);
    const suite = await loadSuite(suitePath, "claude", { allowExternalWorkspaces: true });
    expect(suite.cases[0]?.workspace).toEqual({ type: "git", path: await realpath(repository), ref: "main" });
  });
});
