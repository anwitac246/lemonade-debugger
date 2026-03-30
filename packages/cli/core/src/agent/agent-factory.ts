/**
 * createAgent: the composition root for the core package.
 *
 * The factory pattern here keeps the CLI layer (and tests) from having to
 * know which tools exist or how they're wired. Passing `apiKey` explicitly
 * rather than reading from env inside the agent keeps the agent pure and
 * easily testable with a different key.
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
} from "../tools/dap-tools.js";
import { DAPSession } from "../dap/dap-session.js";
import type { AgentConfig, ToolDefinition } from "../types.js";

export interface CreateAgentOptions {
  apiKey: string;
  model?: string;
  maxIterations?: number;
  requireConfirmation?: boolean;
}

export function createAgent(options: CreateAgentOptions): Agent {
  const config: AgentConfig = {
    apiKey: options.apiKey,
    model: options.model ?? "claude-opus-4-5",
    maxIterations: options.maxIterations ?? 20,
    requireConfirmation: options.requireConfirmation ?? true,
  };

  // One DAP session per agent instance. The session is stateful (holds the
  // debug adapter connection) but tools are stateless wrappers around it.
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

  return new Agent(config, registry);
}
