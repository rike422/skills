import { ClaudeAdapter } from "./claude.js";
import type { AgentAdapter } from "./types.js";

export function createAgentAdapter(type: string): AgentAdapter {
  if (type === "claude") return new ClaudeAdapter();
  throw new Error(`Unsupported agent type in this version: ${type}`);
}

export type { AgentAdapter, AgentExecutionInput, AgentExecutionResult, AgentPreflight } from "./types.js";
