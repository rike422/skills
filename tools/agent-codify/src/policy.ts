import { episodeFromEvidence } from "./evidence.js";
import { analysisResultSchema, approvalSchema, type AnalysisCluster, type CatalogSnapshot, type Destination, type EvidenceDocument, type InstructionMeaning } from "./types.js";

export const destinationOrder: readonly Destination[] = [
  "DETERMINISTIC_GUARD",
  "PROJECT_RULE",
  "GLOBAL_INSTRUCTION",
  "ITERATE_EXISTING_SKILL",
  "NEW_SKILL",
  "EVAL_PROBLEM",
  "ONE_OFF",
  "INSUFFICIENT_EVIDENCE"
];

export const meaningToDestinationGuidance: Readonly<Record<InstructionMeaning, string>> = {
  PERSONAL_PREFERENCE: "Prefer GLOBAL_INSTRUCTION only when the preference is intentionally global; otherwise ONE_OFF.",
  AUTHORIZATION_OR_SCOPE: "Keep as ONE_OFF or explicit approval/scope policy; never widen authority through a Skill.",
  PROJECT_POLICY: "Prefer PROJECT_RULE, with a deterministic guard when a checker can enforce it.",
  DOMAIN_KNOWLEDGE: "Prefer PROJECT_RULE for project terms; use NEW_SKILL only when the knowledge is portable across projects.",
  TECHNICAL_DECISION_RULE: "Prefer DETERMINISTIC_GUARD when enforceable; otherwise consider an existing or new portable Skill.",
  WORKFLOW_CORRECTION: "Prefer an existing Skill or a NEW_SKILL only after independent repeated successful corrections.",
  OUTPUT_PREFERENCE: "Prefer GLOBAL_INSTRUCTION only for a durable global output contract; otherwise ONE_OFF.",
  ONE_OFF_CONSTRAINT: "Keep as ONE_OFF unless independent evidence proves a reusable rule."
};

export function selectedEvidence(documents: readonly EvidenceDocument[], sourceIds: readonly string[]): EvidenceDocument[] {
  const allowed = new Map(documents.map((document) => [document.id, document]));
  const selected = sourceIds.map((source) => {
    const document = allowed.get(source);
    if (document === undefined) throw new Error(`Unknown evidence source: ${source}`);
    return document;
  });
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Analysis cluster contains duplicate evidence sources");
  return selected;
}

export function evidenceCounts(documents: readonly EvidenceDocument[]) {
  const episodes = documents.map(episodeFromEvidence);
  const correctionCount = (episode: ReturnType<typeof episodeFromEvidence>): number =>
    episode.corrections.length + (episode.additional_corrections?.length ?? 0);
  const rawOccurrences = episodes.reduce((total, episode) => total + Math.max(1, correctionCount(episode)), 0);
  const successfulCorrections = episodes.reduce((total, episode) => {
    const corrections = correctionCount(episode);
    const successObserved = episode.task_status === "complete" || episode.outcomes.some((outcome) => outcome.outcome === "success");
    return total + (successObserved ? corrections : 0);
  }, 0);
  return {
    raw_occurrences: rawOccurrences,
    sessions: new Set(episodes.map((episode) => episode.native_session_id)).size,
    task_lineages: new Set(episodes.map((episode) => episode.task_lineage_id)).size,
    projects: new Set(episodes.map((episode) => episode.project_id)).size,
    successful_corrections: successfulCorrections
  };
}

export function validateAnalysisResult(
  result: unknown,
  documents: readonly EvidenceDocument[],
  catalog: CatalogSnapshot
): ReturnType<typeof analysisResultSchema.parse> {
  const parsed = analysisResultSchema.parse(result);
  const catalogPaths = new Set(catalog.entries.map((entry) => entry.path));
  for (const cluster of parsed.clusters) {
    const selected = selectedEvidence(documents, cluster.evidence_sources);
    const expected = evidenceCounts(selected);
    if (JSON.stringify(cluster.evidence_counts) !== JSON.stringify(expected)) {
      throw new Error(`Cluster ${cluster.id} evidence_counts do not match independent episode evidence`);
    }
    for (const owner of cluster.existing_owners) {
      if (!catalogPaths.has(owner.path)) throw new Error(`Cluster ${cluster.id} references an unknown catalog owner: ${owner.path}`);
    }
    const lineageIds = new Set(selected.map((document) => episodeFromEvidence(document).task_lineage_id));
    for (const correction of cluster.correction_evidence) {
      for (const lineageId of correction.task_lineage_ids) {
        if (!lineageIds.has(lineageId)) throw new Error(`Cluster ${cluster.id} correction references an unknown task lineage: ${lineageId}`);
      }
    }
    if (cluster.destination === "NEW_SKILL" && !cluster.skill_gate.eligible) {
      throw new Error(`Cluster ${cluster.id} is classified NEW_SKILL without an eligible Skill gate`);
    }
    if (cluster.destination !== "NEW_SKILL" && cluster.skill_gate.eligible) {
      throw new Error(`Cluster ${cluster.id} cannot claim a Skill gate for destination ${cluster.destination}`);
    }
    if (cluster.destination === "NEW_SKILL") validateNewSkillGate(cluster);
  }
  return parsed;
}

function validateNewSkillGate(cluster: AnalysisCluster): void {
  const gate = cluster.skill_gate;
  const counts = cluster.evidence_counts;
  if (counts.task_lineages < 2) throw new Error(`Cluster ${cluster.id} needs at least two task lineages for NEW_SKILL`);
  if (counts.projects < 2) throw new Error(`Cluster ${cluster.id} needs at least two projects for NEW_SKILL`);
  if (counts.successful_corrections < 1) throw new Error(`Cluster ${cluster.id} needs a successful correction for NEW_SKILL`);
  if (cluster.existing_owners.length > 0) throw new Error(`Cluster ${cluster.id} overlaps an existing catalog owner`);
  const required = [
    ["non_trivial_decision_rule", gate.non_trivial_decision_rule],
    ["multiple_task_lineages", gate.multiple_task_lineages],
    ["successful_correction_observed", gate.successful_correction_observed],
    ["project_independent", gate.project_independent],
    ["deterministic_controls_insufficient", gate.deterministic_controls_insufficient],
    ["no_existing_owner_overlap", gate.no_existing_owner_overlap],
    ["trigger_is_explicit", gate.trigger_is_explicit]
  ] as const;
  const failed = required.filter(([, value]) => !value).map(([name]) => name);
  if (failed.length > 0) throw new Error(`Cluster ${cluster.id} failed Skill gate: ${failed.join(", ")}`);
}

export function assertDraftableCluster(cluster: AnalysisCluster): void {
  if (cluster.destination !== "NEW_SKILL" && cluster.destination !== "ITERATE_EXISTING_SKILL") {
    throw new Error(`Cluster ${cluster.id} destination ${cluster.destination} cannot produce a Skill draft`);
  }
  if (cluster.destination === "NEW_SKILL") validateNewSkillGate(cluster);
  if (cluster.destination === "ITERATE_EXISTING_SKILL" && cluster.existing_owners.length === 0) {
    throw new Error(`Cluster ${cluster.id} requires an existing owner for ITERATE_EXISTING_SKILL`);
  }
}

export function assertApprovalMatchesAnalysis(analysis: ReturnType<typeof analysisResultSchema.parse>, approvedIds: readonly string[]): AnalysisCluster[] {
  const clusters = approvedIds.map((id) => {
    const cluster = analysis.clusters.find((candidate) => candidate.id === id);
    if (cluster === undefined) throw new Error(`Approval references unknown cluster: ${id}`);
    assertDraftableCluster(cluster);
    return cluster;
  });
  if (new Set(approvedIds).size !== approvedIds.length) throw new Error("Approval contains duplicate cluster ids");
  return clusters;
}

export function parseApproval(value: unknown) {
  return approvalSchema.parse(value);
}
