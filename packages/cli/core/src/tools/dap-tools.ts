/**
 * DAP tool definitions.
 *
 * Each tool is a thin adapter between the LLM's JSON input and the DAPSession
 * API. The session is a shared singleton passed in at construction time – this
 * avoids the tools needing to know about connection lifecycle.
 *
 * Why closures over classes? A ToolDefinition is a plain object so it can be
 * serialized for the API schema. Closures give us the session reference without
 * fighting TypeScript's structural typing.
 */

import type { ToolDefinition, ToolResult, DAPStackFrame, DAPVariable } from "../types.js";
import type { DAPSession } from "../dap/dap-session.js";

type Language = "python" | "node" | "go";

// ─── start_debugger ───────────────────────────────────────────────────────────

interface StartDebuggerInput {
  file: string;
  language: Language;
}

export function makeStartDebuggerTool(session: DAPSession): ToolDefinition<StartDebuggerInput> {
  return {
    name: "start_debugger",
    description:
      "Launch a debug adapter for the given source file and connect to it. " +
      "The program stops at entry. Call this only when runtime data is essential – " +
      "prefer static analysis tools first.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Absolute path to the file to debug." },
        language: {
          type: "string",
          enum: ["python", "node", "go"],
          description: "Language of the file. Determines which debug adapter to use.",
        },
      },
      required: ["file", "language"],
    },

    async execute(input: StartDebuggerInput): Promise<ToolResult> {
      try {
        const message = await session.start(input.file, input.language);
        return { content: message, isError: false };
      } catch (err) {
        return { content: `Failed to start debugger: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── get_stack_trace ──────────────────────────────────────────────────────────

export function makeGetStackTraceTool(session: DAPSession): ToolDefinition<Record<never, never>> {
  return {
    name: "get_stack_trace",
    description:
      "Return the current call stack of the paused program. Each frame includes " +
      "a frameId, function name, source file, and line number. Use frameId with " +
      "get_variables to inspect local variables at that frame.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },

    async execute(): Promise<ToolResult> {
      try {
        const frames: DAPStackFrame[] = await session.getStackTrace();
        if (frames.length === 0) {
          return { content: "No stack frames available.", isError: false };
        }

        const formatted = frames
          .map(
            (f, i) =>
              `#${i} frameId=${f.id}  ${f.name}  ` +
              `${f.source?.path ?? f.source?.name ?? "<unknown>"}:${f.line}`
          )
          .join("\n");

        return { content: `Stack trace:\n${formatted}`, isError: false };
      } catch (err) {
        return { content: `get_stack_trace failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── get_variables ────────────────────────────────────────────────────────────

interface GetVariablesInput {
  frameId: number;
}

export function makeGetVariablesTool(session: DAPSession): ToolDefinition<GetVariablesInput> {
  return {
    name: "get_variables",
    description:
      "List all local variables and their values in the given stack frame. " +
      "Obtain the frameId from get_stack_trace.",
    inputSchema: {
      type: "object",
      properties: {
        frameId: { type: "number", description: "Stack frame ID from get_stack_trace." },
      },
      required: ["frameId"],
    },

    async execute(input: GetVariablesInput): Promise<ToolResult> {
      try {
        const vars: DAPVariable[] = await session.getVariables(input.frameId);
        if (vars.length === 0) {
          return { content: "No variables in this frame.", isError: false };
        }

        const formatted = vars
          .map((v) => `${v.name}: ${v.type ? `(${v.type}) ` : ""}${v.value}`)
          .join("\n");

        return { content: `Variables in frame ${input.frameId}:\n${formatted}`, isError: false };
      } catch (err) {
        return { content: `get_variables failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── continue_execution ───────────────────────────────────────────────────────

export function makeContinueExecutionTool(session: DAPSession): ToolDefinition<Record<never, never>> {
  return {
    name: "continue_execution",
    description:
      "Resume execution of the paused program until the next breakpoint, " +
      "exception, or program exit.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },

    async execute(): Promise<ToolResult> {
      try {
        const message = await session.continueExecution();
        return { content: message, isError: false };
      } catch (err) {
        return { content: `continue_execution failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}
