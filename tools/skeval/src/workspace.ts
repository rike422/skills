import { cp, lstat, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSuccessful, type ProcessOptions, type ProcessResult } from "./process.js";
import type { WorkspaceDefinition } from "./types.js";

export interface StagedWorkspace {
  readonly path: string;
  readonly gitDirectory: string;
  readonly baseOid: string;
  readonly sourceOid: string;
}

const gitEnvironment: Readonly<Record<string, string>> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z"
};

const safeGitPrefix = [
  "git", "--no-optional-locks",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "commit.gpgSign=false",
  "-c", "tag.gpgSign=false"
] as const;

export function gitProcessOptions(
  workspace: Pick<StagedWorkspace, "path" | "gitDirectory">,
  args: readonly string[],
  extra: Omit<ProcessOptions, "argv" | "cwd" | "env"> = {}
): ProcessOptions {
  return {
    argv: [...safeGitPrefix, `--git-dir=${workspace.gitDirectory}`, `--work-tree=${workspace.path}`, ...args],
    cwd: workspace.path,
    env: gitEnvironment,
    ...extra
  };
}

export function runGit(
  workspace: Pick<StagedWorkspace, "path" | "gitDirectory">,
  args: readonly string[],
  extra: Omit<ProcessOptions, "argv" | "cwd" | "env"> = {}
): Promise<ProcessResult> {
  return runSuccessful(gitProcessOptions(workspace, args, extra));
}

async function rejectRootSymlink(path: string, label: string): Promise<string> {
  const unresolved = await lstat(path);
  if (unresolved.isSymbolicLink()) throw new Error(`${label} root must not be a symlink: ${path}`);
  return realpath(path);
}

async function rejectSymlinksAndNestedRepos(root: string, path: string, allowRootGit: boolean): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed in a workspace: ${path}`);
  if (!info.isDirectory()) return;
  for (const name of await readdir(path)) {
    if (name === ".git") {
      if (path !== root || !allowRootGit) throw new Error(`Nested or embedded Git repository is not supported: ${path}`);
      continue;
    }
    await rejectSymlinksAndNestedRepos(root, join(path, name), allowRootGit);
  }
}

async function runSourceGit(source: string, args: readonly string[]): Promise<ProcessResult> {
  return runSuccessful({ argv: [...safeGitPrefix, ...args], cwd: source, env: gitEnvironment });
}

async function rejectUnsupportedGitFeatures(source: string): Promise<void> {
  const dirty = await runSourceGit(source, ["status", "--porcelain=v1"]);
  if (dirty.stdout.trim() !== "") throw new Error(`Git workspace must be clean: ${source}`);
  const modules = await stat(join(source, ".gitmodules")).catch(() => undefined);
  if (modules !== undefined) throw new Error("Git submodules are not supported in schema v1");
  const attributes = await readFile(join(source, ".gitattributes"), "utf8").catch(() => "");
  if (/filter\s*=\s*lfs|filter=lfs/.test(attributes)) throw new Error("Git LFS is not supported in schema v1");
  await rejectSymlinksAndNestedRepos(source, source, true);
}

async function exposeReadOnlyGitLink(destination: string, gitDirectory: string): Promise<void> {
  await writeFile(join(destination, ".git"), `gitdir: ${gitDirectory}\n`, { flag: "wx", mode: 0o444 });
}

async function separateGitMetadata(temporaryRoot: string, destination: string): Promise<string> {
  const gitDirectory = join(temporaryRoot, "metadata.git");
  await rename(join(destination, ".git"), gitDirectory);
  await exposeReadOnlyGitLink(destination, gitDirectory);
  return gitDirectory;
}

async function commitBaseline(path: string): Promise<string> {
  await runSuccessful({ argv: [...safeGitPrefix, "init", "-q"], cwd: path, env: gitEnvironment });
  await runSuccessful({ argv: [...safeGitPrefix, "add", "-A"], cwd: path, env: gitEnvironment });
  await runSuccessful({
    argv: [...safeGitPrefix, "-c", "user.name=skeval", "-c", "user.email=skeval@example.invalid", "commit", "--allow-empty", "-qm", "skeval baseline"],
    cwd: path,
    env: gitEnvironment
  });
  return (await runSuccessful({ argv: [...safeGitPrefix, "rev-parse", "HEAD"], cwd: path, env: gitEnvironment })).stdout.trim();
}

export async function stageWorkspace(source: WorkspaceDefinition): Promise<StagedWorkspace> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "skeval-workspace-"));
  const destination = join(temporaryRoot, "workspace");
  try {
    if (source.type === "fixture") {
      const fixture = await rejectRootSymlink(source.path, "Fixture workspace");
      const info = await stat(fixture);
      if (!info.isDirectory()) throw new Error(`Fixture workspace must be a directory: ${fixture}`);
      await rejectSymlinksAndNestedRepos(fixture, fixture, false);
      await cp(fixture, destination, { recursive: true, force: false, errorOnExist: true });
      const baseOid = await commitBaseline(destination);
      const gitDirectory = await separateGitMetadata(temporaryRoot, destination);
      return Object.freeze({ path: destination, gitDirectory, baseOid, sourceOid: baseOid });
    }

    const gitSource = await rejectRootSymlink(source.path, "Git workspace");
    await rejectUnsupportedGitFeatures(gitSource);
    const sourceOid = (await runSourceGit(gitSource, ["rev-parse", "--verify", `${source.ref}^{commit}`])).stdout.trim();
    await runSuccessful({
      argv: [...safeGitPrefix, "clone", "--quiet", "--no-local", "--no-hardlinks", gitSource, destination],
      cwd: temporaryRoot,
      env: gitEnvironment
    });
    await runSuccessful({ argv: [...safeGitPrefix, "checkout", "--quiet", "--detach", sourceOid], cwd: destination, env: gitEnvironment });
    await rejectSymlinksAndNestedRepos(destination, destination, true);
    const baseOid = (await runSuccessful({ argv: [...safeGitPrefix, "rev-parse", "HEAD"], cwd: destination, env: gitEnvironment })).stdout.trim();
    if (baseOid !== sourceOid) throw new Error(`Git identity drift: expected ${sourceOid}, got ${baseOid}`);
    const gitDirectory = await separateGitMetadata(temporaryRoot, destination);
    return Object.freeze({ path: destination, gitDirectory, baseOid, sourceOid });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function stagePinnedWorkspace(source: StagedWorkspace): Promise<StagedWorkspace> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "skeval-workspace-"));
  const destination = join(temporaryRoot, "workspace");
  try {
    await runSuccessful({
      argv: [...safeGitPrefix, "clone", "--quiet", "--no-local", "--no-hardlinks", source.gitDirectory, destination],
      cwd: temporaryRoot,
      env: gitEnvironment
    });
    await runSuccessful({ argv: [...safeGitPrefix, "checkout", "--quiet", "--detach", source.baseOid], cwd: destination, env: gitEnvironment });
    const gitDirectory = await separateGitMetadata(temporaryRoot, destination);
    const baseOid = (await runGit({ path: destination, gitDirectory }, ["rev-parse", "HEAD"])).stdout.trim();
    if (baseOid !== source.baseOid) throw new Error(`Pinned workspace identity drift: expected ${source.baseOid}, got ${baseOid}`);
    return Object.freeze({ path: destination, gitDirectory, baseOid, sourceOid: source.sourceOid });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
