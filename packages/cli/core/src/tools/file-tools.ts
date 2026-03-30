/**
 * Filesystem tools: read_file and search_code.
 *
 * These are intentionally narrow – they read, never write. Mutation tools
 * (run_shell_command) are separate so the confirmation gate can apply
 * selectively to destructive operations.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ToolDefinition, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

// ─── read_file ───────────────────────────────────────────────────────────────

interface ReadFileInput {
  path: string;
  /** Optional line range to avoid sending huge files to the LLM. */
  startLine?: number;
  endLine?: number;
}

export const readFileTool: ToolDefinition<ReadFileInput> = {
  name: "read_file",
  description:
    "Read the contents of a file on disk. Supports optional line-range slicing to avoid " +
    "overwhelming the context window with large files.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file." },
      startLine: { type: "number", description: "1-indexed start line (inclusive). Omit to start from beginning." },
      endLine: { type: "number", description: "1-indexed end line (inclusive). Omit to read to end of file." },
    },
    required: ["path"],
  },

  async execute(input: ReadFileInput): Promise<ToolResult> {
    try {
      const resolved = path.resolve(input.path);
      const raw = await fs.readFile(resolved, "utf-8");
      const lines = raw.split("\n");
      const total = lines.length;

      const start = Math.max(0, (input.startLine ?? 1) - 1);
      const end = Math.min(total, input.endLine ?? total);
      const sliced = lines.slice(start, end);

      // Prefix line numbers so the LLM can reference them precisely.
      const numbered = sliced
        .map((line, i) => `${String(start + i + 1).padStart(4, " ")} | ${line}`)
        .join("\n");

      // Use explicit undefined checks instead of truthiness – startLine=0 is
      // technically valid and would falsely fall through with `||`.
      const header =
        input.startLine !== undefined || input.endLine !== undefined
          ? `[${resolved}] lines ${start + 1}–${end} of ${total}\n\n`
          : `[${resolved}] ${total} lines\n\n`;

      return { content: header + numbered, isError: false };
    } catch (err) {
      return { content: `Failed to read file: ${(err as Error).message}`, isError: true };
    }
  },
};

// ─── search_code ─────────────────────────────────────────────────────────────

interface SearchCodeInput {
  pattern: string;
  /** Directory to search in. Defaults to cwd. */
  directory?: string;
  /** Glob pattern to restrict file types, e.g. "*.ts". */
  fileGlob?: string;
  /** Maximum number of matching lines to return. Prevents huge outputs. */
  maxResults?: number;
}

/**
 * Extracted as a module-level function rather than a method on the tool object
 * literal. ToolDefinition<SearchCodeInput> does not declare fallbackGrep, so
 * adding it inline triggers TS2353 (excess property check).
 */
async function fallbackGrep(
  pattern: string,
  dir: string,
  maxResults: number
): Promise<ToolResult> {
  try {
    const { stdout } = await execFileAsync(
      "grep",
      ["-rn", "--include=*", "-m", String(maxResults), pattern, dir],
      { maxBuffer: 2 * 1024 * 1024 }
    );
    return { content: stdout.trim() || "No matches found.", isError: false };
  } catch (err: unknown) {
    // grep exits with numeric code 1 for "no matches" – normalise with Number()
    // because NodeJS.ErrnoException.code is typed as string | undefined,
    // and a direct `=== 1` comparison (string vs number) would be TS2367.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== undefined && Number(code) === 1) {
      return { content: "No matches found.", isError: false };
    }
    return { content: `Grep fallback failed: ${(err as Error).message}`, isError: true };
  }
}

export const searchCodeTool: ToolDefinition<SearchCodeInput> = {
  name: "search_code",
  description:
    "Search for a regex pattern across source files using ripgrep (rg). " +
    "Use this to locate function definitions, usages, or any string/pattern in the codebase. " +
    "Prefer this over read_file when you don't know which file contains the symbol.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for." },
      directory: { type: "string", description: "Root directory to search. Defaults to current working directory." },
      fileGlob: { type: "string", description: "Limit search to files matching this glob, e.g. '*.ts'." },
      maxResults: { type: "number", description: "Cap results at this many lines. Default 50." },
    },
    required: ["pattern"],
  },

  async execute(input: SearchCodeInput): Promise<ToolResult> {
    const dir = input.directory ? path.resolve(input.directory) : process.cwd();
    const maxResults = input.maxResults ?? 50;

    const args = [
      "--line-number",
      "--color=never",
      "--max-count=1",         // one match per line
      "-m", String(maxResults),
      input.pattern,
      dir,
    ];

    if (input.fileGlob) {
      args.unshift("--glob", input.fileGlob);
    }

    try {
      const { stdout } = await execFileAsync("rg", args, { maxBuffer: 2 * 1024 * 1024 });
      const trimmed = stdout.trim();
      if (!trimmed) return { content: "No matches found.", isError: false };

      return {
        content: `Search results for \`${input.pattern}\` in ${dir}:\n\n${trimmed}`,
        isError: false,
      };
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;

      // rg exits with numeric code 1 for "no matches". NodeJS.ErrnoException.code
      // is typed as string | undefined, so we normalise with Number() to avoid
      // the string-vs-number overlap error (TS2367).
      if (nodeErr.code !== undefined && Number(nodeErr.code) === 1) {
        return { content: "No matches found.", isError: false };
      }

      // rg not installed – fall back to grep.
      if (nodeErr.code === "ENOENT") {
        return fallbackGrep(input.pattern, dir, maxResults);
      }

      return { content: `Search failed: ${(err as Error).message}`, isError: true };
    }
  },
};
