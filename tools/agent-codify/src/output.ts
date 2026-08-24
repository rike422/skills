import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { z } from "zod";
import type { AnalysisResult, Approval, CatalogSnapshot, DraftBundle, EvidenceDocument, RunProvenance } from "./types.js";

const frontmatterSchema = z.object({ name: z.string(), description: z.string().min(1) }).passthrough();
const execFile = promisify(execFileCallback);

function timestamp(): string {
  return `${new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createRunDirectory(outputRoot: string, category: "analysis" | "draft"): Promise<string> {
  const parent = join(resolve(outputRoot), category);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const path = join(parent, timestamp());
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

export async function writeExclusive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeExclusive(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function validateCandidateSkill(content: string, expectedName: string): void {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (match?.[1] === undefined) throw new Error(`Candidate ${expectedName} requires YAML frontmatter`);
  const metadata = frontmatterSchema.parse(parse(match[1]));
  if (metadata.name !== expectedName) throw new Error(`Candidate Skill name ${metadata.name} must match ${expectedName}`);
}

export interface WrittenArtifacts {
  readonly directory: string;
  readonly reportPath: string;
  readonly candidatePaths: readonly string[];
}

export async function writeInputSnapshot(directory: string, evidence: readonly EvidenceDocument[], catalog: CatalogSnapshot, prompt: string): Promise<void> {
  for (const document of evidence) await writeJson(join(directory, "inputs", `${document.id}.json`), document.value);
  await writeJson(join(directory, "catalog.json"), catalog);
  await writeExclusive(join(directory, "effective-prompt.txt"), `${prompt.trimEnd()}\n`);
}

export async function writeEvalSnapshots(directory: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const content = await writeEvalSnapshotContent(path);
    await writeJson(join(directory, "eval-results", basename(path)), content);
  }
}

async function writeEvalSnapshotContent(path: string): Promise<{ readonly source: string; readonly sha256: string; readonly value: unknown }> {
  const content = await writeFileContent(path);
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error(`Eval result is not valid JSON: ${path}`); }
  return { source: resolve(path), sha256: sha256(content), value };
}

async function writeFileContent(path: string): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Eval result must not be a symlink: ${path}`);
  if (!info.isFile()) throw new Error(`Eval result must be a regular file: ${path}`);
  if (info.size > 8 * 1024 * 1024) throw new Error(`Eval result exceeds 8 MiB: ${path}`);
  return readFile(path, "utf8");
}

export async function writeAttempt(
  directory: string,
  phase: string,
  attempt: number,
  rawResponse: string,
  validation: { readonly ok: boolean; readonly error?: string }
): Promise<void> {
  await writeExclusive(join(directory, "attempts", `${phase}-${String(attempt).padStart(3, "0")}.raw.txt`), rawResponse);
  await writeJson(join(directory, "attempts", `${phase}-${String(attempt).padStart(3, "0")}.validation.json`), validation);
}

export async function writeFailure(directory: string, phase: string, error: unknown, retries: number): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "failure.json"), `${JSON.stringify({
    phase,
    retries,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export interface QuickValidationResult {
  readonly available: boolean;
  readonly passed: boolean;
  readonly output: string;
}

export async function runQuickValidate(candidatePath: string, scriptPath?: string): Promise<QuickValidationResult> {
  const candidates = scriptPath === undefined
    ? [
      process.env.CODEX_HOME === undefined ? "" : join(process.env.CODEX_HOME, "skills", ".system", "skill-creator", "scripts", "quick_validate.py"),
      join(homedir(), ".codex", "skills", ".system", "skill-creator", "scripts", "quick_validate.py")
    ]
    : [resolve(scriptPath)];
  const script = (await Promise.all(candidates.filter((path) => path !== "").map(async (path) => ({ path, info: await stat(path).catch(() => undefined) })))).find((entry) => entry.info?.isFile())?.path;
  if (script === undefined) return { available: false, passed: true, output: "quick_validate.py was not found" };
  try {
    const result = await execFile("python3", [script, dirname(candidatePath)], { encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 });
    return { available: true, passed: true, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${candidate.stdout ?? ""}${candidate.stderr ?? candidate.message ?? String(error)}`.trim();
    if (/ModuleNotFoundError: No module named ['"]yaml['"]/.test(output)) {
      return { available: false, passed: true, output: "quick_validate.py dependencies are unavailable" };
    }
    return { available: true, passed: false, output };
  }
}

function analysisReport(result: AnalysisResult): string {
  const clusters = result.clusters.length === 0
    ? "No problem clusters were supported by the evidence."
    : result.clusters.map((cluster, index) => [
      `${index + 1}. ${cluster.problem}`,
      `   meaning: ${cluster.meaning}`,
      `   destination: ${cluster.destination}`,
      `   evidence: raw=${cluster.evidence_counts.raw_occurrences}, sessions=${cluster.evidence_counts.sessions}, lineages=${cluster.evidence_counts.task_lineages}, projects=${cluster.evidence_counts.projects}, successful corrections=${cluster.evidence_counts.successful_corrections}`,
      `   Skill gate: ${cluster.skill_gate.eligible ? "eligible" : "not eligible"}`,
      `   recommendation: ${cluster.recommendation}`
    ].join("\n")).join("\n\n");
  return `# Analysis Report\n\n${result.summary}\n\n${clusters}\n`;
}

function draftReport(result: DraftBundle, approval: Approval): string {
  return `# Draft Report\n\nReviewer: ${approval.reviewer}\n\n${result.drafts.map((draft) => [
    `Cluster: ${draft.cluster_id}`,
    `Destination: ${draft.destination}`,
    `Critic: ${draft.critic.passed ? "passed" : "failed"}`,
    `Candidate: candidate/${draft.candidate.name}/SKILL.md`
  ].join("\n")).join("\n\n")}\n`;
}

export async function writeAnalysisArtifacts(
  directory: string,
  prompt: string,
  result: AnalysisResult,
  provenance: RunProvenance
): Promise<WrittenArtifacts> {
  await writeJson(join(directory, "result.json"), result);
  await writeJson(join(directory, "run.json"), provenance);
  const reportPath = join(directory, "report.md");
  await writeExclusive(reportPath, analysisReport(result));
  return Object.freeze({ directory, reportPath, candidatePaths: Object.freeze([]) });
}

async function copyPortableTree(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed in a Skill candidate resource: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: info.mode & 0o777 });
    for (const entry of (await readdir(source)).sort()) await copyPortableTree(join(source, entry), join(destination, entry));
    return;
  }
  if (!info.isFile()) throw new Error(`Unsupported Skill candidate resource: ${source}`);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(destination, info.mode & 0o777);
}

async function copyPortableResources(sourceSkillPath: string, candidateDirectory: string): Promise<void> {
  const sourceRoot = dirname(resolve(sourceSkillPath));
  for (const name of ["references", "scripts", "assets"] as const) {
    const source = join(sourceRoot, name);
    const info = await lstat(source).catch(() => undefined);
    if (info !== undefined) await copyPortableTree(source, join(candidateDirectory, name));
  }
}

export async function writeDraftArtifacts(
  directory: string,
  result: DraftBundle,
  approval: Approval,
  provenance: RunProvenance,
  sourceSkillPaths: readonly (string | undefined)[]
): Promise<WrittenArtifacts> {
  for (const draft of result.drafts) validateCandidateSkill(draft.candidate.skill_markdown, draft.candidate.name);
  await writeJson(join(directory, "result.json"), result);
  await writeJson(join(directory, "approval.json"), approval);
  await writeJson(join(directory, "critic.json"), result.drafts.map((draft) => draft.critic));
  await writeJson(join(directory, "run.json"), provenance);
  const candidatePaths: string[] = [];
  for (const [index, draft] of result.drafts.entries()) {
    const candidateDirectory = join(directory, "candidate", draft.candidate.name);
    const sourceSkillPath = sourceSkillPaths[index];
    if (sourceSkillPath !== undefined) await copyPortableResources(sourceSkillPath, candidateDirectory);
    const candidatePath = join(candidateDirectory, "SKILL.md");
    await writeExclusive(candidatePath, `${draft.candidate.skill_markdown.trimEnd()}\n`);
    await writeExclusive(join(candidateDirectory, "rationale.md"), `${draft.candidate.rationale.trimEnd()}\n`);
    await writeJson(join(candidateDirectory, "eval-proposals.json"), draft.candidate.eval_proposals);
    candidatePaths.push(candidatePath);
  }
  const reportPath = join(directory, "report.md");
  await writeExclusive(reportPath, draftReport(result, approval));
  return Object.freeze({ directory, reportPath, candidatePaths: Object.freeze(candidatePaths) });
}
