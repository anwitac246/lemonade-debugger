/**
 * Public API surface of @ai-cli/core.
 *
 * Consumers (the CLI package, tests) import from this file only.
 * Internal modules are not part of the contract.
 */

export { Agent } from "./agent/agent.js";
export { createAgent, type CreateAgentOptions } from "./agent/agent-factory.js";
export { ToolRegistry } from "./tools/tool-registry.js";
export { DAPClient, type DAPTransport } from "./dap/dap-client.js";
export { DAPSession } from "./dap/dap-session.js";

export type {
  ToolDefinition,
  ToolResult,
  AgentConfig,
  AgentRunOptions,
  AgentEvent,
  ConversationMessage,
  DAPStackFrame,
  DAPVariable,
  DAPThread,
  DAPCapabilities,
} from "./types.js";
