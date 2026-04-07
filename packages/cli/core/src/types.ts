/**
 * Shared type contracts.
 * Single source of truth for all layers.
 */

// ─── Tool System ──────────────────────────────────────────────────────────────

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema draft-07
  execute(input: TInput): Promise<ToolResult>;
  destructive?: boolean;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

// ─── Conversation ──────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

// ─── Agent Events (streaming) ─────────────────────────────────────────────────

export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; input: unknown; callId: string }
  | { type: "tool_result"; toolName: string; result: ToolResult; callId: string }
  | { type: "turn_complete"; totalTokens?: number }
  | { type: "error"; message: string; fatal?: boolean }
  | { type: "thinking"; content: string };

// ─── Agent Config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  model: string;
  maxIterations: number;
  requireConfirmation: boolean;
  apiKey: string;
  /** Max tokens per LLM call */
  maxTokens?: number;
  /** Temperature (0-1). Default 0.2 for coding tasks */
  temperature?: number;
}

export interface AgentRunOptions {
  userMessage: string;
  onEvent: (event: AgentEvent) => void;
  confirmTool?: (toolName: string, input: unknown) => Promise<boolean>;
  /** Abort signal to cancel mid-run */
  signal?: AbortSignal;
}

// ─── Context / File Retrieval ─────────────────────────────────────────────────

export interface FileContext {
  path: string;
  content: string;
  relevanceScore: number;
  startLine?: number;
  endLine?: number;
}

export interface ContextRetrievalOptions {
  query: string;
  workingDir: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

// ─── DAP (Debug Adapter Protocol) ────────────────────────────────────────────

export interface DAPCapabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsFunctionBreakpoints?: boolean;
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsLogPoints?: boolean;
  supportsRestartRequest?: boolean;
  supportsTerminateRequest?: boolean;
}

export interface DAPStackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string };
  line: number;
  column: number;
  presentationHint?: "normal" | "label" | "subtle";
}

export interface DAPVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

export interface DAPThread {
  id: number;
  name: string;
}

export interface DAPBreakpoint {
  id?: number;
  verified: boolean;
  message?: string;
  source?: { path?: string };
  line?: number;
}

export type DAPLanguage = "python" | "node" | "go" | "rust" | "java";

// ─── Session / DB ─────────────────────────────────────────────────────────────

export interface SessionMetadata {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  model: string;
  messageCount: number;
  title?: string;
}

export interface StoredMessage {
  id?: string;
  sessionId: string;
  role: MessageRole | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  createdAt: Date;
  tokens?: number;
}