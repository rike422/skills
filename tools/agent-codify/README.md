# agent-codify

agent-codify analyzes session episodes and turns only human-approved, independently supported clusters into untrusted Skill candidates. Analysis and candidate generation are separate commands.

## Analyze

From Shoka-compatible episode files:

    agent-codify analyze --generator-command /path/to/generator --from .episodes --skills ./skills --agents ./AGENTS.md --project-root .

From the Shoka session index:

    agent-codify analyze --generator-command /path/to/generator --shoka-list --shoka-event-type design_direction --shoka-from 2026-08-01 --shoka-to 2026-08-22 --shoka /path/to/shoka

For a complete episode population, prefer the queryless list endpoint. Use one invocation per event type when needed and deduplicate by episode_id before semantic analysis.

For a supplementary relevance search:

    agent-codify analyze --generator-command /path/to/generator --shoka-query "repeated design corrections" --shoka-repository /path/to/project

analyze stores the input episodes, selection type and filters, catalog snapshot, effective prompt, raw generator responses, validation attempts, analysis result, and report under .agent-codify/analysis/. It never writes SKILL.md. An empty list is a valid no-evidence result; search remains query-based and is not a completeness guarantee.

The canonical input is Shoka's transcript-episode/v1. Each episode must identify its transcript, native session, task lineage, project, trigger, and traceable correction/result events.

## Human approval and draft

Read result.json and create an approval file. Its analysis_result_sha256 must be the SHA-256 of the exact result.json bytes:

    {
      "schema_version": 1,
      "analysis_result_sha256": "...",
      "approved_clusters": [{ "cluster_id": "cluster-id", "notes": "Reviewed" }],
      "reviewer": "human",
      "approved_at": "2026-08-23T00:00:00Z"
    }

Then run:

    agent-codify draft --generator-command /path/to/generator --analysis .agent-codify/analysis/<run>/result.json --approval approval.json

draft only accepts NEW_SKILL or ITERATE_EXISTING_SKILL clusters that pass the deterministic gate. It writes an untrusted candidate under .agent-codify/draft/. It never installs or overwrites a canonical Skill.

draft runs an independent skill-creator critic. quick_validate is used only as a syntax check; it does not determine semantic quality. When its Python dependency is unavailable, the artifact records that it was skipped.

## Catalog

Use --skills repeatedly for repository, user, or system Skill roots, --agents for AGENTS.md files, and --project-root to collect focused design, type, test, and tooling files. Existing owners are preferred over new Skills. The generator command must be selected explicitly; authentication and model selection remain the responsibility of that external command.

The generator receives the effective prompt on stdin and may return either plain text or a JSON envelope such as `{"result":"...","metadata":{}}`. agent-codify invokes it without a shell and records its raw response.

## Evaluation

eval-proposals.json is inert. Review and materialize proposals as a trusted eval suite before invoking skeval. Keep the agent-codify artifact directory with the eval result so the decision remains auditable.
