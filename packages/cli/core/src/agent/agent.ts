/**
 * Agent: the ReAct (Reason → Act → Observe) loop.
 *
 * Architecture contract:
 *  - The agent knows nothing about the CLI rendering layer.
 *  - All progress is emitted as AgentEvent so the CLI can react without
 *    coupling to LLM SDK types.
 *  - The loop runs until the LLM produces a stop_reason of "end_turn"
 *    (no more tool calls), or until maxIterations is hit (safety valve
 *    against infinite loops caused by a confused model).
 *
 * Why Anthropic's tool_use API rather than function calling?
 *  Anthropic's tool_use produces structured JSON input reliably and allows
 *  streaming text while tool calls are pending, which gives a better UX than
 *  waiting for the full response before showing anything.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentConfig,
  AgentRunOptions,
  AgentEvent,
  ConversationMessage,
} from "../types.js";
import { buildSystemPrompt } from "../prompt/system-prompt.js";
import { ToolRegistry } from "../tools/tool-registry.js";

type AnthropicMessage = Anthropic.MessageParam;

export class Agent {
  private client: Anthropic;
  private history: AnthropicMessage[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly registry: ToolRegistry
  ) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  /**
   * Process one user turn. May execute multiple tool calls internally
   * before emitting turn_complete.
   */
  async run(options: AgentRunOptions): Promise<void> {
    const { userMessage, onEvent, confirmTool } = options;

    // Append the new user turn to persistent history.
    this.history.push({ role: "user", content: userMessage });

    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      // ── Stream the LLM response ──────────────────────────────────────────
      const stream = await this.client.messages.stream({
        model: this.config.model,
        max_tokens: 8192,
        system: buildSystemPrompt(this.registry.names()),
        tools: this.registry.toAnthropicSchemas(),
        messages: this.history,
      });

      // Collect streamed content blocks while forwarding text deltas to UI.
      const contentBlocks: Anthropic.ContentBlock[] = [];
      let currentText = "";
      let currentToolUse: {
        id: string;
        name: string;
        inputJson: string;
      } | null = null;

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            };
          } else if (event.content_block.type === "text") {
            currentText = "";
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            currentText += event.delta.text;
            onEvent({ type: "text_delta", delta: event.delta.text });
          } else if (event.delta.type === "input_json_delta" && currentToolUse) {
            currentToolUse.inputJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolUse) {
            const input = JSON.parse(currentToolUse.inputJson || "{}") as Record<string, unknown>;
            contentBlocks.push({
              type: "tool_use",
              id: currentToolUse.id,
              name: currentToolUse.name,
              input,
            });
            currentToolUse = null;
          } else if (currentText !== "") {
            contentBlocks.push({ type: "text", text: currentText });
            currentText = "";
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      const stopReason = finalMessage.stop_reason;

      // Record the assistant's turn in history.
      this.history.push({ role: "assistant", content: contentBlocks });

      // ── No tool calls → we're done ───────────────────────────────────────
      if (stopReason !== "tool_use") {
        onEvent({ type: "turn_complete" });
        return;
      }

      // ── Execute all tool calls in this turn ──────────────────────────────
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of contentBlocks) {
        if (block.type !== "tool_use") continue;

        const toolInput = block.input as Record<string, unknown>;
        onEvent({ type: "tool_call", toolName: block.name, input: toolInput });

        // Confirmation gate: only prompt for destructive tools when opted-in.
        if (this.config.requireConfirmation && this.registry.isDestructive(block.name)) {
          const approved = await confirmTool?.(block.name, toolInput);
          if (!approved) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: "User declined to run this tool.",
              is_error: true,
            });
            onEvent({
              type: "tool_result",
              toolName: block.name,
              result: { content: "User declined to run this tool.", isError: true },
            });
            continue;
          }
        }

        const result = await this.registry.execute(block.name, toolInput);
        onEvent({ type: "tool_result", toolName: block.name, result });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }

      // Feed all tool results back as a single user turn so the LLM can
      // reason about them collectively in the next iteration.
      this.history.push({ role: "user", content: toolResults });
    }

    // Safety valve: inform the user and stop rather than looping forever.
    onEvent({
      type: "error",
      message: `Agent hit the maximum iteration limit (${this.config.maxIterations}). The task may be too complex or the model may be stuck.`,
    });
    onEvent({ type: "turn_complete" });
  }

  /** Resets conversation history. Does not affect tool registry or config. */
  clearHistory(): void {
    this.history = [];
  }

  /** Exports history as a portable format for persistence / display. */
  getHistory(): ConversationMessage[] {
    return this.history
      .filter((m): m is { role: "user" | "assistant"; content: string } =>
        typeof m.content === "string"
      )
      .map((m) => ({ role: m.role, content: m.content }));
  }
}
