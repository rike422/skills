import type { AgentRole } from "../types.js";
import type { ProcessResult } from "../process.js";

export interface AgentExecutionInput {
  readonly executable: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly role: AgentRole;
  readonly model?: string;
}

export interface AgentExecutionResult {
  readonly finalResponse: string;
  readonly process: ProcessResult;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AgentPreflight {
  readonly executable: string;
  readonly version: string;
  readonly executableHash?: string;
}

export class AgentExecutionError extends Error {
  constructor(message: string, readonly process: ProcessResult) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

export interface AgentAdapter {
  preflight(executable: string): Promise<AgentPreflight>;
  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}
