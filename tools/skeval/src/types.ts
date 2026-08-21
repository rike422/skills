export type AgentRole = "executor" | "judge" | "improver";

export interface AgentDefinition {
  readonly name: string;
  readonly type: string;
  readonly executable: string;
  readonly model?: string;
  readonly roles: readonly AgentRole[];
}

export interface DefaultsDefinition {
  readonly trials: number;
  readonly timeoutSeconds: number;
  readonly skillDelivery: "prompt";
}

export type WorkspaceDefinition =
  | { readonly type: "fixture"; readonly path: string }
  | { readonly type: "git"; readonly path: string; readonly ref: string };

export type CheckDefinition =
  | { readonly type: "file_exists"; readonly path: string }
  | { readonly type: "file_not_exists"; readonly path: string }
  | { readonly type: "file_contains"; readonly path: string; readonly contains: string }
  | { readonly type: "file_changed"; readonly path: string }
  | { readonly type: "file_not_changed"; readonly path: string }
  | { readonly type: "command"; readonly command: readonly string[]; readonly timeoutSeconds?: number };

export interface JudgeDefinition {
  readonly agent: string;
  readonly rubric: string;
}

export interface CaseDefinition {
  readonly id: string;
  readonly tags: readonly string[];
  readonly prompt: string;
  readonly workspace: WorkspaceDefinition;
  readonly checks: readonly CheckDefinition[];
  readonly judge?: JudgeDefinition;
  readonly sourcePath: string;
}

export interface SuiteDefinition {
  readonly schemaVersion: 1;
  readonly suitePath: string;
  readonly skillPath: string;
  readonly skillName: string;
  readonly agents: Readonly<Record<string, AgentDefinition>>;
  readonly selectedAgent: AgentDefinition;
  readonly defaults: DefaultsDefinition;
  readonly cases: readonly CaseDefinition[];
}

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly command?: {
    readonly argv: readonly string[];
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    readonly durationMs: number;
    readonly stdoutTruncated: boolean;
    readonly stderrTruncated: boolean;
  };
}

export interface AgentOutcomeSnapshot {
  readonly schemaVersion: 1;
  readonly status: "completed" | "failed" | "timed_out";
  readonly baseOid: string;
  readonly finalOid: string;
  readonly treeOid: string;
  readonly diff: string;
  readonly changedPaths: readonly string[];
  readonly finalResponse: string;
  readonly files: readonly { readonly path: string; readonly hash: string; readonly size: number }[];
}
