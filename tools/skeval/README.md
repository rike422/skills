# skeval

`skeval` validates and evaluates the effect of Agent Skills on real coding-agent workspace outcomes. It does not author or improve Skills.

```bash
skeval validate rails
skeval eval rails
skeval eval rails --candidate path/to/candidate/rails/SKILL.md
skeval compare rails --candidate path/to/candidate/rails/SKILL.md
```

See the repository [README](../../README.md) for schema, scoring, security, and usage. Candidate authoring belongs to [`agent-codify`](../agent-codify/README.md).

Framework tests live in `tests/`. Generic example fixtures live in `examples/`. Skill-specific evaluations belong beside their canonical Skill under `skills/<name>/evals/`.
