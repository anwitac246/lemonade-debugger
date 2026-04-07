/**
 * Agent factory.
 *
 * Wires together: config, tools, DAP session, optional DB.
 * The UI layer only needs to call createAgent() and then agent.run().
 */

import { Agent } from "./agent.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { readFileTool, searchCodeTool } from "../tools/file-tools.js";
import { runShellCommandTool } from "../tools/shell-tool.js";
import {
  makeStartDebuggerTool,
  makeGetStackTraceTool,
  makeGetVariablesTool,
  makeContinueExecutionTool,
  makeSetBreakpointTool,
} from "../tools/dap-tools.js";
import { DAPSession } from "../dap/dap-session.js";
import { createSession } from "../db/session-store.js";
import type { AgentConfig, ToolDefinition } from "../types.js";

export interface CreateAgentOptions {
  apiKey: string;
  model?: string;
  maxIterations?: number;
  maxTokens?: number;
  temperature?: number;
  requireConfirmation?: boolean;
  /** Resume an existing session by ID */
  sessionId?: string;
  /** Skip DB (local/offline mode) */
  noDb?: boolean;
}

export interface AgentHandle {
  agent: Agent;
  sessionId: string;
  registry: ToolRegistry;
  dapSession: DAPSession;
  cleanup(): void;
}

export async function createAgent(
  options: CreateAgentOptions
): Promise<AgentHandle> {
  const config: AgentConfig = {
    apiKey: options.apiKey,
    model: options.model ?? "llama-3.1-8b-instant",
    maxIterations: options.maxIterations ?? 25,
    maxTokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? 0.2,
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
    makeSetBreakpointTool(dapSession) as ToolDefinition<unknown>,
  ]);

  const agent = new Agent(config, registry);

  let sessionId: string;

  if (options.noDb) {
    sessionId = `local-${Date.now()}`;
  } else if (options.sessionId) {
    sessionId = options.sessionId;
    await agent.loadSession(sessionId);
  } else {
    try {
      sessionId = await createSession(config.model);
      agent.setSession(sessionId);
    } catch {
      // DB unavailable — fall back to local session
      sessionId = `local-${Date.now()}`;
      agent.setSession(sessionId);
    }
  }

  return {
    agent,
    sessionId,
    registry,
    dapSession,
    cleanup() {
      dapSession.terminate();
    },
  };
}