/**
 * Agent: Production-grade ReAct loop over Groq's streaming API.
 *
 * Key design decisions:
 * - tool_choice is "auto" only when tools are registered (Groq rejects it otherwise).
 * - Streaming first: text deltas flow to the UI immediately.
 * - Abort-aware: checks AbortSignal at every async boundary.
 * - Safe tools run in parallel; destructive tools run sequentially.
 * - History compaction keeps the context window from blowing up in long sessions.
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

// ─── Internal types ───────────────────────────────────────────────────────────

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

// Max messages to keep in the in-memory history before compacting.
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

  // ── Session lifecycle ─────────────────────────────────────────────────────

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    const stored = await getMessages(sessionId);
    // Reconstruct only user/assistant turns; tool messages are ephemeral context.
    this.history = stored
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): ConversationMessage[] {
    return this.history
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      )
      .map((m) => ({ role: m.role, content: m.content }));
  }

  // ── Main run loop ─────────────────────────────────────────────────────────

  async run(options: AgentRunOptions): Promise<void> {
    const { userMessage, onEvent, confirmTool, signal } = options;

    // 1. Persist and record the user turn.
    this.history.push({ role: "user", content: userMessage });
    if (this.sessionId) {
      await this.persistMessage({ role: "user", content: userMessage });
      await touchSession(this.sessionId).catch(() => undefined);
    }

    // 2. Retrieve relevant file context — best-effort, never crashes the agent.
    let contextSection: string | undefined;
    try {
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
      // Non-fatal — agent still works without file context.
    }

    const systemPrompt = buildSystemPrompt({
      toolNames: this.registry.names(),
      workingDir: process.cwd(),
      contextSection,
      platform: os.platform(),
      shell: process.env.SHELL ?? process.env.ComSpec,
    });

    // 3. ReAct loop — model reasons, calls tools, reasons again until done.
    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      if (signal?.aborted) {
        onEvent({ type: "error", message: "Aborted by user.", fatal: true });
        onEvent({ type: "turn_complete" });
        return;
      }

      const messages = this.buildMessages(systemPrompt);
      const hasTools = this.registry.size() > 0;

      // Build the API request. Only include tools/tool_choice when tools exist —
      // Groq returns 400 if tool_choice is sent without a non-empty tools array.
      const requestParams = {
        model: this.config.model,
        max_tokens: this.config.maxTokens ?? 8192,
        temperature: this.config.temperature ?? 0.2,
        messages: messages as Groq.Chat.ChatCompletionMessageParam[],
        stream: true as const,
        ...(hasTools && {
          tools: this.registry.toGroqSchemas(),
          tool_choice: "auto" as const,
        }),
      };

      let stream: AsyncIterable<Groq.Chat.ChatCompletionChunk>;
      try {
        stream = await this.client.chat.completions.create(
          requestParams
        ) as unknown as AsyncIterable<Groq.Chat.ChatCompletionChunk>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onEvent({ type: "error", message: `API error: ${msg}`, fatal: true });
        onEvent({ type: "turn_complete" });
        return;
      }

      // 4. Collect the streaming response: accumulate text and tool calls.
      const { text, toolCalls, finishReason, totalTokens } =
        await this.collectStream(stream, onEvent, signal);

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 && {
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.argumentsJson },
          })),
        }),
      };
      this.history.push(assistantMsg);

      if (text && this.sessionId) {
        await this.persistMessage({ role: "assistant", content: text });
      }

      // 5. No tool calls (or explicit stop) means the model is done.
      if (toolCalls.length === 0 || finishReason === "stop") {
        onEvent({ type: "turn_complete", totalTokens });
        return;
      }

      // 6. Execute tool calls, append results to history, then loop.
      await this.executeToolCalls(toolCalls, onEvent, confirmTool, signal);
    }

    onEvent({
      type: "error",
      message: `Reached maximum iterations (${this.config.maxIterations}).`,
    });
    onEvent({ type: "turn_complete" });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildMessages(systemPrompt: string): ChatMessage[] {
    // Keep only the most recent N messages to avoid context overflow.
    const trimmed =
      this.history.length > MAX_HISTORY_MESSAGES
        ? this.history.slice(-MAX_HISTORY_MESSAGES)
        : this.history;
    return [{ role: "system", content: systemPrompt }, ...trimmed];
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
    const accumulator: Record<number, AccumulatedToolCall> = {};
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

      // Accumulate streamed tool call fragments by their index.
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls as Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>) {
          if (!accumulator[tc.index]) {
            accumulator[tc.index] = { id: "", name: "", argumentsJson: "", index: tc.index };
          }
          const acc = accumulator[tc.index]!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.argumentsJson += tc.function.arguments;
        }
      }

      // Groq includes usage on the final chunk when stream_options.include_usage is set.
      const withUsage = chunk as Groq.Chat.ChatCompletionChunk & {
        usage?: { total_tokens: number };
      };
      if (withUsage.usage) totalTokens = withUsage.usage.total_tokens;
    }

    return {
      text,
      toolCalls: Object.values(accumulator).sort((a, b) => a.index - b.index),
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
    // Separate destructive tools — they run sequentially so the user can confirm each.
    const safe = toolCalls.filter((tc) => !this.registry.isDestructive(tc.name));
    const destructive = toolCalls.filter((tc) => this.registry.isDestructive(tc.name));

    const safeResults = await Promise.all(
      safe.map((tc) => this.executeSingleTool(tc, onEvent, confirmTool, signal))
    );

    const destructiveResults: ChatMessage[] = [];
    for (const tc of destructive) {
      destructiveResults.push(
        await this.executeSingleTool(tc, onEvent, confirmTool, signal)
      );
    }

    // Re-insert results in the original call order so the model sees them correctly.
    const byCallId = new Map<string, ChatMessage>();
    for (const msg of [...safeResults, ...destructiveResults]) {
      if (msg.role === "tool") byCallId.set(msg.tool_call_id, msg);
    }
    for (const tc of toolCalls) {
      const msg = byCallId.get(tc.id);
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
      // Malformed JSON from the model — treat as empty input.
      input = {};
    }

    onEvent({ type: "tool_call", toolName: tc.name, input, callId: tc.id });

    // Ask for confirmation before running destructive tools if the user opted in.
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

    onEvent({ type: "tool_result", toolName: tc.name, result, callId: tc.id });

    if (this.sessionId) {
      await this.persistMessage({
        role: "tool",
        content: result.content,
        toolName: tc.name,
        toolCallId: tc.id,
        isError: result.isError,
      }).catch(() => undefined);
    }

    return { role: "tool", tool_call_id: tc.id, name: tc.name, content: result.content };
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
}