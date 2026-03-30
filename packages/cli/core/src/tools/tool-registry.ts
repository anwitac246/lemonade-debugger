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

  /** Anthropic schema format (kept for reference, unused now) */
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

  /**
   * Groq / OpenAI function-calling schema format.
   * Groq expects: { type:"function", function:{ name, description, parameters } }
   * where parameters is a standard JSON Schema object.
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

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    return tool.execute(input);
  }

  isDestructive(name: string): boolean {
    const tool = this.tools.get(name) as
      | (ToolDefinition<unknown> & { destructive?: boolean })
      | undefined;
    return tool?.destructive === true;
  }
}