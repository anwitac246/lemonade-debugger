/**
 * DAP tool definitions — thin adapters between LLM JSON input and DAPSession.
 *
 * Each function is a factory that closes over the shared DAPSession instance.
 * Schemas are kept intentionally flat so Groq's function-calling API accepts them.
 */

import type { ToolDefinition, ToolResult, DAPStackFrame, DAPVariable } from "../types.js";
import type { DAPSession } from "../dap/dap-session.js";

// ─── start_debugger ───────────────────────────────────────────────────────────

interface StartDebuggerInput {
  file: string;
  language: string;
  args?: string[];
  stopOnEntry?: boolean;
}

export function makeStartDebuggerTool(session: DAPSession): ToolDefinition<StartDebuggerInput> {
  return {
    name: "start_debugger",
    description:
      "Launch a debug adapter for the given source file and pause at entry. " +
      "Only use when you need LIVE runtime state — prefer read_file and search_code first.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Absolute path to the source file to debug.",
        },
        language: {
          type: "string",
          // Groq accepts enum as a plain array inside the property object.
          enum: ["python", "node", "go", "rust", "java"],
          description: "Language runtime — determines which debug adapter to launch.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional command-line arguments passed to the program.",
        },
        stopOnEntry: {
          type: "boolean",
          description: "Pause immediately on program start. Default: true.",
        },
      },
      required: ["file", "language"],
    },

    async execute(input): Promise<ToolResult> {
      try {
        const message = await session.start(
          input.file,
          input.language as "python" | "node" | "go" | "rust" | "java",
          input.args,
          input.stopOnEntry ?? true
        );
        return { content: message, isError: false };
      } catch (err) {
        return { content: `start_debugger failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── set_breakpoint ───────────────────────────────────────────────────────────

interface SetBreakpointInput {
  file: string;
  line: number;
  condition?: string;
  logMessage?: string;
}

export function makeSetBreakpointTool(session: DAPSession): ToolDefinition<SetBreakpointInput> {
  return {
    name: "set_breakpoint",
    description:
      "Set a breakpoint at a specific file and line in the active debug session. " +
      "Optionally provide a condition expression or a log message.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Absolute path to the source file.",
        },
        line: {
          type: "number",
          description: "1-indexed line number to break at.",
        },
        condition: {
          type: "string",
          description: "Break only when this expression evaluates to true.",
        },
        logMessage: {
          type: "string",
          description: "Log this message instead of pausing execution.",
        },
      },
      required: ["file", "line"],
    },

    async execute(input): Promise<ToolResult> {
      try {
        await session.setBreakpoint(input.file, input.line, {
          condition: input.condition,
          logMessage: input.logMessage,
        });
        const suffix = input.condition ? ` (condition: ${input.condition})` : "";
        return {
          content: `Breakpoint set at ${input.file}:${input.line}${suffix}`,
          isError: false,
        };
      } catch (err) {
        return { content: `set_breakpoint failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── get_stack_trace ──────────────────────────────────────────────────────────

export function makeGetStackTraceTool(session: DAPSession): ToolDefinition<Record<never, never>> {
  return {
    name: "get_stack_trace",
    description:
      "Return the current call stack of the paused program. " +
      "Each frame includes its frameId, function name, source file, and line number. " +
      "Pass frameId to get_variables to inspect locals at that frame.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },

    async execute(): Promise<ToolResult> {
      try {
        const frames: DAPStackFrame[] = await session.getStackTrace();

        if (frames.length === 0) {
          return {
            content: "No stack frames — is a debug session active and paused?",
            isError: false,
          };
        }

        const formatted = frames
          .map(
            (f, i) =>
              `#${i} frameId=${f.id}  ${f.name}  ` +
              `${f.source?.path ?? f.source?.name ?? "<unknown>"}:${f.line}:${f.column}`
          )
          .join("\n");

        return { content: `Stack trace (${frames.length} frames):\n${formatted}`, isError: false };
      } catch (err) {
        return { content: `get_stack_trace failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── get_variables ────────────────────────────────────────────────────────────

interface GetVariablesInput {
  frameId: number;
  filter?: string;
}

export function makeGetVariablesTool(session: DAPSession): ToolDefinition<GetVariablesInput> {
  return {
    name: "get_variables",
    description:
      "List all local variables and their values in the given stack frame. " +
      "Get frameId from get_stack_trace. Optionally filter by variable name substring.",
    inputSchema: {
      type: "object",
      properties: {
        frameId: {
          type: "number",
          description: "Stack frame ID obtained from get_stack_trace.",
        },
        filter: {
          type: "string",
          description: "Optional substring to filter variable names.",
        },
      },
      required: ["frameId"],
    },

    async execute(input): Promise<ToolResult> {
      try {
        let vars: DAPVariable[] = await session.getVariables(input.frameId);

        if (input.filter) {
          const lower = input.filter.toLowerCase();
          vars = vars.filter((v) => v.name.toLowerCase().includes(lower));
        }

        if (vars.length === 0) {
          return {
            content: input.filter
              ? `No variables matching '${input.filter}' in frame ${input.frameId}.`
              : `No variables in frame ${input.frameId}.`,
            isError: false,
          };
        }

        const formatted = vars
          .map(
            (v) =>
              `${v.name}: ${v.type ? `(${v.type}) ` : ""}${v.value}` +
              (v.variablesReference > 0 ? "  [expandable]" : "")
          )
          .join("\n");

        return {
          content: `Variables in frame ${input.frameId}:\n${formatted}`,
          isError: false,
        };
      } catch (err) {
        return { content: `get_variables failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

// ─── continue_execution ───────────────────────────────────────────────────────

interface ContinueExecutionInput {
  timeoutSeconds?: number;
}

export function makeContinueExecutionTool(
  session: DAPSession
): ToolDefinition<ContinueExecutionInput> {
  return {
    name: "continue_execution",
    description:
      "Resume execution of the paused program until the next breakpoint, " +
      "exception, or program exit. Returns the stop reason.",
    inputSchema: {
      type: "object",
      properties: {
        timeoutSeconds: {
          type: "number",
          description: "Seconds to wait for the next stop event. Default: 30.",
        },
      },
      required: [],
    },

    async execute(input): Promise<ToolResult> {
      try {
        const message = await session.continueExecution(
          (input.timeoutSeconds ?? 30) * 1000
        );
        return { content: message, isError: false };
      } catch (err) {
        return { content: `continue_execution failed: ${(err as Error).message}`, isError: true };
      }
    },
  };
}