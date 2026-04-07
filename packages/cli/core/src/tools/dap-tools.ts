/**
 * DAP tool definitions.
 *
 * Thin adapters between LLM JSON input and DAPSession API.
 * Each factory function receives the session as a closure — no class needed.
 */

import type { ToolDefinition, ToolResult, DAPStackFrame, DAPVariable } from "../types.js";
import type { DAPSession } from "../dap/dap-session.js";

type Language = "python" | "node" | "go" | "rust" | "java";

// ─── start_debugger ───────────────────────────────────────────────────────────

interface StartDebuggerInput {
  file: string;
  language: Language;
  args?: string[];
  stopOnEntry?: boolean;
}

export function makeStartDebuggerTool(session: DAPSession): ToolDefinition<StartDebuggerInput> {
  return {
    name: "start_debugger",
    description:
      "Launch a debug adapter for the given source file and connect to it. " +
      "The program pauses at entry by default. Only use when you need LIVE runtime state — " +
      "prefer read_file and search_code first.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Absolute path to the source file to debug.",
        },
        language: {
          type: "string",
          enum: ["python", "node", "go", "rust", "java"],
          description: "Language of the file (determines debug adapter).",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional command-line arguments to pass to the program.",
        },
        stopOnEntry: {
          type: "boolean",
          description: "Whether to pause immediately on start. Default: true.",
        },
      },
      required: ["file", "language"],
    },
    async execute(input): Promise<ToolResult> {
      try {
        const message = await session.start(
          input.file,
          input.language,
          input.args,
          input.stopOnEntry ?? true
        );
        return { content: message, isError: false };
      } catch (err) {
        return {
          content: `Failed to start debugger: ${(err as Error).message}`,
          isError: true,
        };
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
      "Optionally set a condition or log message.",
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
          description: "Optional condition expression (breaks only when true).",
        },
        logMessage: {
          type: "string",
          description: "If set, log this message instead of pausing.",
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
        return {
          content: `Breakpoint set at ${input.file}:${input.line}` +
            (input.condition ? ` (condition: ${input.condition})` : ""),
          isError: false,
        };
      } catch (err) {
        return {
          content: `Failed to set breakpoint: ${(err as Error).message}`,
          isError: true,
        };
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
      "Each frame includes frameId, function name, source file, and line number. " +
      "Use frameId with get_variables to inspect locals at that frame.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(): Promise<ToolResult> {
      try {
        const frames: DAPStackFrame[] = await session.getStackTrace();

        if (frames.length === 0) {
          return { content: "No stack frames available — is a debug session running?", isError: false };
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
        return {
          content: `get_stack_trace failed: ${(err as Error).message}`,
          isError: true,
        };
      }
    },
  };
}

// ─── get_variables ────────────────────────────────────────────────────────────

interface GetVariablesInput {
  frameId: number;
  /** Optionally filter to a specific variable name */
  filter?: string;
}

export function makeGetVariablesTool(session: DAPSession): ToolDefinition<GetVariablesInput> {
  return {
    name: "get_variables",
    description:
      "List all local variables and their values in the given stack frame. " +
      "Obtain frameId from get_stack_trace. Optionally filter by variable name.",
    inputSchema: {
      type: "object",
      properties: {
        frameId: {
          type: "number",
          description: "Stack frame ID from get_stack_trace.",
        },
        filter: {
          type: "string",
          description: "Optional variable name substring to filter results.",
        },
      },
      required: ["frameId"],
    },
    async execute(input): Promise<ToolResult> {
      try {
        let vars: DAPVariable[] = await session.getVariables(input.frameId);

        if (input.filter) {
          const filterLower = input.filter.toLowerCase();
          vars = vars.filter((v) =>
            v.name.toLowerCase().includes(filterLower)
          );
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
        return {
          content: `get_variables failed: ${(err as Error).message}`,
          isError: true,
        };
      }
    },
  };
}

// ─── continue_execution ───────────────────────────────────────────────────────

interface ContinueExecutionInput {
  /** Timeout in seconds to wait for next stop. Default 30. */
  timeoutSeconds?: number;
}

export function makeContinueExecutionTool(session: DAPSession): ToolDefinition<ContinueExecutionInput> {
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
          description: "Max seconds to wait for next stop. Default: 30.",
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
        return {
          content: `continue_execution failed: ${(err as Error).message}`,
          isError: true,
        };
      }
    },
  };
}