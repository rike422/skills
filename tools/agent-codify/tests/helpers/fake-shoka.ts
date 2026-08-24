import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

function episode(episodeId: string, schemaVersion = "transcript-episode/v1") {
  const source = { path: `${episodeId}.jsonl`, hash: "hash", line: 1, byte_offset: 0, state: "ok" };
  const evidence = { event_id: 1, event_type: "message", role: "user", text: "Use the existing owner.", source };
  return {
    schema_version: schemaVersion,
    episode_id: episodeId,
    transcript_id: episodeId.split(":")[0],
    native_session_id: episodeId.split(":")[0],
    task_lineage_id: episodeId + ":lineage",
    project_id: "project-1",
    trigger: { type: "user_correction", event_id: 1 },
    context_before: [],
    corrections: [evidence],
    actions_after: [],
    outcomes: [{ event_id: 2, type: "test", outcome: "success", source }],
    task_status: "complete",
    source_event_ids: [1, 2],
    omitted: { events: 0, bytes: 0, tokens: 0, context_before: 0, actions_after: 0, outcomes: 0 }
  };
}

function result(episodeIds: string[]) {
  return {
    episodes: episodeIds.map((id) => episode(id)),
    summary: { raw_events: episodeIds.length, sessions: episodeIds.length, task_lineages: episodeIds.length, projects: 1 }
  };
}

export async function fakeShoka(root: string): Promise<{ executable: string; logPath: string }> {
  const executable = join(root, "fake-shoka");
  const logPath = join(root, "calls.jsonl");
  const script = [
    "#!/usr/bin/env node",
    "const fs = require(\"node:fs\");",
    "const args = process.argv.slice(2);",
    "const episode = " + episode.toString() + ";",
    "const result = " + result.toString() + ";",
    "fs.appendFileSync(" + JSON.stringify(logPath) + ", JSON.stringify(args) + \"\\n\");",
    "if (args[0] !== \"transcript\" || args[1] !== \"episode\") process.exit(2);",
    "if (args[2] === \"search\") {",
    "  const query = args[3];",
    "  if (query === \"empty\") process.stdout.write(JSON.stringify(result([])) + \"\\n\");",
    "  else if (query === \"invalid\") process.stdout.write(JSON.stringify({ episodes: [episode(\"codex:invalid\", \"transcript-episode/v2\")], summary: { raw_events: 1, sessions: 1, task_lineages: 1, projects: 1 } }) + \"\\n\");",
    "  else if (query === \"malformed\") process.stdout.write(\"not-json\\n\");",
    "  else if (query === \"failure\") { process.stderr.write(\"index unavailable\\n\"); process.exit(7); }",
    "  else if (query === \"oversized\") { const value = result([\"codex:oversized\"]); value.episodes[0].corrections[0].text = \"x\".repeat(1024 * 1024); process.stdout.write(JSON.stringify(value) + \"\\n\"); }",
    "  else if (query === \"workflow\") process.stdout.write(JSON.stringify(result([\"codex:one:1:user_correction\", \"codex:two:1:user_correction\", \"codex:three:1:user_correction\"])) + \"\\n\");",
    "  else process.stdout.write(JSON.stringify(result([\"codex:one:1:user_correction\", \"codex:two:1:user_correction\"])) + \"\\n\");",
    "} else if (args[2] === \"list\") { const value = result(args.includes(\"empty\") ? [] : [\"codex:list:1:design_direction\"]); process.stdout.write(JSON.stringify(value.episodes) + \"\\n\"); }",
    "else process.exit(2);"
  ].join("\n");
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  return { executable, logPath };
}
