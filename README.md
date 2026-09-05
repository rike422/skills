# Skills

This repository is the canonical, agent-independent source for reusable Agent Skills and their behavioral regression tests. It also contains small, auditable tools for turning coding-agent evidence into candidates and measuring whether a Skill improves real workspace outcomes.

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
├── tools/agent-codify/        evidence classification and candidate authoring
├── tools/skeval/              evaluation-only CLI and framework tests
├── .agent-codify/             generated reports and untrusted candidates (ignored)
└── .skills-eval/              generated evaluation runs (ignored)
```

There is one canonical copy of every shared Skill under `skills/<name>/SKILL.md`. Do not add manually synchronized Claude/Codex/Cursor/OpenCode copies here.

## APM distribution

Each `skills/<name>/` directory is an independently installable APM Skill. The root `apm.yml` is the maintainer manifest for installing and validating every Skill from a source checkout against Claude, Cursor, and Codex. It currently declares:

- `design-contract-first`
- `godot-game-data-flow`

From this source checkout, preview or apply every declared Skill:

```bash
apm install --dry-run --target claude,cursor,codex
apm install --target claude,cursor,codex
```

Consumers should install the published Skill subdirectory they need:

```bash
apm install rike422/skills/skills/design-contract-first --target claude,cursor,codex
apm install rike422/skills/skills/godot-game-data-flow --target claude,cursor,codex
```

Install both at user scope with one command:

```bash
apm install --global --target claude,cursor,codex \
  rike422/skills/skills/design-contract-first \
  rike422/skills/skills/godot-game-data-flow
```

By default APM uses the shared `.agents/skills/` layout understood by supported clients; use `--legacy-skill-paths` only when a client requires its own legacy Skill directory. This repository remains the canonical source. Commit the root `apm.yml` and `apm.lock.yaml`, but do not commit generated target directories or `apm_modules/` here.

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
skeval compare rails --candidate path/to/candidate/rails/SKILL.md --agent claude

agent-codify analyze --generator-command /path/to/generator --from .episodes --project-root /path/to/repo
agent-codify analyze --generator-command /path/to/generator --shoka-query "repeated migration failures" --shoka-repository /path/to/repo
agent-codify draft --generator-command /path/to/generator --analysis .agent-codify/analysis/<run>/result.json --approval approval.json
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
    roles: [executor, judge]

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

## Codification workflow

`agent-codify` owns episode analysis, conservative codification classification,
human-approved Skill drafting, and independent critic review. For a bounded
Shoka period it verifies summary and metadata-only list results, then exports
the selected transcript-episode/v1 records one at a time. It does not refresh
the Shoka index or install its output.

```text
evidence
   ↓
agent-codify
   ├── tooling or project-rule recommendation
   ├── existing-Skill improvement candidate
   └── new Skill candidate
             ↓
          skeval
             ↓
      with/without evidence
```

The shared [`codify-session`](skills/codify-session/SKILL.md) Skill provides the natural-language entry point. A request such as “このセッションから再利用できる知識を抽出して、適切ならSkill候補を評価して” can coordinate the stages without merging their responsibilities.

The `analyze` result never contains or writes a Skill candidate. Only a human-approved cluster that passes the independent evidence and Skill gate can enter `draft`. Generated eval proposals are inert JSON and are never executed as command checks. Promotion, project-rule edits, and tooling changes remain explicit human actions.

`skeval` owns only validation and empirical evaluation:

```bash
skeval eval rails --candidate path/to/candidate/rails/SKILL.md
skeval compare rails --candidate path/to/candidate/rails/SKILL.md
```

`eval` measures the supplied candidate against the no-Skill branch. `compare` evaluates both the canonical Skill and candidate, writes a machine-readable comparison under `.skills-eval/<skill>/comparisons/`, and reports deterministic regressions. Candidate directories may contain portable `references/`, `scripts/`, and `assets/`. The production `SKILL.md` is never overwritten.

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
├── evidence.json
├── result.json
├── manifest.json
└── state/{running,completed,interrupted}.json
```

The run context records the Skill hash, fixed workspace identities, agent executable/version/model, checks, and effective configuration. `evidence.json` is the versioned handoff to `agent-codify`; it includes task prompts, rubrics, deterministic checks, and compact with/without outcomes. The manifest hashes the finalized run artifacts through `result.json`; `completed.json` is written afterward as an intentionally unhashed commit marker. Output is capped, and an oversized diff is an infrastructure error rather than a silently truncated score.

## Trust boundaries and current constraints

- Skill bundles include only `SKILL.md`, `references/**`, `scripts/**`, and `assets/**`; eval data is never injected.
- Symlinks are rejected in Skills, fixtures, and outcome snapshots.
- Fixture and Git sources are copied to disposable repositories. External Git inputs require both `trusted: true` in the case and the CLI's `--allow-external-workspaces` opt-in; they must be clean and cannot use submodules, LFS, or nested repositories in schema v1.
- Git metadata lives outside the agent-writable worktree. Evaluator-owned Git operations use the fixed metadata path and disable system/global config, hooks, fsmonitor, signing, interactive prompts, and implicit local object sharing.
- Agent executables are selected by built-in adapter type; a suite cannot substitute an arbitrary executable. Claude runs with safe mode, fail-closed sandboxing, fixed `Bash/Edit/Write` tools, no session persistence, no MCP servers, an environment allowlist, and no permission bypass. Judge roles have no tools.
- `agent-codify` invokes the explicitly selected generator command without a shell, stores episode inputs, catalog snapshots, prompts, raw responses, validation attempts, approvals, critic results, and candidates outside the canonical `skills/` tree. Shoka history mode invokes the local CLI without a shell, validates `transcript-episode/v1`, snapshots the returned episodes, and records the query and selected episode IDs in provenance.
- Command checks come only from local case YAML. Each runs on its own immutable outcome copy with an isolated `HOME`/`TMPDIR`, denied network, restricted writes, and a read allowlist for the workspace and system/toolchain paths.
- Command checks fail closed when the OS sandbox cannot be activated. The current implementation supports `sandbox-exec`; a bubblewrap backend is the next Linux portability step.
- Skills and repositories are still untrusted input. Case-defined command checks execute trusted local test code, so review them before running a third-party suite. Schema v1 does not impose workspace size quotas; avoid untrusted or unexpectedly large inputs.

## Roadmap

The stable v1 boundaries are suite/case schema, Skill bundle, pinned workspace, agent roles/adapters, outcome snapshot, checks, scoring, and result artifacts. Likely next steps are:

1. Codex and OpenCode adapters using the existing completed-prompt interfaces.
2. Linux bubblewrap command-check sandbox.
3. `--all-agents` coordination and cross-agent comparison reports.
4. Run budgets, JUnit export, and repeated-run confidence reporting after real usage establishes the needed semantics.
5. Optional container workspace backend for hostile fixtures.

This is intentionally not a plugin framework, hosted service, database, or general-purpose LLM evaluation platform.

## References

- [mizchi/skills (`tools/waxa`)](https://github.com/mizchi/skills/tree/main/tools/waxa)
- [microsoft/waza](https://github.com/microsoft/waza)
- [tardigrde/agent-skill-eval](https://github.com/tardigrde/agent-skill-eval)
- [UiPath/coder_eval](https://github.com/UiPath/coder_eval)
