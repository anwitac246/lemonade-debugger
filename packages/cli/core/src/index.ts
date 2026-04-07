export { Agent } from "./agent/agent.js";
export {
  createAgent,
  type CreateAgentOptions,
  type AgentHandle,
} from "./agent/agent-factory.js";
export { ToolRegistry } from "./tools/tool-registry.js";
export { DAPClient, type DAPTransport } from "./dap/dap-client.js";
export { DAPSession } from "./dap/dap-session.js";
export { getDb, closeDb } from "./db/client.js";
export { createSession, listSessions, touchSession } from "./db/session-store.js";
export { getMessages, clearMessages, saveMessage } from "./db/message-store.js";
export { retrieveContext, formatContextForPrompt } from "./context/retrieval.js";
export { buildSystemPrompt } from "./prompt/system-prompt.js";

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
  DAPLanguage,
  FileContext,
  ContextRetrievalOptions,
  SessionMetadata,
  StoredMessage,
} from "./types.js";