import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { sessionEpisodeSchema, type CatalogEntry, type CatalogSnapshot, type EvidenceDocument, type SessionEpisode } from "./types.js";

const maxInputFileBytes = 8 * 1024 * 1024;
const maxInputFiles = 200;
const maxTotalBytes = 16 * 1024 * 1024;
const maxCatalogFileBytes = 256 * 1024;
const maxCatalogTotalBytes = 4 * 1024 * 1024;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readSized(path: string, limit: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
  if (info.size > limit) throw new Error(`Input exceeds ${limit} bytes: ${path}`);
  return readFile(path, "utf8");
}

async function collectJsonFiles(input: string, files: string[]): Promise<void> {
  const path = resolve(input);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Symlinked input is not allowed: ${path}`);
  if (info.isFile()) {
    files.push(path);
    return;
  }
  if (!info.isDirectory()) throw new Error(`Unsupported input: ${path}`);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collectJsonFiles(child, files);
    else if (entry.isFile() && extname(entry.name) === ".json") files.push(child);
  }
}

export async function loadEpisodeEvidence(inputs: readonly string[]): Promise<EvidenceDocument[]> {
  const paths: string[] = [];
  for (const input of inputs) await collectJsonFiles(input, paths);
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length === 0) throw new Error("No JSON episode files found");
  if (uniquePaths.length > maxInputFiles) throw new Error(`Episode input exceeds ${maxInputFiles} files`);
  let totalBytes = 0;
  const documents: EvidenceDocument[] = [];
  for (const [index, path] of uniquePaths.entries()) {
    const content = await readSized(path, maxInputFileBytes);
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > maxTotalBytes) throw new Error(`Episode input exceeds ${maxTotalBytes} bytes in total`);
    let value: unknown;
    try { value = JSON.parse(content); } catch { throw new Error(`Episode is not valid JSON: ${path}`); }
    const episode = sessionEpisodeSchema.parse(value);
    const serialized = JSON.stringify(episode);
    documents.push(Object.freeze({
      id: `evidence-${String(index + 1).padStart(3, "0")}`,
      source: await realpath(path),
      sha256: sha256(serialized),
      value: episode
    }));
  }
  return documents;
}

export interface CatalogOptions {
  readonly skillRoots?: readonly string[];
  readonly agentsPaths?: readonly string[];
  readonly projectRoot?: string;
}

async function collectSkillEntries(rootInput: string): Promise<CatalogEntry[]> {
  const root = resolve(rootInput);
  const rootInfo = await stat(root).catch(() => undefined);
  if (rootInfo === undefined) return [];
  if (!rootInfo.isDirectory()) throw new Error(`Skill root is not a directory: ${root}`);
  const entries: CatalogEntry[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(root, entry.name, "SKILL.md");
    const info = await lstat(path).catch(() => undefined);
    if (info === undefined) continue;
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Canonical Skill must be a regular file: ${path}`);
    const content = await readSized(path, maxCatalogFileBytes);
    entries.push({ kind: "skill", name: entry.name, path: await realpath(path), sha256: sha256(content), content });
  }
  return entries;
}

async function collectFileEntry(pathInput: string, kind: CatalogEntry["kind"], name: string): Promise<CatalogEntry | undefined> {
  const path = resolve(pathInput);
  const info = await lstat(path).catch(() => undefined);
  if (info === undefined) return undefined;
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Catalog file must be a regular file: ${path}`);
  const content = await readSized(path, maxCatalogFileBytes);
  return { kind, name, path: await realpath(path), sha256: sha256(content), content };
}

async function collectProjectEntries(rootInput: string): Promise<CatalogEntry[]> {
  const root = resolve(rootInput);
  const files: string[] = [];
  async function walk(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      const name = basename(path).toLowerCase();
      const extension = extname(path).toLowerCase();
      if (
        name === "package.json" || name === "tsconfig.json" || name === "makefile" || name === "agents.md" || name.startsWith("eslint.config") ||
        name.startsWith("vitest.config") || name.includes("schema") || name.includes("types") ||
        name.includes("design") || name.includes("architecture") || extension === ".test" || extension === ".spec" ||
        path.includes("/tests/") || path.includes("/test/") || path.includes("/docs/")
      ) files.push(path);
      return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      await walk(join(path, entry.name));
    }
  }
  await walk(root);
  const entries: CatalogEntry[] = [];
  for (const path of files.sort().slice(0, maxInputFiles)) {
    const content = await readSized(path, maxCatalogFileBytes);
    const lowerName = basename(path).toLowerCase();
    const kind: CatalogEntry["kind"] = lowerName === "agents.md"
      ? "agents"
      : path.includes("/tests/") || path.includes("/test/") || path.includes(".test.") || path.includes(".spec.") || extname(path) === ".test" || extname(path) === ".spec"
      ? "test"
      : lowerName.includes("design") || lowerName.includes("architecture")
        ? "design"
        : ["package.json", "tsconfig.json", "makefile"].includes(lowerName) || lowerName.startsWith("eslint.config") || lowerName.startsWith("vitest.config")
          ? "tooling"
          : "source";
    entries.push({ kind, name: path.slice(root.length + 1), path: await realpath(path), sha256: sha256(content), content });
  }
  return entries;
}

export async function loadCatalog(options: CatalogOptions = {}): Promise<CatalogSnapshot> {
  const entries: CatalogEntry[] = [];
  for (const root of options.skillRoots ?? []) entries.push(...await collectSkillEntries(root));
  for (const path of options.agentsPaths ?? []) {
    const entry = await collectFileEntry(path, "agents", basename(path));
    if (entry !== undefined) entries.push(entry);
  }
  if (options.projectRoot !== undefined) entries.push(...await collectProjectEntries(options.projectRoot));
  const unique = new Map<string, CatalogEntry>();
  for (const entry of entries) unique.set(`${entry.kind}:${entry.path}`, entry);
  const sorted = [...unique.values()].sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`));
  let total = 0;
  for (const entry of sorted) {
    total += Buffer.byteLength(entry.content);
    if (total > maxCatalogTotalBytes) throw new Error(`Catalog exceeds ${maxCatalogTotalBytes} bytes in total`);
  }
  return Object.freeze({ schemaVersion: 1, createdAt: new Date().toISOString(), entries: Object.freeze(sorted) });
}

export function episodeFromEvidence(document: EvidenceDocument): SessionEpisode {
  return sessionEpisodeSchema.parse(document.value);
}
