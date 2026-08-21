import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

interface ManifestRecord {
  readonly path: string;
  readonly hash: string;
  readonly size: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertRelativePath(path: string): void {
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error(`Artifact path escapes run directory: ${path}`);
}

export class RunArtifacts {
  readonly runDirectory: string;
  private readonly records: ManifestRecord[] = [];
  private finalized = false;

  private constructor(runDirectory: string) {
    this.runDirectory = runDirectory;
  }

  static async create(outputRoot: string, skillName: string, runId: string): Promise<RunArtifacts> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(skillName)) throw new Error(`Invalid skill name: ${skillName}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    const runsRoot = join(resolve(outputRoot), skillName, "runs");
    await mkdir(runsRoot, { recursive: true });
    const runDirectory = join(runsRoot, runId);
    await mkdir(runDirectory);
    const artifacts = new RunArtifacts(runDirectory);
    await artifacts.writeJson("state/running.json", { schemaVersion: 1, state: "running", startedAt: new Date().toISOString() });
    return artifacts;
  }

  async writeText(path: string, content: string): Promise<void> {
    if (this.finalized) throw new Error("Artifact run is already finalized");
    assertRelativePath(path);
    const target = resolve(this.runDirectory, path);
    const rel = relative(this.runDirectory, target);
    assertRelativePath(rel);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Artifact already exists: ${path}`);
      throw error;
    }
    await unlink(temporary);
    this.records.push({ path: rel.split(sep).join("/"), hash: sha256(content), size: Buffer.byteLength(content) });
  }

  writeJson(path: string, value: unknown): Promise<void> {
    return this.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async finalize(result: unknown): Promise<void> {
    await this.writeJson("result.json", result);
    const manifestContent = `${JSON.stringify({ schemaVersion: 1, files: [...this.records].sort((a, b) => a.path.localeCompare(b.path)) }, null, 2)}\n`;
    await this.writeText("manifest.json", manifestContent);
    await this.writeJson("state/completed.json", { schemaVersion: 1, state: "completed", finishedAt: new Date().toISOString() });
    this.finalized = true;
  }

  async fail(error: unknown): Promise<void> {
    if (this.finalized) return;
    await this.writeJson("partial-manifest.json", {
      schemaVersion: 1,
      partial: true,
      files: [...this.records].sort((a, b) => a.path.localeCompare(b.path))
    });
    await this.writeJson("state/interrupted.json", {
      schemaVersion: 1,
      state: "interrupted",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
