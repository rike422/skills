import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { caseSchema, suiteSchema, type RawCase } from "./schema.js";
import type { AgentDefinition, CaseDefinition, CheckDefinition, SuiteDefinition, WorkspaceDefinition } from "../types.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function resolveFrom(base: string, path: string): string {
  return resolve(base, path);
}

function isContained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function expandPattern(base: string, pattern: string): Promise<string[]> {
  const absolutePattern = resolveFrom(base, pattern);
  if (!absolutePattern.includes("*")) return [absolutePattern];
  const directory = dirname(absolutePattern);
  const name = basename(absolutePattern);
  if (name !== "*.yaml" && name !== "*.yml") {
    throw new Error(`Unsupported case pattern: ${pattern}. Only *.yaml and *.yml are supported.`);
  }
  const suffix = name.slice(1);
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(suffix))
    .sort()
    .map((entry) => join(directory, entry));
}

async function normalizeWorkspace(
  raw: RawCase["workspace"],
  caseDirectory: string,
  suiteDirectory: string,
  allowExternalWorkspaces: boolean
): Promise<WorkspaceDefinition> {
  if ("fixture" in raw) {
    const path = await canonicalExistingPath(resolveFrom(caseDirectory, raw.fixture), "Fixture workspace");
    if (!isContained(suiteDirectory, path)) throw new Error(`Fixture workspace must remain inside the eval suite: ${path}`);
    return { type: "fixture", path };
  }
  const path = await canonicalExistingPath(resolveFrom(caseDirectory, raw.git.path), "Trusted Git workspace");
  if (!isContained(suiteDirectory, path) && !allowExternalWorkspaces) {
    throw new Error(`External Git workspace requires --allow-external-workspaces: ${path}`);
  }
  return {
    type: "git",
    path,
    ref: raw.git.ref
  };
}

function normalizeChecks(raw: RawCase["checks"]): readonly CheckDefinition[] {
  return raw.map((check) => {
    if (check.type === "command") {
      return check.timeout_seconds === undefined
        ? { type: check.type, command: check.command }
        : { type: check.type, command: check.command, timeoutSeconds: check.timeout_seconds };
    }
    return check;
  });
}

async function ensureFile(path: string, label: string): Promise<void> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${label} is not a file: ${path}`);
}

async function canonicalExistingPath(path: string, label: string): Promise<string> {
  const unresolved = await lstat(path);
  if (unresolved.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${path}`);
  return realpath(path);
}

export async function loadSuite(
  suitePathInput: string,
  selectedAgentName: string,
  options: { readonly allowExternalWorkspaces?: boolean } = {}
): Promise<SuiteDefinition> {
  const suitePath = await canonicalExistingPath(resolve(suitePathInput), "Suite manifest");
  await ensureFile(suitePath, "Suite manifest");
  const suiteDirectory = dirname(suitePath);
  const rawSuite = suiteSchema.parse(parse(await readFile(suitePath, "utf8")));
  const skillPath = await canonicalExistingPath(resolveFrom(suiteDirectory, rawSuite.skill), "Skill");
  await ensureFile(skillPath, "Skill");
  const skillRoot = dirname(skillPath);
  if (!isContained(skillRoot, suitePath)) throw new Error(`Suite manifest must be colocated under the Skill directory: ${suitePath}`);

  const agents: Record<string, AgentDefinition> = {};
  for (const [name, raw] of Object.entries(rawSuite.agents)) {
    const definition: AgentDefinition = {
      name,
      type: raw.type,
      executable: raw.type,
      roles: raw.roles,
      ...(raw.model === undefined ? {} : { model: raw.model })
    };
    agents[name] = definition;
  }
  const selectedAgent = agents[selectedAgentName];
  if (selectedAgent === undefined) throw new Error(`Unknown agent: ${selectedAgentName}`);

  const casePaths = (await Promise.all(rawSuite.cases.map((pattern) => expandPattern(suiteDirectory, pattern)))).flat();
  if (casePaths.length === 0) throw new Error("No evaluation cases matched");
  const cases: CaseDefinition[] = [];
  const ids = new Set<string>();
  for (const casePathInput of casePaths) {
    const casePath = await canonicalExistingPath(casePathInput, "Evaluation case");
    if (!isContained(suiteDirectory, casePath)) throw new Error(`Evaluation case must remain inside the eval suite: ${casePath}`);
    const raw = caseSchema.parse(parse(await readFile(casePath, "utf8")));
    if (ids.has(raw.id)) throw new Error(`Duplicate case id: ${raw.id}`);
    ids.add(raw.id);
    if (raw.judge !== undefined && agents[raw.judge.agent] === undefined) {
      throw new Error(`Case ${raw.id} references unknown judge agent: ${raw.judge.agent}`);
    }
    cases.push({
      id: raw.id,
      tags: raw.tags,
      prompt: raw.prompt,
      workspace: await normalizeWorkspace(raw.workspace, dirname(casePath), suiteDirectory, options.allowExternalWorkspaces ?? false),
      checks: normalizeChecks(raw.checks),
      sourcePath: casePath,
      ...(raw.judge === undefined ? {} : { judge: raw.judge })
    });
  }

  const skillDirectory = dirname(skillPath);

  return deepFreeze({
    schemaVersion: 1,
    suitePath,
    skillPath,
    skillName: basename(skillDirectory),
    agents,
    selectedAgent,
    defaults: {
      trials: rawSuite.defaults.trials,
      timeoutSeconds: rawSuite.defaults.timeout_seconds,
      skillDelivery: rawSuite.defaults.skill_delivery
    },
    cases
  });
}
