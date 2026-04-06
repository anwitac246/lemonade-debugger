import { Agent } from "./agent.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { readFileTool, searchCodeTool } from "../tools/file-tools.js";
import { runShellCommandTool } from "../tools/shell-tool.js";
import {
  makeStartDebuggerTool,
  makeGetStackTraceTool,
  makeGetVariablesTool,
  makeContinueExecutionTool,
} from "../tools/dap-tools.js";
import { DAPSession } from "../dap/dap-session.js";
import { createSession } from "../db/session-store.js";
import type { AgentConfig, ToolDefinition } from "../types.js";

export interface CreateAgentOptions {
  apiKey: string;
  model?: string;
  maxIterations?: number;
  requireConfirmation?: boolean;
  /** Pass an existing sessionId to resume a session. */
  sessionId?: string;
  /** Skip DB entirely (useful in tests). */
  noDb?: boolean;
}

export interface AgentWithSession {
  agent: Agent;
  sessionId: string;
}

export async function createAgent(
  options: CreateAgentOptions
): Promise<AgentWithSession> {
  const config: AgentConfig = {
    apiKey: options.apiKey,
    model: options.model ?? "llama-3.3-70b-versatile",
    maxIterations: options.maxIterations ?? 20,
    requireConfirmation: options.requireConfirmation ?? false,
  };

  const dapSession = new DAPSession();

  const registry = new ToolRegistry().registerAll([
    readFileTool as ToolDefinition<unknown>,
    searchCodeTool as ToolDefinition<unknown>,
    runShellCommandTool as ToolDefinition<unknown>,
    makeStartDebuggerTool(dapSession) as ToolDefinition<unknown>,
    makeGetStackTraceTool(dapSession) as ToolDefinition<unknown>,
    makeGetVariablesTool(dapSession) as ToolDefinition<unknown>,
    makeContinueExecutionTool(dapSession) as ToolDefinition<unknown>,
  ]);

  const agent = new Agent(config, registry);

  let sessionId: string;
  if (options.noDb) {
    sessionId = `local-${Date.now()}`;
  } else if (options.sessionId) {
    sessionId = options.sessionId;
    await agent.loadSession(sessionId);
  } else {
    sessionId = await createSession(config.model);
    agent.setSession(sessionId);
  }

  return { agent, sessionId };
}