/**
 * Agent: Production-grade ReAct loop.
 *
 * Key design decisions:
 * - Streaming first: text deltas flow to UI immediately
 * - Abort-aware: respects AbortSignal at every async boundary
 * - Tool parallelism: independent tool calls run concurrently
 * - History compaction: avoids token limit blowup in long sessions
 * - Typed errors: distinct fatal vs. recoverable error paths
 */

import Groq from "groq-sdk";
import * as os from "os";
import type {
  AgentConfig,
  AgentRunOptions,
  AgentEvent,
  ConversationMessage,
} from "../types.js";
import { buildSystemPrompt } from "../prompt/system-prompt.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { saveMessage, getMessages } from "../db/message-store.js";
import { touchSession } from "../db/session-store.js";

// ─── Internal types ────────────────────────────────────────────────────────────

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string; name: string };

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  index: number;
}

// Groq streams usage only when stream_options.include_usage is true;
// extend the chunk type to reflect that.
type ChatCompletionChunkWithUsage = Groq.Chat.ChatCompletionChunk & {
  usage?: { total_tokens: number };
};

// Maximum history messages to keep in memory (old ones get summarized)
const MAX_HISTORY_MESSAGES = 40;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class Agent {
  private readonly client: Groq;
  private history: ChatMessage[] = [];
  private sessionId?: string;

  constructor(
    private readonly config: AgentConfig,
    private readonly registry: ToolRegistry
  ) {
    this.client = new Groq({ apiKey: config.apiKey });
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    const stored = await getMessages(sessionId);

    // Reconstruct history excluding tool messages (those are ephemeral context)
    this.history = stored
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): ConversationMessage[] {
    return this.history
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({ role: m.role, content: m.content }));
  }

  // ── Main run loop ──────────────────────────────────────────────────────────

  async run(options: AgentRunOptions): Promise<void> {
    const { userMessage, onEvent, confirmTool, signal } = options;

    // 1. Persist user message
    this.history.push({ role: "user", content: userMessage });
    if (this.sessionId) {
      await this.persistMessage({ role: "user", content: userMessage });
      await touchSession(this.sessionId).catch(() => undefined);
    }

    // 2. Retrieve relevant file context (non-blocking, best-effort)
    let contextSection: string | undefined;
    try {
      // Dynamic import so a missing module doesn't crash the whole agent
      const { retrieveContext, formatContextForPrompt } = await import(
        "../context/retrieval.js"
      );
      const contexts = await retrieveContext({
        query: userMessage,
        workingDir: process.cwd(),
        maxFiles: 6,
        maxBytesPerFile: 30_000,
      });
      if (contexts.length > 0) {
        contextSection = formatContextForPrompt(contexts, process.cwd());
      }
    } catch {
      // Context retrieval failure is non-fatal
    }

    const systemPrompt = buildSystemPrompt({
      toolNames: this.registry.names(),
      workingDir: process.cwd(),
      contextSection,
      platform: os.platform(),
      shell: process.env.SHELL ?? process.env.ComSpec,
    });

    // 3. ReAct loop
    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      if (signal?.aborted) {
        onEvent({ type: "error", message: "Aborted by user.", fatal: true });
        onEvent({ type: "turn_complete" });
        return;
      }

      iterations++;

      // Compact history if it's getting long
      const messages = this.buildMessages(systemPrompt);

      // 4. Stream LLM response
      let stream: AsyncIterable<Groq.Chat.ChatCompletionChunk>;
      try {
        stream = await this.client.chat.completions.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens ?? 8192,
          temperature: this.config.temperature ?? 0.2,
          tools: this.registry.toGroqSchemas(),
          tool_choice: "auto",
          messages: messages as Groq.Chat.ChatCompletionMessageParam[],
          stream: true,
          // stream_options: { include_usage: true },
        });
      } catch (err) {
        const msg = this.formatError(err);
        onEvent({ type: "error", message: `API error: ${msg}`, fatal: true });
        onEvent({ type: "turn_complete" });
        return;
      }

      // 5. Collect streaming response
      const { text, toolCalls, finishReason, totalTokens } =
        await this.collectStream(stream, onEvent, signal);

      // 6. Build assistant message
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.argumentsJson },
              })),
            }
          : {}),
      };
      this.history.push(assistantMsg);

      if (text && this.sessionId) {
        await this.persistMessage({ role: "assistant", content: text });
      }

      // 7. No tool calls → done
      if (toolCalls.length === 0 || finishReason === "stop") {
        onEvent({ type: "turn_complete", totalTokens });
        return;
      }

      // 8. Execute tools (parallel where safe, sequential for destructive)
      await this.executeToolCalls(toolCalls, onEvent, confirmTool, signal);

      // Loop continues → model sees tool results and responds again
    }

    onEvent({
      type: "error",
      message: `Reached maximum iterations (${this.config.maxIterations}). The task may be too complex for a single run.`,
    });
    onEvent({ type: "turn_complete" });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildMessages(systemPrompt: string): ChatMessage[] {
    // Compact: if history is very long, keep system + last N messages
    const historyToUse =
      this.history.length > MAX_HISTORY_MESSAGES
        ? this.history.slice(-MAX_HISTORY_MESSAGES)
        : this.history;

    return [{ role: "system", content: systemPrompt }, ...historyToUse];
  }

  private async collectStream(
    stream: AsyncIterable<Groq.Chat.ChatCompletionChunk>,
    onEvent: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<{
    text: string;
    toolCalls: AccumulatedToolCall[];
    finishReason: string | null;
    totalTokens?: number;
  }> {
    let text = "";
    const toolCallAccumulator: Record<number, AccumulatedToolCall> = {};
    let finishReason: string | null = null;
    let totalTokens: number | undefined;

    for await (const chunk of stream) {
      if (signal?.aborted) break;

      const choice = chunk.choices[0];
      if (!choice) continue;

      finishReason = choice.finish_reason ?? finishReason;

      const delta = choice.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        onEvent({ type: "text_delta", delta: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls as Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>) {
          if (!toolCallAccumulator[tc.index]) {
            toolCallAccumulator[tc.index] = {
              id: "",
              name: "",
              argumentsJson: "",
              index: tc.index,
            };
          }
          const acc = toolCallAccumulator[tc.index]!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.argumentsJson += tc.function.arguments;
        }
      }

      // usage is present on the final chunk when stream_options.include_usage is true
      const chunkWithUsage = chunk as ChatCompletionChunkWithUsage;
      if (chunkWithUsage.usage) {
        totalTokens = chunkWithUsage.usage.total_tokens;
      }
    }

    return {
      text,
      toolCalls: Object.values(toolCallAccumulator).sort(
        (a, b) => a.index - b.index
      ),
      finishReason,
      totalTokens,
    };
  }

  private async executeToolCalls(
    toolCalls: AccumulatedToolCall[],
    onEvent: (e: AgentEvent) => void,
    confirmTool?: (name: string, input: unknown) => Promise<boolean>,
    signal?: AbortSignal
  ): Promise<void> {
    // Separate destructive from safe tools
    const destructive = toolCalls.filter((tc) =>
      this.registry.isDestructive(tc.name)
    );
    const safe = toolCalls.filter(
      (tc) => !this.registry.isDestructive(tc.name)
    );

    // Run safe tools in parallel
    const safeResults = await Promise.all(
      safe.map((tc) => this.executeSingleTool(tc, onEvent, confirmTool, signal))
    );

    // Run destructive tools sequentially (user may need to confirm each)
    const destructiveResults: ChatMessage[] = [];
    for (const tc of destructive) {
      const msg = await this.executeSingleTool(
        tc,
        onEvent,
        confirmTool,
        signal
      );
      destructiveResults.push(msg);
    }

    // Push all tool results into history in original order
    const allResults = new Map<string, ChatMessage>();
    for (const msg of [...safeResults, ...destructiveResults]) {
      if (msg.role === "tool") {
        allResults.set(msg.tool_call_id, msg);
      }
    }

    for (const tc of toolCalls) {
      const msg = allResults.get(tc.id);
      if (msg) this.history.push(msg);
    }
  }

  private async executeSingleTool(
    tc: AccumulatedToolCall,
    onEvent: (e: AgentEvent) => void,
    confirmTool?: (name: string, input: unknown) => Promise<boolean>,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(tc.argumentsJson || "{}") as Record<string, unknown>;
    } catch {
      input = {};
    }

    onEvent({ type: "tool_call", toolName: tc.name, input, callId: tc.id });

    // Confirmation gate for destructive tools
    if (this.config.requireConfirmation && this.registry.isDestructive(tc.name)) {
      const approved = await confirmTool?.(tc.name, input);
      if (!approved) {
        const content = "Tool execution cancelled by user.";
        onEvent({
          type: "tool_result",
          toolName: tc.name,
          result: { content, isError: true },
          callId: tc.id,
        });
        return { role: "tool", tool_call_id: tc.id, name: tc.name, content };
      }
    }

    if (signal?.aborted) {
      const content = "Aborted before tool execution.";
      return { role: "tool", tool_call_id: tc.id, name: tc.name, content };
    }

    const result = await this.registry.execute(tc.name, input);

    onEvent({
      type: "tool_result",
      toolName: tc.name,
      result,
      callId: tc.id,
    });

    if (this.sessionId) {
      await this.persistMessage({
        role: "tool",
        content: result.content,
        toolName: tc.name,
        toolCallId: tc.id,
        isError: result.isError,
      }).catch(() => undefined);
    }

    return {
      role: "tool",
      tool_call_id: tc.id,
      name: tc.name,
      content: result.content,
    };
  }

  private async persistMessage(msg: {
    role: string;
    content: string;
    toolName?: string;
    toolCallId?: string;
    isError?: boolean;
  }): Promise<void> {
    if (!this.sessionId) return;
    await saveMessage({
      sessionId: this.sessionId,
      role: msg.role as "user" | "assistant" | "tool",
      content: msg.content,
      toolName: msg.toolName,
      toolCallId: msg.toolCallId,
      isError: msg.isError,
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return "Unknown error";
  }
}