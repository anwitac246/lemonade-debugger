/**
 * Shell execution tool.
 *
 * Single general-purpose tool rather than per-command wrappers — the model
 * knows how to compose shell commands; our job is safe execution (timeout,
 * output cap) and clear result formatting.
 *
 * Marked destructive=true so the confirmation gate in the agent loop can
 * intercept it when the user has opted in to confirmations.
 */

import { exec } from "child_process";
import type { ToolDefinition, ToolResult } from "../types.js";

interface ShellCommandInput {
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
}

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_TIMEOUT_S = 30;
const HARD_CAP_TIMEOUT_S = 120;

export const runShellCommandTool: ToolDefinition<ShellCommandInput> & {
  destructive: boolean;
} = {
  name: "run_shell_command",
  description:
    "Execute a shell command and return stdout + stderr. " +
    "Use for running tests, builds, linters, or any operation that cannot be done via file reads. " +
    "WARNING: This tool can modify system state.",
  destructive: true,
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute.",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command. Defaults to process.cwd().",
      },
      timeoutSeconds: {
        type: "number",
        description: `Seconds to wait before killing the process. Default ${DEFAULT_TIMEOUT_S}, max ${HARD_CAP_TIMEOUT_S}.`,
      },
    },
    required: ["command"],
  },

  async execute(input: ShellCommandInput): Promise<ToolResult> {
    const cwd = input.cwd ?? process.cwd();
    const timeoutMs =
      Math.min(input.timeoutSeconds ?? DEFAULT_TIMEOUT_S, HARD_CAP_TIMEOUT_S) * 1000;

    return new Promise((resolve) => {
      const child = exec(input.command, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
        const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

        // Truncate runaway output so we don't blow the context window.
        const truncated =
          combined.length > MAX_OUTPUT_CHARS
            ? combined.slice(0, MAX_OUTPUT_CHARS) +
              `\n\n[Truncated — ${combined.length - MAX_OUTPUT_CHARS} chars omitted]`
            : combined;

        if (error?.killed) {
          resolve({
            content: `Command timed out after ${timeoutMs / 1000}s.\n\n${truncated}`,
            isError: true,
          });
        } else if (error) {
          // Non-zero exit is not always fatal (tests fail, linters warn, etc.)
          resolve({
            content: `Exit code ${error.code ?? "unknown"}\n\n${truncated}`,
            isError: true,
          });
        } else {
          resolve({ content: truncated || "(no output)", isError: false });
        }
      });

      process.on("exit", () => child.kill());
    });
  },
};