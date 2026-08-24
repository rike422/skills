import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { sessionEpisodeSchema, type EvidenceDocument } from "./types.js";

const execFile = promisify(execFileCallback);
const maxSearchOutputBytes = 8 * 1024 * 1024;
const maxSearchEpisodes = 100;
const maxEpisodeBytes = 1024 * 1024;
const maxTotalBytes = 8 * 1024 * 1024;

const searchResultsSchema = z.object({
  episodes: z.array(sessionEpisodeSchema).max(maxSearchEpisodes),
  summary: z.object({
    raw_events: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    task_lineages: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative()
  }).strict()
}).strict();

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
}

export type ShokaSelectionType = "shoka-search" | "shoka-list";

export interface ShokaEvidenceSelection {
  readonly documents: readonly EvidenceDocument[];
  readonly episodeIds: readonly string[];
  readonly selectionType: ShokaSelectionType;
  readonly complete: boolean;
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

function parseTranscriptEpisodeResults(output: string): z.infer<typeof searchResultsSchema> {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error("Shoka transcript episode search returned malformed JSON"); }
  return searchResultsSchema.parse(value);
}

function parseTranscriptEpisodeList(output: string): z.infer<typeof sessionEpisodeSchema>[] {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error("Shoka transcript episode list returned malformed JSON"); }
  return z.array(sessionEpisodeSchema).parse(value);
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
}

function toSelection(episodes: readonly z.infer<typeof sessionEpisodeSchema>[], selectionType: ShokaSelectionType, complete: boolean): ShokaEvidenceSelection {
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
    complete
  });
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
  const episodes = parseTranscriptEpisodeList(await runShoka(executable, listArguments(filters), timeoutMs));
  return toSelection(episodes, "shoka-list", true);
}
