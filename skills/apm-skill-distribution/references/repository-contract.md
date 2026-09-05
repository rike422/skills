# Repository Distribution Contract

## Canonical Layout

The canonical portable source is `skills/<name>/SKILL.md`. Optional `references/`, `scripts/`, and `assets/` remain inside that directory. Evaluation material belongs under `evals/` and tests behavior; it is not deployed as Skill prompt content.

The root `apm.yml` is for maintainers working from a clone. Its local dependencies are repository-relative:

```yaml
targets:
  - claude
  - cursor
  - codex
dependencies:
  apm:
    - ./skills/example-skill
```

Preserve dependency order unless there is a reason to change it. Prefer a stable alphabetical list when inserting a new entry.

## Public Package Identity

GitHub consumers address an individual directory using APM's virtual subdirectory syntax:

```bash
apm install rike422/skills/skills/example-skill --target claude,cursor,codex
```

This differs from the maintainer-only local dependency `./skills/example-skill`. Document project-scope installation first. Offer `--global` only as an explicit user-scope alternative:

```bash
apm install --global --target claude,cursor,codex \
  rike422/skills/skills/example-skill
```

A public command refers to the remote Git repository. It does not become usable merely because files exist in a local commit; the commit must be pushed to the referenced repository first.

## Membership Checklist

Register a Skill only when all are true:

- `skills/<name>/SKILL.md` exists and its frontmatter matches the directory;
- the Skill has been reviewed and validated;
- all files needed at runtime use portable relative references;
- the directory is tracked or will be included in the same authorized commit;
- README public commands name the same subdirectory;
- the root lockfile is regenerated after manifest changes.

Do not automatically enumerate every folder. Drafts, deleted Skills, untracked experiments, and tool-only directories are not distribution members without an explicit decision.

## Current APM 0.29 Baseline

Always verify locally, but the known 0.29-era contract is:

- use `apm update`, not deprecated `apm install --update`;
- use `apm install --frozen`, not `--frozen-lockfile`;
- comma-separate multiple targets in one `--target` value;
- shared `.agents/skills/` is the default cross-client deployment path;
- `--legacy-skill-paths` requests per-client legacy directories;
- `--root` redirects outputs but does not turn the target into the command's source working directory.

If installed help differs, adapt the commands and document the observed version. Use third-party workflows, including `mizchi/skills/tooling/apm-usage`, as design references only; never let them override current CLI evidence or official APM documentation.

## Publication Boundary

This repository publishes Skills through committed Git subdirectories. It does not need a packed aggregate plugin for that workflow. Root relative dependencies are useful for local maintenance but are development-local inputs and are unsuitable as public bundle dependencies.

Avoid `apm pack` during routine distribution maintenance. Besides being unnecessary, pack commands can create source-tree artifacts such as `.claude-plugin/plugin.json`, and a bundle with unresolved local dependencies is not a portable release.
