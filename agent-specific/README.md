# Agent-specific Skills

Use this tree only when behavior cannot be expressed as a portable shared Skill:

```text
agent-specific/
├── claude/
├── codex/
├── cursor/
└── opencode/
```

Do not fork every shared Skill per agent. Prefer a small additive Skill and document why portability is impossible.
