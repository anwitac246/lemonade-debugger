/**
 * ToolRegistry — Central registry for all agent tools.
 *
 * Responsibilities:
 * - Registration with duplicate detection
 * - Schema serialization (Groq / OpenAI format)
 * - Execution with timeout and error wrapping
 * - Destructive flag tracking
 */

import type { ToolDefinition, ToolResult } from "../types.js";

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown>>();

  // ── Registration ────────────────────────────────────────────────────────────

  register(tool: ToolDefinition<unknown>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(
        `Tool already registered: "${tool.name}". ` +
          `Rename one of them to avoid conflicts.`
      );
    }

    // Normalize inputSchema at registration time so all downstream serializers
    // (Groq, Anthropic, etc.) always receive a valid JSON Schema object.
    // Groq strictly requires { type: "object", properties: {} } at the top level.
    const normalizedTool: ToolDefinition<unknown> = {
      ...tool,
      inputSchema: {
        type: "object",
        properties: {},
        ...tool.inputSchema,
      },
    };

    this.tools.set(tool.name, normalizedTool);
    return this;
  }

  registerAll(tools: ToolDefinition<unknown>[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  get(name: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  size(): number {
    return this.tools.size;
  }

  // ── Schema serialization ────────────────────────────────────────────────────

  /**
   * Groq / OpenAI function-calling format.
   */
  toGroqSchemas(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  /**
   * Anthropic tool format (for future migration).
   */
  toAnthropicSchemas(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  async execute(
    name: string,
    input: unknown,
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Unknown tool: "${name}". Available tools: ${this.names().join(", ")}`,
        isError: true,
      };
    }

    try {
      const resultPromise = tool.execute(input);
      const timeoutPromise = new Promise<ToolResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      );

      return await Promise.race([resultPromise, timeoutPromise]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Tool "${name}" threw an error: ${message}`,
        isError: true,
      };
    }
  }

  // ── Flags ───────────────────────────────────────────────────────────────────

  isDestructive(name: string): boolean {
    const tool = this.tools.get(name) as
      | (ToolDefinition<unknown> & { destructive?: boolean })
      | undefined;
    return tool?.destructive === true;
  }
}