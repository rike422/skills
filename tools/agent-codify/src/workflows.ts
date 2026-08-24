import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadCatalog, loadEpisodeEvidence } from "./evidence.js";
import { createRunDirectory, runQuickValidate, sha256, writeAnalysisArtifacts, writeAttempt, writeDraftArtifacts, writeEvalSnapshots, writeFailure, writeInputSnapshot, writeJson, type WrittenArtifacts } from "./output.js";
import { buildAnalyzePrompt, buildCriticPrompt, buildDraftPrompt } from "./prompts.js";
import { assertApprovalMatchesAnalysis, parseApproval, selectedEvidence, validateAnalysisResult } from "./policy.js";
import { analysisResultSchema, catalogSnapshotSchema, criticResultSchema, draftBundleSchema, draftCandidateResultSchema, draftResultSchema, type AnalysisResult, type CatalogSnapshot, type DraftBundle, type DraftResult, type EvidenceDocument, type GenerationResult, type RunProvenance, type TextGenerator } from "./types.js";
import { loadShokaEpisodeList, loadShokaEvidence, type ShokaEpisodeListFilters, type ShokaSearchFilters } from "./shoka.js";

function parseGeneratedJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try { return JSON.parse(candidate); } catch { throw new Error("Generator response is not valid JSON"); }
}

interface SharedOptions {
  readonly generator: TextGenerator;
  readonly skillsRoots?: readonly string[];
  readonly agentsPaths?: readonly string[];
  readonly projectRoot?: string;
  readonly quickValidateScript?: string;
  readonly evalResultPaths?: readonly string[];
  readonly outputRoot?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly onPrompt?: (prompt: string) => void;
}

export interface WorkflowResult<T> {
  readonly prompt: string;
  readonly result: T;
  readonly artifacts: WrittenArtifacts;
}

function generationRequest(options: SharedOptions, prompt: string) {
  return {
    prompt,
    cwd: resolve(options.cwd ?? process.cwd()),
    timeoutMs: options.timeoutMs ?? 15 * 60 * 1000,
    ...(options.model === undefined ? {} : { model: options.model })
  };
}

function sanitizeMetadata(metadata: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "result")));
}

function provenance(
  options: SharedOptions,
  kind: "analysis" | "draft",
  startedAt: string,
  generated: GenerationResult,
  evidence: readonly EvidenceDocument[],
  catalog: CatalogSnapshot,
  retries: number,
  selection?: RunProvenance["selection"]
): RunProvenance {
  return Object.freeze({
    schemaVersion: 2,
    kind,
    startedAt,
    finishedAt: new Date().toISOString(),
    generator: Object.freeze({ type: options.generator.type, model: options.model ?? null, metadata: sanitizeMetadata(generated.metadata) }),
    evidence: Object.freeze(evidence.map((document) => Object.freeze({ id: document.id, source: document.source, sha256: document.sha256 }))),
    catalog: Object.freeze(catalog.entries.map((entry) => Object.freeze({ kind: entry.kind, name: entry.name, path: entry.path, sha256: entry.sha256 }))),
    retries,
    ...(selection === undefined ? {} : { selection: Object.freeze(selection) })
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function generateValidated<T>(
  options: SharedOptions,
  directory: string,
  phase: string,
  prompt: string,
  parser: (value: unknown) => T
): Promise<{ readonly value: T; readonly generated: GenerationResult; readonly retries: number }> {
  const maxAttempts = 2;
  let lastError: unknown = new Error("No generation attempt was made");
  let lastRaw = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const generated = await options.generator.generate(generationRequest(options, attempt === 1 ? prompt : `${prompt}\n\nPrevious attempt failed validation. Return only the required JSON shape.`));
      lastRaw = generated.text;
      const value = parser(parseGeneratedJson(generated.text));
      await writeAttempt(directory, phase, attempt, generated.text, { ok: true });
      return Object.freeze({ value, generated, retries: attempt - 1 });
    } catch (error) {
      lastError = error;
      const raw = lastRaw === "" ? (error !== null && typeof error === "object" && "rawResponse" in error && typeof error.rawResponse === "string" ? error.rawResponse : "") : lastRaw;
      await writeAttempt(directory, phase, attempt, raw, { ok: false, error: errorText(error) });
      if (attempt === maxAttempts) {
        await writeFailure(directory, phase, error, attempt - 1);
        throw error;
      }
    }
  }
  throw lastError;
}

async function loadCatalogFor(options: SharedOptions): Promise<CatalogSnapshot> {
  return loadCatalog({
    skillRoots: options.skillsRoots ?? [],
    agentsPaths: options.agentsPaths ?? [],
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot })
  });
}

async function prepareRun(
  options: SharedOptions,
  category: "analysis" | "draft",
  evidence: readonly EvidenceDocument[],
  catalog: CatalogSnapshot,
  prompt: string
): Promise<string> {
  const directory = await createRunDirectory(options.outputRoot ?? resolve(".agent-codify"), category);
  await writeInputSnapshot(directory, evidence, catalog, prompt);
  return directory;
}

async function runAnalyzeEvidence(
  options: SharedOptions & { readonly selection?: RunProvenance["selection"] },
  evidence: readonly EvidenceDocument[]
): Promise<WorkflowResult<AnalysisResult>> {
  const catalog = await loadCatalogFor(options);
  const prompt = buildAnalyzePrompt(evidence, catalog);
  options.onPrompt?.(prompt);
  const directory = await prepareRun(options, "analysis", evidence, catalog, prompt);
  const startedAt = new Date().toISOString();
  try {
    const generated = await generateValidated(options, directory, "analysis", prompt, (value) => validateAnalysisResult(value, evidence, catalog));
    const run = provenance(options, "analysis", startedAt, generated.generated, evidence, catalog, generated.retries, options.selection);
    const artifacts = await writeAnalysisArtifacts(directory, prompt, generated.value, run);
    return Object.freeze({ prompt, result: generated.value, artifacts });
  } catch (error) {
    await writeFailure(directory, "analysis", error, 1);
    throw error;
  }
}

export async function runAnalyze(
  options: SharedOptions & { readonly episodePaths: readonly string[]; readonly selection?: RunProvenance["selection"] }
): Promise<WorkflowResult<AnalysisResult>> {
  return runAnalyzeEvidence(options, await loadEpisodeEvidence(options.episodePaths));
}

export async function runShokaAnalyze(
  options: SharedOptions & {
    readonly query: string;
    readonly filters?: ShokaSearchFilters;
    readonly shokaExecutable?: string;
  }
): Promise<WorkflowResult<AnalysisResult>> {
  const selection = await loadShokaEvidence({
    query: options.query,
    ...(options.filters === undefined ? {} : { filters: options.filters }),
    ...(options.shokaExecutable === undefined ? {} : { executable: options.shokaExecutable })
  });
  const filters = Object.fromEntries(Object.entries(options.filters ?? {}).filter((entry): entry is [string, string | number] => entry[1] !== undefined));
  return runAnalyzeEvidence({
    ...options,
    selection: { type: selection.selectionType, query: options.query, filters, episodeIds: selection.episodeIds, complete: selection.complete }
  }, selection.documents);
}

export async function runShokaListAnalyze(
  options: SharedOptions & {
    readonly filters?: ShokaEpisodeListFilters;
    readonly shokaExecutable?: string;
  }
): Promise<WorkflowResult<AnalysisResult>> {
  const selection = await loadShokaEpisodeList({
    ...(options.filters === undefined ? {} : { filters: options.filters }),
    ...(options.shokaExecutable === undefined ? {} : { executable: options.shokaExecutable })
  });
  const filters = Object.fromEntries(Object.entries(options.filters ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return runAnalyzeEvidence({
    ...options,
    selection: { type: selection.selectionType, filters, episodeIds: selection.episodeIds, complete: selection.complete }
  }, selection.documents);
}

async function loadAnalysis(pathInput: string): Promise<{ readonly raw: string; readonly result: AnalysisResult; readonly directory: string }> {
  const raw = await readFile(resolve(pathInput), "utf8");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`Analysis result is not valid JSON: ${pathInput}`); }
  return { raw, result: analysisResultSchema.parse(value), directory: resolve(pathInput, "..") };
}

async function loadCatalogSnapshot(path: string): Promise<CatalogSnapshot> {
  const raw = await readFile(path, "utf8");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`Catalog snapshot is not valid JSON: ${path}`); }
  return catalogSnapshotSchema.parse(value);
}

export async function runDraft(
  options: SharedOptions & { readonly analysisPath: string; readonly approvalPath: string }
): Promise<WorkflowResult<DraftBundle>> {
  const analysis = await loadAnalysis(options.analysisPath);
  const approvalRaw = await readFile(resolve(options.approvalPath), "utf8");
  let approvalValue: unknown;
  try { approvalValue = JSON.parse(approvalRaw); } catch { throw new Error(`Approval is not valid JSON: ${options.approvalPath}`); }
  const approval = parseApproval(approvalValue);
  if (sha256(analysis.raw) !== approval.analysis_result_sha256) throw new Error("Approval does not match the analysis result hash");
  const evidence = await loadEpisodeEvidence([join(analysis.directory, "inputs")]);
  const catalog = await loadCatalogSnapshot(join(analysis.directory, "catalog.json"));
  const clusters = assertApprovalMatchesAnalysis(analysis.result, approval.approved_clusters.map((item) => item.cluster_id));
  const firstCluster = clusters[0];
  if (firstCluster === undefined) throw new Error("Approval did not select a cluster");
  const allEvidence = selectedEvidence(evidence, [...new Set(clusters.flatMap((cluster) => cluster.evidence_sources))]);
  const prompt = buildDraftPrompt(firstCluster, selectedEvidence(evidence, firstCluster.evidence_sources), catalog);
  options.onPrompt?.(prompt);
  const directory = await prepareRun(options, "draft", allEvidence, catalog, prompt);
  await writeJson(join(directory, "approval-input.json"), approval);
  await writeEvalSnapshots(directory, options.evalResultPaths ?? []);
  const startedAt = new Date().toISOString();
  try {
    const drafts: DraftResult[] = [];
    const sourceSkillPaths: (string | undefined)[] = [];
    let lastGenerated: GenerationResult | undefined;
    let totalRetries = 0;
    for (const cluster of clusters) {
      const clusterEvidence = selectedEvidence(evidence, cluster.evidence_sources);
      const clusterPrompt = buildDraftPrompt(cluster, clusterEvidence, catalog);
      await writeJson(join(directory, "prompts", `${cluster.id}.json`), { prompt: clusterPrompt });
      const generated = await generateValidated(options, directory, "draft-" + cluster.id, clusterPrompt, (value) => draftCandidateResultSchema.parse(value));
      if (generated.value.cluster_id !== cluster.id || generated.value.destination !== cluster.destination) throw new Error("Draft output does not match the approved cluster");
      const criticPrompt = buildCriticPrompt(generated.value.candidate, cluster, catalog);
      const critic = await generateValidated(options, directory, "critic-" + cluster.id, criticPrompt, (value) => criticResultSchema.parse(value));
      if (critic.value.candidate_name !== generated.value.candidate.name) throw new Error("Critic candidate name does not match draft candidate");
      drafts.push(draftResultSchema.parse({ ...generated.value, critic: critic.value }));
      sourceSkillPaths.push(cluster.destination === "ITERATE_EXISTING_SKILL" ? cluster.existing_owners.find((owner) => owner.kind === "skill")?.path : undefined);
      lastGenerated = critic.generated;
      totalRetries += generated.retries + critic.retries;
    }
    if (lastGenerated === undefined) throw new Error("No approved draft was generated");
    const result = draftBundleSchema.parse({ schema_version: 1, kind: "agent-codify-drafts", drafts });
    const run = provenance(options, "draft", startedAt, lastGenerated, allEvidence, catalog, totalRetries, undefined);
    const artifacts = await writeDraftArtifacts(directory, result, approval, run, sourceSkillPaths);
    const quickValidations = await Promise.all(artifacts.candidatePaths.map((path) => runQuickValidate(path, options.quickValidateScript)));
    await writeJson(join(directory, "quick-validate.json"), quickValidations);
    const failedValidation = quickValidations.find((validation) => !validation.passed);
    if (failedValidation !== undefined) throw new Error("quick_validate failed: " + failedValidation.output);
    return Object.freeze({ prompt, result, artifacts });
  } catch (error) {
    await writeFailure(directory, "draft", error, 1);
    throw error;
  }
}
