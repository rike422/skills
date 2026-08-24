import { z } from "zod";

export const instructionMeaningSchema = z.enum([
  "PERSONAL_PREFERENCE",
  "AUTHORIZATION_OR_SCOPE",
  "PROJECT_POLICY",
  "DOMAIN_KNOWLEDGE",
  "TECHNICAL_DECISION_RULE",
  "WORKFLOW_CORRECTION",
  "OUTPUT_PREFERENCE",
  "ONE_OFF_CONSTRAINT"
]);

export const destinationSchema = z.enum([
  "DETERMINISTIC_GUARD",
  "GLOBAL_INSTRUCTION",
  "PROJECT_RULE",
  "ITERATE_EXISTING_SKILL",
  "NEW_SKILL",
  "EVAL_PROBLEM",
  "ONE_OFF",
  "INSUFFICIENT_EVIDENCE"
]);

export const evidenceStrengthSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const sourceReferenceSchema = z.object({
  path: z.string(),
  hash: z.string(),
  line: z.number().int().nonnegative(),
  byte_offset: z.number().int().nonnegative(),
  state: z.string()
}).strict();

export const transcriptTriggerTypeSchema = z.enum([
  "user_correction", "error", "test_failure", "requirement_restatement", "scope_revision", "design_direction"
]);

const transcriptTriggerSchema = z.object({
  type: transcriptTriggerTypeSchema,
  event_id: z.number().int().positive(),
  timestamp: z.string().optional(),
  reason: z.string().optional()
}).strict();

const transcriptEvidenceSchema = z.object({
  event_id: z.number().int().positive(),
  event_type: z.string(),
  role: z.enum(["user", "assistant", "tool", "system"]),
  timestamp: z.string().optional(),
  text: z.string().optional(),
  command: z.string().optional(),
  diff: z.string().optional(),
  files: z.array(z.string()).optional(),
  exit_code: z.number().int().optional(),
  outcome: z.enum(["success", "failure", "unknown"]).optional(),
  content_hash: z.string().optional(),
  source: sourceReferenceSchema
}).strict();

const transcriptOutcomeSchema = z.object({
  event_id: z.number().int().positive(),
  type: z.string(),
  outcome: z.enum(["success", "failure", "unknown"]),
  text: z.string().optional(),
  source: sourceReferenceSchema
}).strict();

export const sessionEpisodeSchema = z.object({
  schema_version: z.literal("transcript-episode/v1"),
  episode_id: z.string().min(1),
  transcript_id: z.string().min(1),
  native_session_id: z.string().min(1),
  task_lineage_id: z.string().min(1),
  project_id: z.string().min(1),
  workspace_id: z.string().optional(),
  trigger: transcriptTriggerSchema,
  context_before: z.array(transcriptEvidenceSchema),
  corrections: z.array(transcriptEvidenceSchema),
  actions_after: z.array(transcriptEvidenceSchema),
  outcomes: z.array(transcriptOutcomeSchema),
  final_report: transcriptEvidenceSchema.optional(),
  additional_corrections: z.array(transcriptEvidenceSchema).optional(),
  task_status: z.enum(["complete", "failed", "unknown"]),
  source_event_ids: z.array(z.number().int().positive()),
  search_reasons: z.array(z.string()).optional(),
  omitted: z.object({
    events: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    context_before: z.number().int().nonnegative(),
    actions_after: z.number().int().nonnegative(),
    outcomes: z.number().int().nonnegative()
  }).strict()
}).strict();

export const transcriptEpisodeCandidateSchema = z.object({
  episode_id: z.string().min(1),
  transcript_id: z.string().min(1),
  native_session_id: z.string().min(1),
  task_lineage_id: z.string(),
  project_id: z.string(),
  workspace_id: z.string().optional(),
  trigger: z.object({
    type: transcriptTriggerTypeSchema,
    event_id: z.number().int().positive(),
    timestamp: z.string().optional(),
    reason: z.string().optional()
  }).strict(),
  task_status: z.enum(["complete", "failed", "unknown"])
}).strict();

export const transcriptEpisodeAggregateSchema = z.object({
  episodes: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  task_lineages: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  by_trigger: z.record(z.string(), z.number().int().nonnegative()),
  by_status: z.record(z.string(), z.number().int().nonnegative())
}).strict();

export const evalProposalSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(["positive", "holdout", "negative_control"]),
  prompt: z.string().min(1),
  rationale: z.string().min(1)
}).strict();

export const skillCandidateSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63),
  skill_markdown: z.string().min(1).max(256 * 1024),
  rationale: z.string().min(1),
  eval_proposals: z.array(evalProposalSchema).min(1)
}).strict();

export const evidenceCountsSchema = z.object({
  raw_occurrences: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  task_lineages: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  successful_corrections: z.number().int().nonnegative()
}).strict();

export const correctionEvidenceSchema = z.object({
  agent_decision_before: z.string().min(1),
  user_correction: z.string().min(1),
  requested_alternative: z.string().min(1),
  implementation_after: z.string().optional(),
  observed_result: z.string().optional(),
  task_lineage_ids: z.array(z.string().min(1)).min(1),
  success: z.boolean().nullable()
}).strict();

export const skillGateSchema = z.object({
  non_trivial_decision_rule: z.boolean(),
  multiple_task_lineages: z.boolean(),
  successful_correction_observed: z.boolean(),
  project_independent: z.boolean(),
  deterministic_controls_insufficient: z.boolean(),
  no_existing_owner_overlap: z.boolean(),
  trigger_is_explicit: z.boolean(),
  eligible: z.boolean()
}).strict();

export const catalogReferenceSchema = z.object({
  kind: z.enum(["skill", "agents", "design", "source", "test", "tooling"]),
  name: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().min(1).optional()
}).strict();

const analysisClusterSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  problem: z.string().min(1),
  meaning: instructionMeaningSchema,
  destination: destinationSchema,
  evidence_counts: evidenceCountsSchema,
  evidence_sources: z.array(z.string().min(1)).min(1),
  correction_evidence: z.array(correctionEvidenceSchema),
  observed_effects: z.array(z.string().min(1)),
  existing_owners: z.array(catalogReferenceSchema),
  deterministic_actions: z.array(z.string().min(1)),
  skill_gate: skillGateSchema,
  recommendation: z.string().min(1)
}).strict();

export const analysisResultSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("agent-codify-analysis"),
  summary: z.string().min(1),
  clusters: z.array(analysisClusterSchema)
}).strict();

export const approvalSchema = z.object({
  schema_version: z.literal(1),
  analysis_result_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  approved_clusters: z.array(z.object({
    cluster_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    notes: z.string().optional()
  }).strict()).min(1),
  reviewer: z.string().min(1),
  approved_at: z.string().min(1)
}).strict();

export const criticFindingSchema = z.object({
  check: z.enum([
    "NO_GENERIC_ADVICE",
    "NO_CASE_OVERGENERALIZATION",
    "DISTINCT_DESCRIPTION",
    "NARROW_RESPONSIBILITY",
    "AVAILABLE_REFERENCES_ONLY",
    "PROGRESSIVE_DISCLOSURE",
    "SCOPE_PRESERVED",
    "NO_EXISTING_OWNER_OVERLAP"
  ]),
  passed: z.boolean(),
  explanation: z.string().min(1)
}).strict();

export const criticResultSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("skill-creator-critic"),
  candidate_name: z.string().min(1),
  passed: z.boolean(),
  findings: z.array(criticFindingSchema).length(8)
}).strict();

export const draftCandidateResultSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("agent-codify-draft"),
  cluster_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  destination: z.enum(["NEW_SKILL", "ITERATE_EXISTING_SKILL"]),
  candidate: skillCandidateSchema
}).strict();

export const draftResultSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("agent-codify-draft"),
  cluster_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  destination: z.enum(["NEW_SKILL", "ITERATE_EXISTING_SKILL"]),
  candidate: skillCandidateSchema,
  critic: criticResultSchema
}).strict();

export const draftBundleSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal("agent-codify-drafts"),
  drafts: z.array(draftResultSchema).min(1)
}).strict();

export type InstructionMeaning = z.infer<typeof instructionMeaningSchema>;
export type Destination = z.infer<typeof destinationSchema>;
export type SessionEpisode = z.infer<typeof sessionEpisodeSchema>;
export type TranscriptEpisodeCandidate = z.infer<typeof transcriptEpisodeCandidateSchema>;
export type TranscriptEpisodeAggregate = z.infer<typeof transcriptEpisodeAggregateSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type AnalysisCluster = AnalysisResult["clusters"][number];
export type Approval = z.infer<typeof approvalSchema>;
export type CriticResult = z.infer<typeof criticResultSchema>;
export type DraftCandidateResult = z.infer<typeof draftCandidateResultSchema>;
export type DraftResult = z.infer<typeof draftResultSchema>;
export type DraftBundle = z.infer<typeof draftBundleSchema>;
export type SkillCandidate = z.infer<typeof skillCandidateSchema>;

export interface EvidenceDocument {
  readonly id: string;
  readonly source: string;
  readonly sha256: string;
  readonly value: unknown;
}

export interface CatalogEntry {
  readonly kind: "skill" | "agents" | "design" | "source" | "test" | "tooling";
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly content: string;
}

export interface CatalogSnapshot {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly entries: readonly CatalogEntry[];
}

export const catalogSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string().min(1),
  entries: z.array(z.object({
    kind: z.enum(["skill", "agents", "design", "source", "test", "tooling"]),
    name: z.string().min(1),
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    content: z.string()
  }).strict())
}).strict();

export interface GenerationRequest {
  readonly prompt: string;
  readonly cwd: string;
  readonly model?: string;
  readonly timeoutMs: number;
}

export interface GenerationResult {
  readonly text: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface TextGenerator {
  readonly type: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export interface RunProvenance {
  readonly schemaVersion: 2;
  readonly kind: "analysis" | "draft";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly generator: {
    readonly type: string;
    readonly model: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
  };
  readonly evidence: readonly {
    readonly id: string;
    readonly source: string;
    readonly sha256: string;
  }[];
  readonly catalog: readonly Pick<CatalogEntry, "kind" | "name" | "path" | "sha256">[];
  readonly selection?: {
    readonly type: "shoka-search" | "shoka-list";
    readonly query?: string;
    readonly filters: Readonly<Record<string, string | number>>;
    readonly episodeIds: readonly string[];
    readonly complete: boolean;
    readonly summary?: TranscriptEpisodeAggregate;
    readonly candidates?: readonly TranscriptEpisodeCandidate[];
  };
  readonly retries: number;
}
