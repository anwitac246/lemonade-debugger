/**
 * Agent: ReAct loop backed by Groq streaming API.
 * Now with MongoDB persistence, proper error recovery,
 * and clean session lifecycle.
 */

import Groq from "groq-sdk";
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

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export class Agent {
  private client: Groq;
  private history: ChatMessage[] = [];
  private sessionId?: string;

  constructor(
    private readonly config: AgentConfig,
    private readonly registry: ToolRegistry
  ) {
    this.client = new Groq({ apiKey: config.apiKey });
  }

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** Reload history from DB for a given session. */
  async loadSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    const stored = await getMessages(sessionId);
    this.history = stored
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }

  async run(options: AgentRunOptions): Promise<void> {
    const { userMessage, onEvent, confirmTool } = options;

    this.history.push({ role: "user", content: userMessage });

    if (this.sessionId) {
      await saveMessage({
        sessionId: this.sessionId,
        role: "user",
        content: userMessage,
      });
      await touchSession(this.sessionId);
    }

    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(this.registry.names()) },
        ...this.history,
      ];

      let stream: AsyncIterable<Groq.Chat.ChatCompletionChunk>;
      try {
        stream = await this.client.chat.completions.create({
          model: this.config.model,
          max_tokens: 8192,
          tools: this.registry.toGroqSchemas(),
          tool_choice: "auto",
          messages: messages as Groq.Chat.ChatCompletionMessageParam[],
          stream: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onEvent({ type: "error", message: `Groq API error: ${msg}` });
        onEvent({ type: "turn_complete" });
        return;
      }

      let accumulatedText = "";
      const toolCallAccumulator: Record<
        number,
        { id: string; name: string; argumentsJson: string }
      > = {};
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

        if (delta.content) {
          accumulatedText += delta.content;
          onEvent({ type: "text_delta", delta: delta.content });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls as Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>) {
            if (!toolCallAccumulator[tc.index]) {
              toolCallAccumulator[tc.index] = { id: "", name: "", argumentsJson: "" };
            }
            const acc = toolCallAccumulator[tc.index]!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.argumentsJson += tc.function.arguments;
          }
        }
      }

      const toolCalls = Object.values(toolCallAccumulator);
      const hasToolCalls = toolCalls.length > 0;

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: accumulatedText || null,
        ...(hasToolCalls
          ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.argumentsJson },
              })),
            }
          : {}),
      };
      this.history.push(assistantMessage);

      if (accumulatedText && this.sessionId) {
        await saveMessage({
          sessionId: this.sessionId,
          role: "assistant",
          content: accumulatedText,
        });
      }

      if (!hasToolCalls || finishReason === "stop") {
        onEvent({ type: "turn_complete" });
        return;
      }

      for (const tc of toolCalls) {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(tc.argumentsJson || "{}") as Record<string, unknown>;
        } catch {
          input = {};
        }

        onEvent({ type: "tool_call", toolName: tc.name, input });

        if (this.config.requireConfirmation && this.registry.isDestructive(tc.name)) {
          const approved = await confirmTool?.(tc.name, input);
          if (!approved) {
            const declined = "User declined to run this tool.";
            this.history.push({ role: "tool", tool_call_id: tc.id, content: declined });
            onEvent({
              type: "tool_result",
              toolName: tc.name,
              result: { content: declined, isError: true },
            });
            continue;
          }
        }

        const result = await this.registry.execute(tc.name, input);
        onEvent({ type: "tool_result", toolName: tc.name, result });

        this.history.push({ role: "tool", tool_call_id: tc.id, content: result.content });

        if (this.sessionId) {
          await saveMessage({
            sessionId: this.sessionId,
            role: "tool",
            content: result.content,
            toolName: tc.name,
            isError: result.isError,
          });
        }
      }
    }

    onEvent({
      type: "error",
      message: `Agent hit the maximum iteration limit (${this.config.maxIterations}).`,
    });
    onEvent({ type: "turn_complete" });
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
}