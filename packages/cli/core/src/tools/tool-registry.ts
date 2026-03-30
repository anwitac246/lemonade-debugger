/**
 * ToolRegistry is the single place that maps tool names to executors.
 *
 * The agent queries this registry to:
 *  1. Build the tool schema list sent to the LLM on every request.
 *  2. Dispatch tool calls returned by the LLM.
 *
 * Keeping registration separate from the agent loop means adding a new tool
 * is a one-line change here, with zero agent code changes.
 */

import type { ToolDefinition, ToolResult } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<unknown>>();

  register(tool: ToolDefinition<unknown>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: ToolDefinition<unknown>[]): this {
    tools.forEach((t) => this.register(t));
    return this;
  }

  get(name: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Returns the schema array expected by the Anthropic messages API. */
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

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    return tool.execute(input);
  }

  isDestructive(name: string): boolean {
    const tool = this.tools.get(name) as (ToolDefinition<unknown> & { destructive?: boolean }) | undefined;
    return tool?.destructive === true;
  }
}
