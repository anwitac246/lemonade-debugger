/**
 * Shared type contracts. Kept in one file so both layers import a single
 * source of truth and never drift apart.
 */

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema (draft-07)
  execute(input: TInput): Promise<ToolResult>;
}

export interface ToolResult {
  /** Machine-readable output handed back to the LLM. */
  content: string;
  /** True when the tool produced an error – the LLM gets to see the error
   *  message so it can self-correct rather than silently looping. */
  isError: boolean;
}

/** A single turn in the conversation handed to the LLM. */
export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

/** Emitted by the agent so the CLI layer can render progress without
 *  understanding the ReAct loop internals. */
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; toolName: string; input: unknown }
  | { type: "tool_result"; toolName: string; result: ToolResult }
  | { type: "turn_complete" }
  | { type: "error"; message: string };

export interface AgentConfig {
  model: string;
  maxIterations: number;
  /** Ask the CLI layer for confirmation before mutating operations. */
  requireConfirmation: boolean;
  apiKey: string;
}

/** Passed from CLI to agent for each user turn. */
export interface AgentRunOptions {
  userMessage: string;
  onEvent: (event: AgentEvent) => void;
  /** Resolve to true = proceed, false = cancel. Only called when
   *  AgentConfig.requireConfirmation is true and the tool is destructive. */
  confirmTool?: (toolName: string, input: unknown) => Promise<boolean>;
}

// ─── DAP types (subset of the Debug Adapter Protocol spec) ─────────────────

export interface DAPCapabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsFunctionBreakpoints?: boolean;
  supportsConditionalBreakpoints?: boolean;
}

export interface DAPStackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string };
  line: number;
  column: number;
}

export interface DAPVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface DAPThread {
  id: number;
  name: string;
}
