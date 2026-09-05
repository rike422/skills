---
name: apm-skill-distribution
description: Maintain and distribute the portable Skills in this repository through Agent Package Manager (APM). Use when adding or removing a Skill from the root APM manifest, updating its lockfile or installation docs, validating Claude/Cursor/Codex deployment, preparing an APM distribution commit, or troubleshooting version-dependent APM commands in this repository.
---

# APM Skill Distribution

Treat this repository as the canonical source and its root `apm.yml` as a maintainer manifest. Each publishable package is an independent directory at `skills/<name>/` containing `SKILL.md`; consumers install that GitHub subdirectory rather than the repository root.

## Establish the Current Contract

1. Read the repository `AGENTS.md`, root `apm.yml`, `apm.lock.yaml`, README distribution section, and the target Skill metadata.
2. Inspect `git status --short` before changing anything. Preserve unrelated work.
3. Run `apm --version` and the relevant command's `--help`. APM evolves quickly; installed CLI behavior and current official documentation override remembered syntax and third-party examples.
4. Read [repository-contract.md](references/repository-contract.md) before changing membership, paths, or consumer instructions.

Do not assume that every directory under `skills/` is ready to publish. A managed Skill must have a reviewed `SKILL.md`, be tracked by Git, and be intentionally listed in the maintainer manifest.

## Update Distribution Membership

When adding a Skill:

1. Validate the Skill itself before registering it.
2. Add exactly one relative local dependency, `./skills/<name>`, to `dependencies.apm` in the root `apm.yml`.
3. Preserve the existing targets and unrelated dependencies.
4. Update the README's published-Skill list and public install examples with `rike422/skills/skills/<name>`.
5. Regenerate the root lockfile with the target set verified from the installed CLI.

When removing or renaming a Skill, update the manifest, lockfile, and documentation together. Do not delete the Skill unless deletion is explicitly in scope.

The maintainer and consumer forms are intentionally different:

```text
source checkout: ./skills/<name>
public consumer: rike422/skills/skills/<name>
```

Do not add the root repository as a dependency of itself. Do not use `apm pack` as the publication mechanism for these source subdirectories.

## Validate Safely

Follow [validation-and-release.md](references/validation-and-release.md). At minimum:

1. Validate every changed Skill with this repository's `skeval validate` command.
2. Regenerate and inspect `apm.lock.yaml`.
3. Run a root-manifest dry run for `claude,cursor,codex`.
4. For deployment proof, install the individual local Skill directories from a separate temporary consumer working directory and inspect the deployed files.
5. Confirm the source worktree contains no generated target directories or unexpected manifest edits.

Never run a positional `apm install <package> --root <temp>` from the source repository as an isolation shortcut. `--root` redirects deployment outputs, but package additions and local-path resolution still use the current source directory and can mutate its `apm.yml`.

## Respect Mutation Boundaries

- Project-scope validation is allowed when requested; user-scope `--global` installation changes external state and requires explicit authorization.
- A remote subdirectory is installable only after its commit is pushed. Do not claim unpublished work is available from GitHub.
- Keep `.agents/`, `.claude/`, `.codex/`, `.cursor/`, `apm_modules/`, and pack artifacts out of the source commit unless the repository explicitly tracks one of them.
- Do not invent licensing metadata. If the repository has no license declaration, report the resulting `NOASSERTION` warning rather than concealing it.
- Do not push without an explicit instruction.

## Prepare a Scoped Commit

Stage only the reviewed Skill, root manifest, lockfile, and documentation paths. Never use broad staging in a dirty worktree. Inspect the staged diff, run whitespace and secret/absolute-home-path checks, and report unrelated dirty paths after committing.

Follow the repository convention: an English conventional prefix such as `feat:` or `chore:`, with a Japanese commit body when a body is useful. A prior instruction to edit or validate does not itself authorize a commit.

## Report the Result

State:

- which Skills are now managed;
- which validation commands passed;
- whether public GitHub installation is available yet or still requires push;
- whether any generated files or unrelated dirty changes remain;
- the commit hash, only if a commit was explicitly authorized and created.
