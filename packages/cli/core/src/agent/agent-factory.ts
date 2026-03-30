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
    // llama-3.3-70b-versatile is Groq's best model for tool use + long context
    model: options.model ?? "llama-3.3-70b-versatile",
    maxIterations: options.maxIterations ?? 20,
    requireConfirmation: options.requireConfirmation ?? true,
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

  return new Agent(config, registry);
}