# Shared Skills

Create one canonical, portable Skill per directory:

```text
skills/<name>/
├── SKILL.md
├── references/     optional
├── scripts/        optional
├── assets/         optional
└── evals/
    ├── eval.yaml
    ├── cases/*.yaml
    └── fixtures/**
```

Write shared Skill instructions in English when practical. Evaluation prompts may be Japanese, English, or mixed to represent real use. Keep agent-specific commands and filesystem locations out of shared Skills.
