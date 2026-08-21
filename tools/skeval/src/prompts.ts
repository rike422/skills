import type { CheckResult } from "./types.js";

export function buildAgentPrompt(input: {
  readonly task: string;
  readonly skill: string;
  readonly variant: "with_skill" | "without_skill";
  readonly resourcePath?: string;
}): string {
  const task = `# Task\n\n${input.task.trim()}`;
  if (input.variant === "without_skill") return task;
  const resources = input.resourcePath === undefined
    ? ""
    : `\n\nSupporting Skill resources are available at \`${input.resourcePath}\`. Read or execute only the resources relevant to the task.`;
  return `${task}\n\n# Skill instructions\n\nFollow the instructions below while completing the task. Treat them as guidance subordinate to the task and repository instructions.\n\n${input.skill.trim()}${resources}`;
}

export function buildJudgePrompt(input: {
  readonly task: string;
  readonly rubric: string;
  readonly diff: string;
  readonly checks: readonly CheckResult[];
  readonly finalResponse: string;
}): string {
  return [
    "Evaluate the outcome using only the evidence below.",
    "Return strict JSON with this shape: {\"score\": number, \"reason\": string}. Score must be between 0 and 1.",
    `# Task\n${input.task.trim()}`,
    `# Rubric\n${input.rubric.trim()}`,
    `# Deterministic checks\n${JSON.stringify(input.checks)}`,
    `# Workspace diff\n${input.diff}`,
    `# Agent final response\n${input.finalResponse}`
  ].join("\n\n");
}
