import { z } from "zod";

const agentSchema = z.object({
  type: z.string().min(1),
  model: z.string().min(1).optional(),
  roles: z.array(z.enum(["executor", "judge"])).default(["executor", "judge"])
}).strict();

export const suiteSchema = z.object({
  schema_version: z.literal(1),
  skill: z.string().min(1),
  agents: z.record(z.string().min(1), agentSchema).refine((agents) => Object.keys(agents).length > 0, "At least one agent is required"),
  defaults: z.object({
    trials: z.number().int().positive().default(1),
    timeout_seconds: z.number().int().positive().default(900),
    skill_delivery: z.literal("prompt").default("prompt")
  }).strict().default({ trials: 1, timeout_seconds: 900, skill_delivery: "prompt" }),
  cases: z.array(z.string().min(1)).min(1)
}).strict();

const workspaceSchema = z.union([
  z.object({ fixture: z.string().min(1) }).strict(),
  z.object({
    git: z.object({
      path: z.string().min(1),
      ref: z.string().min(1).default("HEAD"),
      trusted: z.literal(true)
    }).strict()
  }).strict()
]);

const checkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file_exists"), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal("file_not_exists"), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal("file_contains"), path: z.string().min(1), contains: z.string() }).strict(),
  z.object({ type: z.literal("file_changed"), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal("file_not_changed"), path: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("command"),
    command: z.array(z.string()).min(1),
    timeout_seconds: z.number().int().positive().optional()
  }).strict()
]);

export const caseSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  tags: z.array(z.string().min(1)).default([]),
  prompt: z.string().min(1),
  workspace: workspaceSchema,
  checks: z.array(checkSchema).default([]),
  judge: z.object({ agent: z.string().min(1), rubric: z.string().min(1) }).strict().optional()
}).strict().superRefine((value, context) => {
  if (value.checks.length === 0 && value.judge === undefined) {
    context.addIssue({ code: "custom", message: "A case requires at least one check or a judge" });
  }
});

export type RawSuite = z.infer<typeof suiteSchema>;
export type RawCase = z.infer<typeof caseSchema>;
