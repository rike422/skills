import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { runProcess, type ProcessOptions } from "./process.js";

let availability: Promise<void> | undefined;

export function assertCommandSandboxAvailable(): Promise<void> {
  availability ??= (async () => {
    if (process.platform !== "darwin") {
      throw new Error(`No fail-closed command-check sandbox is available for ${process.platform}`);
    }
    await access("/usr/bin/sandbox-exec", constants.X_OK);
    const probe = await runProcess({
      argv: ["/usr/bin/sandbox-exec", "-p", "(version 1) (allow default)", "/usr/bin/true"],
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputLimitBytes: 16 * 1024
    });
    if (probe.exitCode !== 0 || probe.timedOut) {
      throw new Error(`Command-check sandbox is unavailable: ${probe.stderr || probe.stdout}`);
    }
  })();
  return availability;
}

function quoteSandbox(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function sandboxCommand(options: ProcessOptions, writableRoot: string): Promise<ProcessOptions> {
  await assertCommandSandboxAvailable();
  const readableRoots = new Set([
    writableRoot,
    "/bin", "/sbin", "/usr", "/System", "/Library", "/Applications", "/opt", "/private/tmp", "/dev",
    ...(options.env?.PATH ?? "").split(":").filter(Boolean)
  ]);
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    ...[...readableRoots].map((path) => `(allow file-read* (subpath "${quoteSandbox(path)}"))`),
    `(allow file-write* (subpath "${quoteSandbox(writableRoot)}"))`,
    `(allow file-write* (subpath "${quoteSandbox(join(writableRoot, ".skeval-home"))}"))`,
    "(deny process-exec (literal \"/usr/bin/security\"))",
    "(deny network*)"
  ].join(" ");
  return { ...options, argv: ["/usr/bin/sandbox-exec", "-p", profile, ...options.argv] };
}
