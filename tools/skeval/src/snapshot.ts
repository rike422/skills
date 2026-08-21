import { createHash } from "node:crypto";
import { cp, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { runGit, type StagedWorkspace } from "./workspace.js";
import type { AgentOutcomeSnapshot } from "./types.js";

export interface CapturedOutcome {
  readonly snapshot: AgentOutcomeSnapshot;
  readonly workspacePath: string;
  readonly temporaryRoot: string;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function collectManifest(root: string, path: string): Promise<{ path: string; hash: string; size: number }[]> {
  const result: { path: string; hash: string; size: number }[] = [];
  for (const name of (await readdir(path)).sort()) {
    if (name === ".git") continue;
    const child = join(path, name);
    const info = await lstat(child);
    if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed in an outcome snapshot: ${child}`);
    if (info.isDirectory()) result.push(...await collectManifest(root, child));
    else if (info.isFile()) {
      const content = await readFile(child);
      result.push({ path: relative(root, child).split(sep).join("/"), hash: sha256(content), size: content.length });
    }
  }
  return result;
}

export async function captureOutcomeSnapshot(
  workspace: StagedWorkspace,
  status: AgentOutcomeSnapshot["status"],
  finalResponse: string
): Promise<CapturedOutcome> {
  await rm(join(workspace.path, ".git"), { recursive: true, force: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "skeval-outcome-"));
  const outcomePath = join(temporaryRoot, "workspace");
  try {
    await cp(workspace.path, outcomePath, { recursive: true, force: false, errorOnExist: true });
    const outcomeGit = { path: outcomePath, gitDirectory: workspace.gitDirectory };
    await runGit(outcomeGit, ["reset", "--mixed", "--quiet", workspace.baseOid]);
    await runGit(outcomeGit, ["add", "-A"]);
    const changed = await runGit(outcomeGit, ["diff", "--name-only", "-z", "--cached", workspace.baseOid], { outputLimitBytes: 4 * 1024 * 1024 });
    if (changed.stdoutTruncated) throw new Error("Changed-path output exceeded 4 MiB");
    const changedPaths = Object.freeze(changed.stdout.split("\0").filter(Boolean).sort());
    const diffResult = await runGit(outcomeGit, ["diff", "--binary", "--cached", workspace.baseOid], { outputLimitBytes: 16 * 1024 * 1024 });
    if (diffResult.stdoutTruncated || diffResult.stderrTruncated) throw new Error("Outcome diff exceeded the 16 MiB audit limit");
    await runGit(outcomeGit, [
      "-c", "user.name=skeval", "-c", "user.email=skeval@example.invalid",
      "commit", "--allow-empty", "-qm", "skeval outcome"
    ]);
    const finalOid = (await runGit(outcomeGit, ["rev-parse", "HEAD"])).stdout.trim();
    const treeOid = (await runGit(outcomeGit, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
    const files = Object.freeze((await collectManifest(outcomePath, outcomePath)).map((file) => Object.freeze(file)));
    const snapshot = Object.freeze({
      schemaVersion: 1 as const,
      status,
      baseOid: workspace.baseOid,
      finalOid,
      treeOid,
      diff: diffResult.stdout,
      changedPaths,
      finalResponse,
      files
    });
    return Object.freeze({ snapshot, workspacePath: outcomePath, temporaryRoot });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
