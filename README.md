# Skills

This repository is the canonical, agent-independent source for reusable Agent Skills and their behavioral regression tests. It also contains `skeval`, an auditable CLI for measuring whether a Skill improves a coding agent on real workspace tasks.

It deliberately does not install files into a home directory. Dotfiles or chezmoi should clone this repository and expose the canonical Skills to Claude Code, Codex, Cursor, OpenCode, or other agents.

## Repository layout

```text
skills/
├── skills/                    canonical portable Skills
│   └── <skill>/
│       ├── SKILL.md
│       ├── references/        optional portable resources
│       ├── scripts/           optional portable resources
│       ├── assets/            optional portable resources
│       └── evals/
│           ├── eval.yaml      evaluation suite
│           ├── cases/*.yaml   behavioral test cases
│           └── fixtures/**    test workspaces
├── agent-specific/            only genuinely non-portable additions
├── tools/skeval/              evaluation CLI and framework tests
└── .skills-eval/              generated runs and candidates (ignored)
```

There is one canonical copy of every shared Skill under `skills/<name>/SKILL.md`. Do not add manually synchronized Claude/Codex/Cursor/OpenCode copies here.

## Evals are tests

`skills/<name>/evals` contains behavioral and regression tests for that Skill. A case asks a real coding agent to modify an isolated workspace, then grades the resulting repository with deterministic checks and, when necessary, a branch-blinded LLM judge.

`tools/skeval/tests`, by contrast, tests the evaluator implementation itself. Keeping the two levels separate allows a Skill and its regression suite to evolve together without mixing product behavior with framework fixtures.

## Setup

Requirements:

- Node.js 22 or newer;
- Git;
- Claude Code for live evaluations;
- macOS `sandbox-exec` for command checks in v0.1.

```bash
npm install
npm run build
node tools/skeval/dist/cli.js validate tools/skeval/examples/skills/example-guidance --agent claude
```

After package linking or installation, use `skeval` directly:

```bash
skeval validate rails --agent claude
skeval eval rails --agent claude --show-prompts
skeval iterate rails --agent claude
```

A target can be an `eval.yaml` path, a Skill directory, or a name under `./skills`.

## Suite schema v1

`evals/eval.yaml` owns suite-wide configuration:

```yaml
schema_version: 1
skill: ../SKILL.md

agents:
  claude:
    type: claude
    model: sonnet
    roles: [executor, judge, improver]

defaults:
  trials: 2
  timeout_seconds: 900
  skill_delivery: prompt

cases:
  - cases/*.yaml
```

Agents are a named registry rather than one hard-coded executor. v0.1 implements only `type: claude`; the schema and adapter boundary allow later `codex` and `opencode` implementations without changing case data.

Case files own one task:

```yaml
schema_version: 1
id: refactor-controller
tags: [rails, refactoring, japanese]

workspace:
  fixture: ../fixtures/fat-controller
  # Or:
  # git:
  #   path: ../../../../../some-project
  #   ref: main
  #   trusted: true # also requires --allow-external-workspaces when outside the suite

prompt: |
  このControllerを、既存の振る舞いを変えずに整理してください。

checks:
  - type: command
    command: [bundle, exec, rspec]
    timeout_seconds: 180
  - type: file_exists
    path: app/services/order_processor.rb
  - type: file_not_exists
    path: tmp/debug.log
  - type: file_contains
    path: app/services/order_processor.rb
    contains: "class OrderProcessor"
  - type: file_changed
    path: app/controllers/orders_controller.rb
  - type: file_not_changed
    path: config/routes.rb

judge:
  agent: claude
  rubric: |
    Evaluate whether the change improves maintainability while preserving
    behavior and avoiding unnecessary abstractions.
```

Path bases are fixed:

- `skill` and `cases` are relative to `eval.yaml`;
- fixture and Git paths are relative to the case YAML;
- file-check paths are relative to the evaluated workspace.

A case must have at least one deterministic check or a judge. Unknown keys are rejected so misspelled configuration cannot silently change an experiment.

## Evaluation model

For every case and trial, `skeval` creates two independent clones from one pinned baseline OID:

```text
pinned baseline
├── without_skill -> agent -> immutable outcome -> checks -> judge
└── with_skill    -> agent -> immutable outcome -> checks -> judge
```

The framework-owned prompt text lives only in `src/prompts.ts`. The adapter receives the completed prompt and cannot discover or inject the Skill itself. `--show-prompts` prints every effective executor and judge prompt; the same text is always stored in run artifacts.

The judge sees the task, rubric, deterministic results, diff, and final response. It does not see the Skill text or the `with_skill` / `without_skill` label.

### Scoring

- deterministic score `D` is passed checks divided by total checks;
- when a judge is the only grader, `D = 1`;
- judge score `J` is in `[0, 1]`;
- trial score is `D * J`, or `D` without a judge;
- infrastructure failures are `null`, never zero;
- trial, case, and suite scores are arithmetic means of valid children;
- trial deltas use only trial pairs where both branches are valid;
- case and suite delta are means of valid paired deltas, while branch averages remain separately visible.

Error counts remain separate from scores so an unavailable agent cannot look like a bad Skill.

## Iteration

`skeval iterate` evaluates the current Skill, sends weak-case evidence to a no-tools improver role, writes a candidate, and evaluates that candidate against the same suite.

```text
.skills-eval/<skill>/candidates/
├── iteration-001.md
└── iteration-001.json
```

The production `SKILL.md` is never overwritten. Promotion is an explicit review and copy/edit operation outside `skeval`.

## Audit artifacts

Each run is namespaced and create-only:

```text
.skills-eval/<skill>/runs/<run-id>/
├── run-context.json
├── cases/<case>/trial-001/{without_skill,with_skill}/
│   ├── agent/prompt.txt
│   ├── agent/process.json
│   ├── agent/stdout.log
│   ├── agent/stderr.log
│   ├── diff.patch
│   ├── snapshot.json
│   └── checks.json
├── result.json
├── manifest.json
└── state/{running,completed,interrupted}.json
```

The run context records the Skill hash, fixed workspace identities, agent executable/version/model, checks, and effective configuration. The manifest hashes the finalized run artifacts through `result.json`; `completed.json` is written afterward as an intentionally unhashed commit marker. Output is capped, and an oversized diff is an infrastructure error rather than a silently truncated score.

## Trust boundaries and current constraints

- Skill bundles include only `SKILL.md`, `references/**`, `scripts/**`, and `assets/**`; eval data is never injected.
- Symlinks are rejected in Skills, fixtures, and outcome snapshots.
- Fixture and Git sources are copied to disposable repositories. External Git inputs require both `trusted: true` in the case and the CLI's `--allow-external-workspaces` opt-in; they must be clean and cannot use submodules, LFS, or nested repositories in schema v1.
- Git metadata lives outside the agent-writable worktree. Evaluator-owned Git operations use the fixed metadata path and disable system/global config, hooks, fsmonitor, signing, interactive prompts, and implicit local object sharing.
- Agent executables are selected by built-in adapter type; a suite cannot substitute an arbitrary executable. Claude runs with safe mode, fail-closed sandboxing, fixed `Bash/Edit/Write` tools, no session persistence, no MCP servers, an environment allowlist, and no permission bypass. Judge and improver roles have no tools.
- Command checks come only from local case YAML. Each runs on its own immutable outcome copy with an isolated `HOME`/`TMPDIR`, denied network, restricted writes, and a read allowlist for the workspace and system/toolchain paths.
- Command checks fail closed when the OS sandbox cannot be activated. The current implementation supports `sandbox-exec`; a bubblewrap backend is the next Linux portability step.
- Skills and repositories are still untrusted input. Case-defined command checks execute trusted local test code, so review them before running a third-party suite. Schema v1 does not impose workspace size quotas; avoid untrusted or unexpectedly large inputs.

## Roadmap

The stable v1 boundaries are suite/case schema, Skill bundle, pinned workspace, agent roles/adapters, outcome snapshot, checks, scoring, and result artifacts. Likely next steps are:

1. Codex and OpenCode adapters using the existing completed-prompt interface.
2. Linux bubblewrap command-check sandbox.
3. `--all-agents` coordination and cross-agent comparison reports.
4. Run budgets, JUnit export, and repeated-run confidence reporting after real usage establishes the needed semantics.
5. Optional container workspace backend for hostile fixtures.

This is intentionally not a plugin framework, hosted service, database, or general-purpose LLM evaluation platform.

## Reference influence

The layout combines two useful patterns without copying their APIs:

- mizchi's `waxa`: lightweight suite/case organization, with/without comparison, and evidence-driven iteration;
- `agent-skill-eval`: real coding-agent harnesses, repository-state assertions, negative controls, repeated runs, and explicit run metadata;
- Microsoft's Waza and UiPath `coder_eval`: colocated behavioral fixtures and ordinary test/lint/build tools as external graders.

All executor, injection, and judge prompts were reimplemented locally so the final input remains inspectable.
