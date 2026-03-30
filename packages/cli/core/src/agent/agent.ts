/**
 * Agent: ReAct loop backed by Groq's OpenAI-compatible API.
 *
 * Groq uses the same request/response shape as OpenAI:
 *  - tools are passed as { type:"function", function:{name,description,parameters} }
 *  - tool calls come back in message.tool_calls[]
 *  - tool results are fed back as role:"tool" messages
 *
 * We stream so text deltas reach the UI immediately, but we buffer the full
 * assistant message before dispatching tool calls – Groq streams the tool-call
 * JSON incrementally in delta.tool_calls[].function.arguments.
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

// Groq message types (OpenAI-compatible)
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

  constructor(
    private readonly config: AgentConfig,
    private readonly registry: ToolRegistry
  ) {
    this.client = new Groq({ apiKey: config.apiKey });
  }

  async run(options: AgentRunOptions): Promise<void> {
    const { userMessage, onEvent, confirmTool } = options;

    this.history.push({ role: "user", content: userMessage });

    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(this.registry.names()) },
        ...this.history,
      ];

      // ── Stream the response ──────────────────────────────────────────────
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        max_tokens: 8192,
        tools: this.registry.toGroqSchemas(),
        tool_choice: "auto",
        messages: messages as Groq.Chat.ChatCompletionMessageParam[],
        stream: true,
      });

      // Accumulate the full assistant message while streaming text to UI.
      let accumulatedText = "";
      // tool_calls are indexed by their position in the array – Groq sends
      // index in each delta so we can reconstruct them in order.
      const toolCallAccumulator: Record<
        number,
        { id: string; name: string; argumentsJson: string }
      > = {};
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;

        // Stream text content to UI
        if (delta.content) {
          accumulatedText += delta.content;
          onEvent({ type: "text_delta", delta: delta.content });
        }

        // Accumulate tool call fragments
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallAccumulator[tc.index]) {
              toolCallAccumulator[tc.index] = {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                argumentsJson: "",
              };
            }
            if (tc.id) toolCallAccumulator[tc.index]!.id = tc.id;
            if (tc.function?.name) toolCallAccumulator[tc.index]!.name = tc.function.name;
            if (tc.function?.arguments) {
              toolCallAccumulator[tc.index]!.argumentsJson += tc.function.arguments;
            }
          }
        }
      }

      const toolCalls = Object.values(toolCallAccumulator);
      const hasToolCalls = toolCalls.length > 0;

      // Record the assistant turn in history
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

      // ── No tool calls → done ─────────────────────────────────────────────
      if (!hasToolCalls || finishReason === "stop") {
        onEvent({ type: "turn_complete" });
        return;
      }

      // ── Execute tool calls ───────────────────────────────────────────────
      for (const tc of toolCalls) {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(tc.argumentsJson || "{}") as Record<string, unknown>;
        } catch {
          input = {};
        }

        onEvent({ type: "tool_call", toolName: tc.name, input });

        // Confirmation gate for destructive tools
        if (this.config.requireConfirmation && this.registry.isDestructive(tc.name)) {
          const approved = await confirmTool?.(tc.name, input);
          if (!approved) {
            this.history.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "User declined to run this tool.",
            });
            onEvent({
              type: "tool_result",
              toolName: tc.name,
              result: { content: "User declined to run this tool.", isError: true },
            });
            continue;
          }
        }

        const result = await this.registry.execute(tc.name, input);
        onEvent({ type: "tool_result", toolName: tc.name, result });

        // Each tool result is its own "tool" role message
        this.history.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.content,
        });
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
    const result: ConversationMessage[] = [];
    for (const message of this.history) {
      if (
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
      ) {
        result.push({
          role: message.role,
          content: message.content,
        });
      }
    }
    return result;
  }
}