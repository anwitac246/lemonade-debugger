/**
 * Shell execution tool.
 *
 * We deliberately keep this as a single, general-purpose tool rather than
 * wrapping every Unix command individually. The LLM knows how to compose
 * shell commands; our job is to execute safely (timeout, output cap) and
 * present results clearly.
 *
 * This tool is marked `destructive = true` so the confirmation gate in the
 * agent loop can intercept it when the user has opted in to confirmations.
 */

import { exec } from "child_process";
import type { ToolDefinition, ToolResult } from "../types.js";

interface ShellCommandInput {
  command: string;
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Timeout in seconds. Default 30. Hard cap at 120. */
  timeoutSeconds?: number;
}

const MAX_OUTPUT_CHARS = 8_000;
const DEFAULT_TIMEOUT_S = 30;
const HARD_CAP_TIMEOUT_S = 120;

export const runShellCommandTool: ToolDefinition<ShellCommandInput> & { destructive: boolean } = {
  name: "run_shell_command",
  description:
    "Execute an arbitrary shell command and return stdout + stderr. " +
    "Use for running tests, compiling code, inspecting process output, or any " +
    "operation that cannot be done via file reads alone. " +
    "WARNING: This tool can modify system state. The user may be prompted to confirm.",
  destructive: true,
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
      cwd: { type: "string", description: "Working directory for the command." },
      timeoutSeconds: {
        type: "number",
        description: `Max seconds to wait. Default ${DEFAULT_TIMEOUT_S}, max ${HARD_CAP_TIMEOUT_S}.`,
      },
    },
    required: ["command"],
  },

  async execute(input: ShellCommandInput): Promise<ToolResult> {
    const cwd = input.cwd ?? process.cwd();
    const timeout =
      Math.min(input.timeoutSeconds ?? DEFAULT_TIMEOUT_S, HARD_CAP_TIMEOUT_S) * 1000;

    return new Promise((resolve) => {
      const child = exec(input.command, { cwd, timeout }, (error, stdout, stderr) => {
        const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
        const truncated =
          combined.length > MAX_OUTPUT_CHARS
            ? combined.slice(0, MAX_OUTPUT_CHARS) +
              `\n\n[Output truncated – ${combined.length - MAX_OUTPUT_CHARS} chars omitted]`
            : combined;

        if (error && !error.killed) {
          // Non-zero exit is not necessarily fatal – tests fail, linters warn, etc.
          resolve({
            content: `Exit code ${error.code ?? "unknown"}\n\n${truncated}`,
            isError: true,
          });
        } else if (error?.killed) {
          resolve({
            content: `Command timed out after ${timeout / 1000}s.\n\n${truncated}`,
            isError: true,
          });
        } else {
          resolve({ content: truncated || "(no output)", isError: false });
        }
      });

      // Ensure the child is cleaned up even if the node process exits.
      process.on("exit", () => child.kill());
    });
  },
};
