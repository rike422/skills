import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export interface SkillBundleFile {
  readonly path: string;
  readonly contentBase64: string;
  readonly hash: string;
  readonly size: number;
  readonly mode: number;
}

export interface SkillBundle {
  readonly root: string;
  readonly hash: string;
  readonly name: string;
  readonly description: string;
  readonly skillText: string;
  readonly files: readonly SkillBundleFile[];
}

const includedDirectories = ["references", "scripts", "assets"] as const;
const frontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63),
  description: z.string().min(1).max(1024)
}).passthrough();

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeUtf8(content: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

function parseFrontmatter(skillText: string, expectedName: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillText);
  if (match?.[1] === undefined) throw new Error("SKILL.md requires YAML frontmatter with name and description");
  const metadata = frontmatterSchema.parse(parse(match[1]));
  if (metadata.name !== expectedName) {
    throw new Error(`Skill name ${metadata.name} must match its directory ${expectedName}`);
  }
  return metadata;
}

async function collectFiles(root: string, path: string): Promise<string[]> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed in a Skill bundle: ${path}`);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) throw new Error(`Unsupported Skill bundle entry: ${path}`);
  const result: string[] = [];
  for (const name of (await readdir(path)).sort()) {
    const child = join(path, name);
    const childRelative = relative(root, child);
    if (childRelative.split(sep).includes(".git")) continue;
    result.push(...await collectFiles(root, child));
  }
  return result;
}

export async function snapshotSkillBundle(skillPathInput: string): Promise<SkillBundle> {
  const unresolvedSkill = await lstat(skillPathInput);
  if (unresolvedSkill.isSymbolicLink()) throw new Error(`Skill entrypoint must not be a symlink: ${skillPathInput}`);
  const skillPath = await realpath(skillPathInput);
  if (basename(skillPath) !== "SKILL.md") throw new Error(`Skill entrypoint must be named SKILL.md: ${skillPath}`);
  const root = dirname(skillPath);
  const paths = [skillPath];
  for (const directoryName of includedDirectories) {
    const directory = join(root, directoryName);
    const info = await lstat(directory).catch(() => undefined);
    if (info !== undefined) paths.push(...await collectFiles(root, directory));
  }

  const files: SkillBundleFile[] = [];
  let skillText = "";
  for (const path of paths.sort()) {
    const relativePath = relative(root, path).split(sep).join("/");
    const content = await readFile(path);
    if (relativePath === "SKILL.md") skillText = decodeUtf8(content, "SKILL.md");
    const info = await lstat(path);
    files.push({
      path: relativePath,
      contentBase64: content.toString("base64"),
      hash: sha256(content),
      size: content.length,
      mode: info.mode & 0o777
    });
  }
  const metadata = parseFrontmatter(skillText, basename(root));
  const manifest = files.map(({ path, hash, size, mode }) => `${path}\0${hash}\0${size}\0${mode}`).join("\n");
  const frozenFiles: readonly SkillBundleFile[] = Object.freeze(files.map((file) => Object.freeze(file)));
  return Object.freeze({ root, hash: sha256(manifest), name: metadata.name, description: metadata.description, skillText, files: frozenFiles });
}

export async function materializeSkillBundle(bundle: SkillBundle, destinationInput: string): Promise<void> {
  const destination = resolve(destinationInput);
  const existing = await lstat(destination).catch(() => undefined);
  if (existing !== undefined) throw new Error(`Skill materialization path already exists: ${destination}`);
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const file of bundle.files) {
    const path = resolve(destination, file.path);
    const rel = relative(destination, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Skill bundle path escapes destination: ${file.path}`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, Buffer.from(file.contentBase64, "base64"), { flag: "wx", mode: file.mode });
    await chmod(path, file.mode);
  }
}
