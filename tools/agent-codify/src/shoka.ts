import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  sessionEpisodeSchema,
  transcriptEpisodeAggregateSchema,
  transcriptEpisodeCandidateSchema,
  type EvidenceDocument,
  type TranscriptEpisodeAggregate,
  type TranscriptEpisodeCandidate
} from "./types.js";

const execFile = promisify(execFileCallback);
const maxSearchOutputBytes = 8 * 1024 * 1024;
const maxSearchEpisodes = 100;
const maxEpisodeBytes = 1024 * 1024;
const maxTotalBytes = 8 * 1024 * 1024;
const maxListCandidates = 500;

const searchResultsSchema = z.object({
  episodes: z.array(sessionEpisodeSchema).max(maxSearchEpisodes),
  summary: z.object({
    raw_events: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    task_lineages: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative()
  }).strict()
}).strict();

export type ShokaEpisodeCandidate = TranscriptEpisodeCandidate;
export type ShokaEpisodeAggregate = TranscriptEpisodeAggregate;

export interface ShokaSearchFilters {
  readonly agent?: "codex" | "claude" | "opencode" | "cursor" | "pi";
  readonly repository?: string;
  readonly file?: string;
  readonly eventType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly top?: number;
  readonly before?: number;
  readonly after?: number;
}

export interface ShokaEpisodeListFilters {
  readonly agent?: ShokaSearchFilters["agent"];
  readonly eventType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly before?: number;
  readonly after?: number;
}

export type ShokaSelectionType = "shoka-search" | "shoka-list";

export interface ShokaEvidenceSelection {
  readonly documents: readonly EvidenceDocument[];
  readonly episodeIds: readonly string[];
  readonly selectionType: ShokaSelectionType;
  readonly complete: boolean;
  readonly candidates: readonly ShokaEpisodeCandidate[];
  readonly summary?: ShokaEpisodeAggregate;
}

export interface LoadShokaEvidenceOptions {
  readonly query: string;
  readonly executable?: string;
  readonly filters?: ShokaSearchFilters;
  readonly timeoutMs?: number;
}

export interface LoadShokaEpisodeListOptions {
  readonly executable?: string;
  readonly filters?: ShokaEpisodeListFilters;
  readonly timeoutMs?: number;
}

const preservedEnvironmentNames = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
  "XDG_STATE_HOME", "SHOKA_STATE_DIR"
] as const;

function allowlistedEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of preservedEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

async function runShoka(executable: string, args: readonly string[], timeoutMs: number): Promise<string> {
  try {
    const result = await execFile(executable, [...args], {
      encoding: "utf8",
      env: allowlistedEnvironment(),
      timeout: timeoutMs,
      maxBuffer: maxSearchOutputBytes,
      windowsHide: true
    });
    return result.stdout;
  } catch (error) {
    if (error !== null && typeof error === "object") {
      const candidate = error as { code?: unknown; stderr?: unknown; message?: unknown };
      const detail = typeof candidate.stderr === "string" && candidate.stderr.trim() !== ""
        ? candidate.stderr.trim().slice(0, 16 * 1024)
        : typeof candidate.message === "string" ? candidate.message : String(error);
      const code = candidate.code === undefined ? "" : ` (${String(candidate.code)})`;
      throw new Error(`Shoka command failed${code}: ${detail}`);
    }
    throw new Error(`Shoka command failed: ${String(error)}`);
  }
}

function searchArguments(query: string, filters: ShokaSearchFilters): string[] {
  const args = ["transcript", "episode", "search", query];
  const values: readonly [string, string | number | undefined][] = [
    ["--agent", filters.agent], ["--repository", filters.repository], ["--file", filters.file],
    ["--event-type", filters.eventType], ["--from", filters.from], ["--to", filters.to], ["--top", filters.top],
    ["--before", filters.before ?? 3], ["--after", filters.after ?? 8]
  ];
  for (const [flag, value] of values) if (value !== undefined && value !== "") args.push(flag, String(value));
  args.push("--json");
  return args;
}

function listArguments(filters: ShokaEpisodeListFilters): string[] {
  const args = ["transcript", "episode", "list"];
  const values: readonly [string, string | undefined][] = [
    ["--agent", filters.agent], ["--event-type", filters.eventType], ["--from", filters.from], ["--to", filters.to]
  ];
  for (const [flag, value] of values) if (value !== undefined && value !== "") args.push(flag, value);
  args.push("--json");
  return args;
}

function summaryArguments(filters: ShokaEpisodeListFilters): string[] {
  const args = listArguments(filters);
  args[2] = "summary";
  return args;
}

function exportArguments(episodeId: string, output: string, filters: ShokaEpisodeListFilters): string[] {
  return [
    "transcript", "episode", "export", episodeId, "--output", output,
    "--before", String(filters.before ?? 3), "--after", String(filters.after ?? 8)
  ];
}

function parseTranscriptEpisodeResults(output: string): z.infer<typeof searchResultsSchema> {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error("Shoka transcript episode search returned malformed JSON"); }
  return searchResultsSchema.parse(value);
}

function parseTranscriptEpisodeList(output: string): ShokaEpisodeCandidate[] {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error("Shoka transcript episode list returned malformed JSON"); }
  return z.array(transcriptEpisodeCandidateSchema).parse(value);
}

function parseTranscriptEpisodeSummary(output: string): ShokaEpisodeAggregate {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error("Shoka transcript episode summary returned malformed JSON"); }
  return transcriptEpisodeAggregateSchema.parse(value);
}

function validateSearchFilters(filters: ShokaSearchFilters): void {
  if (filters.top !== undefined && (!Number.isInteger(filters.top) || filters.top <= 0 || filters.top > maxSearchEpisodes)) {
    throw new Error(`Shoka top must be an integer from 1 to ${maxSearchEpisodes}`);
  }
  for (const [name, value] of [["before", filters.before], ["after", filters.after]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`Shoka ${name} must be a non-negative integer`);
  }
}

function validateListFilters(filters: ShokaEpisodeListFilters): void {
  for (const [name, value] of [["from", filters.from], ["to", filters.to]] as const) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Shoka ${name} must be an ISO date (YYYY-MM-DD)`);
  }
  for (const [name, value] of [["before", filters.before], ["after", filters.after]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`Shoka ${name} must be a non-negative integer`);
  }
}

function toSelection(
  episodes: readonly z.infer<typeof sessionEpisodeSchema>[],
  selectionType: ShokaSelectionType,
  complete: boolean,
  candidates: readonly ShokaEpisodeCandidate[] = [],
  summary?: ShokaEpisodeAggregate
): ShokaEvidenceSelection {
  let totalBytes = 0;
  const documents = episodes.map((episode, index) => {
    const serialized = JSON.stringify(episode);
    const bytes = Buffer.byteLength(serialized);
    if (bytes > maxEpisodeBytes) throw new Error(`Shoka transcript episode exceeds ${maxEpisodeBytes} bytes for ${episode.episode_id}`);
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) throw new Error(`Shoka transcript episodes exceed ${maxTotalBytes} bytes in total`);
    return Object.freeze({
      id: `evidence-${String(index + 1).padStart(3, "0")}`,
      source: `shoka:${episode.episode_id}`,
      sha256: createHash("sha256").update(serialized).digest("hex"),
      value: episode
    });
  });
  return Object.freeze({
    documents: Object.freeze(documents),
    episodeIds: Object.freeze(episodes.map((episode) => episode.episode_id)),
    selectionType,
    complete,
    candidates: Object.freeze([...candidates]),
    ...(summary === undefined ? {} : { summary: Object.freeze(summary) })
  });
}

function uniqueCandidates(candidates: readonly ShokaEpisodeCandidate[]): ShokaEpisodeCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.episode_id, candidate])).values()];
}

function aggregateCandidates(candidates: readonly ShokaEpisodeCandidate[]): ShokaEpisodeAggregate {
  const byTrigger: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const sessions = new Set<string>();
  const lineages = new Set<string>();
  const projects = new Set<string>();
  for (const candidate of candidates) {
    sessions.add(candidate.transcript_id);
    if (candidate.task_lineage_id !== "") lineages.add(candidate.task_lineage_id);
    if (candidate.project_id !== "") projects.add(candidate.project_id);
    byTrigger[candidate.trigger.type] = (byTrigger[candidate.trigger.type] ?? 0) + 1;
    byStatus[candidate.task_status] = (byStatus[candidate.task_status] ?? 0) + 1;
  }
  return transcriptEpisodeAggregateSchema.parse({
    episodes: candidates.length,
    sessions: sessions.size,
    task_lineages: lineages.size,
    projects: projects.size,
    by_trigger: byTrigger,
    by_status: byStatus
  });
}

function equalCounts(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function assertSummaryMatchesCandidates(summary: ShokaEpisodeAggregate, candidates: readonly ShokaEpisodeCandidate[]): void {
  const actual = aggregateCandidates(candidates);
  if (
    summary.episodes !== actual.episodes || summary.sessions !== actual.sessions ||
    summary.task_lineages !== actual.task_lineages || summary.projects !== actual.projects ||
    !equalCounts(summary.by_trigger, actual.by_trigger) || !equalCounts(summary.by_status, actual.by_status)
  ) {
    throw new Error("Shoka episode summary does not match list metadata");
  }
}

async function exportCandidates(
  executable: string,
  candidates: readonly ShokaEpisodeCandidate[],
  filters: ShokaEpisodeListFilters,
  timeoutMs: number
): Promise<z.infer<typeof sessionEpisodeSchema>[]> {
  if (candidates.length === 0) return [];
  const directory = await mkdtemp(join(tmpdir(), "agent-codify-shoka-export-"));
  try {
    const episodes: z.infer<typeof sessionEpisodeSchema>[] = [];
    let totalBytes = 0;
    for (const [index, candidate] of candidates.entries()) {
      const output = join(directory, `${String(index + 1).padStart(4, "0")}.json`);
      await runShoka(executable, exportArguments(candidate.episode_id, output, filters), timeoutMs);
      const info = await lstat(output);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Shoka transcript episode export is not a regular file for ${candidate.episode_id}`);
      if (info.size > maxEpisodeBytes) throw new Error(`Shoka transcript episode exceeds ${maxEpisodeBytes} bytes for ${candidate.episode_id}`);
      totalBytes += info.size;
      if (totalBytes > maxTotalBytes) throw new Error(`Shoka transcript episodes exceed ${maxTotalBytes} bytes in total`);
      let value: unknown;
      try { value = JSON.parse(await readFile(output, "utf8")); } catch { throw new Error(`Shoka transcript episode export returned malformed JSON for ${candidate.episode_id}`); }
      const episode = sessionEpisodeSchema.parse(value);
      if (episode.episode_id !== candidate.episode_id) throw new Error(`Shoka export episode ID mismatch for ${candidate.episode_id}`);
      episodes.push(episode);
    }
    return episodes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function loadShokaEvidence(options: LoadShokaEvidenceOptions): Promise<ShokaEvidenceSelection> {
  const query = options.query.trim();
  if (query === "") throw new Error("Shoka query must not be empty");
  const filters = options.filters ?? {};
  validateSearchFilters(filters);
  const executable = options.executable ?? "shoka";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const result = parseTranscriptEpisodeResults(await runShoka(executable, searchArguments(query, filters), timeoutMs));
  if (result.episodes.length === 0) throw new Error("No Shoka transcript episodes matched the query");
  return toSelection(result.episodes, "shoka-search", false);
}

export async function loadShokaEpisodeList(options: LoadShokaEpisodeListOptions): Promise<ShokaEvidenceSelection> {
  const filters = options.filters ?? {};
  validateListFilters(filters);
  const executable = options.executable ?? "shoka";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const summary = parseTranscriptEpisodeSummary(await runShoka(executable, summaryArguments(filters), timeoutMs));
  if (summary.episodes > maxListCandidates) {
    throw new Error(`Shoka summary reported ${summary.episodes} episodes; maximum is ${maxListCandidates}. Narrow the date window or event type`);
  }
  const candidates = uniqueCandidates(parseTranscriptEpisodeList(await runShoka(executable, listArguments(filters), timeoutMs)));
  assertSummaryMatchesCandidates(summary, candidates);
  const episodes = await exportCandidates(executable, candidates, filters, timeoutMs);
  return toSelection(episodes, "shoka-list", true, candidates, summary);
}
