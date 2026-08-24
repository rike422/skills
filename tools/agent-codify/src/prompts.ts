import type { AnalysisCluster, CatalogSnapshot, EvidenceDocument, SkillCandidate } from "./types.js";
import { destinationOrder, meaningToDestinationGuidance } from "./policy.js";

function catalogText(catalog: CatalogSnapshot): string {
  if (catalog.entries.length === 0) return "No catalog entries were supplied.";
  return catalog.entries.map((entry) => `## ${entry.kind}: ${entry.name}\nPath: ${entry.path}\nSHA-256: ${entry.sha256}\n\n${entry.content}`).join("\n\n");
}

function episodeText(evidence: readonly EvidenceDocument[]): string {
  return JSON.stringify(evidence, null, 2);
}

const meaningText = `PERSONAL_PREFERENCE | AUTHORIZATION_OR_SCOPE | PROJECT_POLICY | DOMAIN_KNOWLEDGE |
TECHNICAL_DECISION_RULE | WORKFLOW_CORRECTION | OUTPUT_PREFERENCE | ONE_OFF_CONSTRAINT`;

const destinationText = destinationOrder.join(" | ");

const gateText = `NEW_SKILL is eligible only when all seven booleans are true:
non_trivial_decision_rule, multiple_task_lineages, successful_correction_observed,
project_independent, deterministic_controls_insufficient, no_existing_owner_overlap,
trigger_is_explicit. A single task lineage is not independent evidence.`;

export function buildAnalyzePrompt(evidence: readonly EvidenceDocument[], catalog: CatalogSnapshot): string {
  const guidance = Object.entries(meaningToDestinationGuidance).map(([meaning, destination]) => `- ${meaning}: ${destination}`).join("\n");
  return `# Objective
Analyze coding-agent episodes and produce problem clusters plus their safest codification destination. Do not write or propose a SKILL.md. User corrections are primary evidence: extract the changed decision, not merely the wording of the instruction.

# Meaning classifications
${meaningText}

# Destination order
${destinationText}

# Decision guidance
${guidance}

# Evidence rules
- Extract agent_decision_before, user_correction, requested_alternative, implementation_after, and observed_result whenever observable.
- If the post-correction result is unknown, set correction success to null and do not call it a successful pattern.
- Count raw occurrences, distinct sessions, distinct task_lineages, distinct projects, and successful corrections separately.
- Use exact evidence ids. Do not invent evidence or hidden reasoning.
- Prefer deterministic guards, project rules, and existing owners over new Skills.

# Skill gate
${gateText}

# Output
Return only JSON with this exact shape and no markdown fence:
{"schema_version":1,"kind":"agent-codify-analysis","summary":"...","clusters":[{"id":"kebab-case","problem":"...","meaning":"${meaningText.replaceAll("\n", " ")}","destination":"${destinationText}","evidence_counts":{"raw_occurrences":0,"sessions":0,"task_lineages":0,"projects":0,"successful_corrections":0},"evidence_sources":["evidence-001"],"correction_evidence":[{"agent_decision_before":"...","user_correction":"...","requested_alternative":"...","implementation_after":"optional","observed_result":"optional","task_lineage_ids":["..."],"success":null}],"observed_effects":[],"existing_owners":[],"deterministic_actions":[],"skill_gate":{"non_trivial_decision_rule":false,"multiple_task_lineages":false,"successful_correction_observed":false,"project_independent":false,"deterministic_controls_insufficient":false,"no_existing_owner_overlap":false,"trigger_is_explicit":false,"eligible":false},"recommendation":"..."}]}

# Catalog snapshot
${catalogText(catalog)}

# Episode evidence
${episodeText(evidence)}`;
}

export function buildDraftPrompt(cluster: AnalysisCluster, evidence: readonly EvidenceDocument[], catalog: CatalogSnapshot): string {
  return `# Objective
Create one untrusted Skill candidate for the human-approved analysis cluster below. Do not install, overwrite, or promote a canonical Skill. Preserve scope and do not add generic advice.

# Candidate rules
- Keep one narrow, coherent responsibility.
- Generalize beyond project names, file names, fixtures, and exact assertions.
- Use concise, distinctive YAML frontmatter with name and description.
- Put substantial conditional detail in references only when the candidate actually needs it.
- Eval proposals are inert hypotheses; do not include shell commands.

# Approved cluster
${JSON.stringify(cluster, null, 2)}

# Output
Return only JSON with this exact shape and no markdown fence:
{"schema_version":1,"kind":"agent-codify-draft","cluster_id":"${cluster.id}","destination":"${cluster.destination}","candidate":{"name":"kebab-case","skill_markdown":"complete SKILL.md","rationale":"...","eval_proposals":[{"id":"kebab-case","kind":"positive|holdout|negative_control","prompt":"...","rationale":"..."}]}}

# Relevant catalog
${catalogText(catalog)}

# Evidence
${episodeText(evidence)}`;
}

export function buildCriticPrompt(candidate: SkillCandidate, cluster: AnalysisCluster, catalog: CatalogSnapshot): string {
  return `# Objective
Independently review the Skill candidate using the skill-creator quality standard. Do not rewrite it and do not assume the draft rationale is correct. Check the artifact itself and the available catalog.

# Required checks
NO_GENERIC_ADVICE, NO_CASE_OVERGENERALIZATION, DISTINCT_DESCRIPTION, NARROW_RESPONSIBILITY,
AVAILABLE_REFERENCES_ONLY, PROGRESSIVE_DISCLOSURE, SCOPE_PRESERVED, NO_EXISTING_OWNER_OVERLAP

# Output
Return exactly eight findings, one for each required check, as JSON with no markdown fence:
{"schema_version":1,"kind":"skill-creator-critic","candidate_name":"${candidate.name}","passed":false,"findings":[{"check":"NO_GENERIC_ADVICE","passed":false,"explanation":"..."}]}

# Candidate
${candidate.skill_markdown}

# Cluster
${JSON.stringify(cluster, null, 2)}

# Catalog
${catalogText(catalog)}`;
}
