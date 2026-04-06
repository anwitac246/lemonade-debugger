export { Agent } from "./agent/agent.js";
export { createAgent, type CreateAgentOptions, type AgentWithSession } from "./agent/agent-factory.js";
export { ToolRegistry } from "./tools/tool-registry.js";
export { DAPClient, type DAPTransport } from "./dap/dap-client.js";
export { DAPSession } from "./dap/dap-session.js";
export { getDb, closeDb } from "./db/client.js";
export { createSession, listSessions } from "./db/session-store.js";
export { getMessages, clearMessages } from "./db/message-store.js";

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