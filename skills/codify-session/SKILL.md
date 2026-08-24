---
name: codify-session
description: Analyze bounded coding-agent episode windows, including periodic reviews, by extracting user judgments, separating independent evidence, and routing approved findings to the safest codification destination. Use for evidence-based session codification, not ordinary Skill authoring.
---

# Codify Session

Keep the responsibilities separate:

- Shoka lists episode metadata, summarizes deterministic counts, and exports one detailed episode at a time.
- agent-codify assigns meaning, clusters equivalent judgments, counts independent evidence, checks existing owners, and recommends a destination.
- A human approves clusters before `draft` creates an untrusted candidate.
- skill-creator reviews the approved candidate; skeval evaluates only a reviewed eval suite.

## Review a bounded period

For a weekly review, use explicit dates so the run is reproducible. Omit
`--shoka-event-type` to include every observable trigger in the window:

    agent-codify analyze --generator-command <executable> --shoka-list \
      --shoka-from <YYYY-MM-DD> --shoka-to <YYYY-MM-DD> \
      --shoka <shoka-executable> --skills <skill-root> --agents <AGENTS.md> --project-root <project>

Run `shoka session sync` first only when collection has been authorized. Analysis
never syncs implicitly. Without explicit dates, Shoka selects its previous
seven-day window; prefer explicit dates for scheduled or compared runs.

The queryless flow is deterministic:

1. call `transcript episode summary` and reject more than 500 candidates;
2. call the metadata-only `transcript episode list` and deduplicate by `episode_id`;
3. verify list counts against the summary;
4. call `transcript episode export` for every selected ID;
5. analyze only the exported `transcript-episode/v1` documents.

Do not silently sample when the candidate limit or 8 MiB evidence budget is
exceeded. Narrow the date window or event type and keep each resulting run as a
separate audited population. Use `--shoka-before` and `--shoka-after` only to
bound exported context; they do not change candidate selection.

Use `--shoka-query` only as a supplementary relevance search. Do not treat search results as a complete population or mix them into independent evidence counts without marking them as supplementary. Use episode files with `--from` when an exact, already materialized input is required.

The canonical analysis input is the exported `transcript-episode/v1`, not list
metadata. Preserve stable transcript, native session, task lineage, project,
trigger, source event, and omission metadata. An empty list is valid evidence
of no matching episodes and should produce an insufficient-evidence result,
not a fabricated candidate.

## Extract judgments, not wording

Treat user corrections as first-class evidence. For every judgment unit, record:

- the agent decision before the correction;
- what the user rejected or corrected;
- the alternative policy or decision requested by the user;
- the implementation change after the correction;
- the observable result, including `unknown` when it is not recorded;
- source episode/event IDs, session, task lineage, and project IDs.

Split compound messages into separate units. For example, authorization to choose the migration order is distinct from a technical rule about the canonical design. Classify each unit as one of:

`PERSONAL_PREFERENCE`, `AUTHORIZATION_OR_SCOPE`, `PROJECT_POLICY`, `DOMAIN_KNOWLEDGE`, `TECHNICAL_DECISION_RULE`, `WORKFLOW_CORRECTION`, `OUTPUT_PREFERENCE`, `ONE_OFF_CONSTRAINT`.

Cluster by normalized decision meaning, not literal similarity. Equivalent statements about replacing a legacy path, refusing a compatibility adapter, and selecting one canonical path may belong to one cluster when their scope and exceptions match. Keep contradictory rules, different scopes, and conditional exceptions separate. Do not infer hidden chain-of-thought or an implementation/result that the episode does not expose.

## Count independent evidence

Every cluster must expose these counts separately:

    {
      "raw_occurrences": 8,
      "sessions": 6,
      "task_lineages": 2,
      "projects": 1,
      "successful_corrections": 2
    }

Also record repeated occurrences within one lineage, unknown outcomes, and contradictory evidence when relevant. Worktrees, retries, or multiple sessions from one task lineage are recurrence data, not independent task evidence. A correction is successful only when an observable post-correction result supports that claim; an instruction or intended implementation alone is not success evidence.

## Check existing owners and destination

Before proposing a Skill, inspect the catalog of:

- repository, user-installed, and system Skills;
- global and project `AGENTS.md`;
- relevant design documents;
- existing types, tests, lint rules, static checks, and CLI validation.

If a catalog source is missing or points at the wrong project, report the catalog gap instead of concluding that no owner exists. Prefer updating an existing Skill, AGENTS rule, project rule, type, test, lint rule, or CLI guard.

Classify the safest destination:

- `DETERMINISTIC_GUARD`: propose concrete types, tests, lint/static checks, or CLI validation;
- `GLOBAL_INSTRUCTION`: durable user-wide behavior;
- `PROJECT_RULE`: repository- or domain-specific policy;
- `ITERATE_EXISTING_SKILL`: an existing Skill owns the responsibility;
- `NEW_SKILL`: a portable, non-trivial decision rule that passes every gate;
- `EVAL_PROBLEM`: repair the evaluation or fixture;
- `ONE_OFF`: local authorization, preference, or constraint;
- `INSUFFICIENT_EVIDENCE`: do not codify yet.

Do not turn a personal preference, authorization boundary, one-off constraint, or project-specific concept into a portable Skill.

## New Skill gate

Use `NEW_SKILL` only when all conditions hold:

- the decision rule is non-trivial and its trigger is explicit;
- it recurs across multiple independent task lineages and projects;
- at least one correction has an observed successful result;
- it is not dependent on project-specific vocabulary;
- types, tests, lint, CLI checks, and project rules are insufficient;
- no existing Skill or instruction owner overlaps its responsibility.

Otherwise recommend the more local destination or `INSUFFICIENT_EVIDENCE`. In particular, repeated corrections from one lineage or one project do not satisfy the new-Skill gate.

## Separate analyze, approval, and draft

`analyze` produces judgment records, semantic clusters, evidence counts, existing-owner findings, destination recommendations, and gate status. It never writes a Skill.

For periodic improvement, stop after `analyze` by default and review
`report.md`, `result.json`, and `selection.json`. A recurring schedule does not
authorize drafting or modifying a Skill.

After a human reviews the exact analysis result, create approval metadata bound to its hash and run `draft`. `draft` may create only an untrusted candidate for an approved `NEW_SKILL` or `ITERATE_EXISTING_SKILL` cluster. It must not install, promote, overwrite, or expand authority.

Run an independent skill-creator review against the candidate. Check that it adds no generic advice, does not universalize a personal case, has a short distinctive description, has narrow responsibility, references only available tools and Skills, separates details into references appropriately, preserves user scope, and should not be merged into an existing owner. `quick_validate` is syntax validation only; it is not a semantic quality gate. Materialize and review eval proposals before running skeval.

## Audit every outcome

For successful and failed runs, retain the input episodes, Shoka summary,
candidate metadata, list/search filters and selection type, catalog snapshot,
effective prompt, raw generator output, schema validation results, retry
history, analysis result, human-approved clusters, candidate, critic findings,
and eval results. Mark whether the final artifact is a recommendation,
hypothesis, unvalidated candidate, evaluated candidate, or rejected result.
