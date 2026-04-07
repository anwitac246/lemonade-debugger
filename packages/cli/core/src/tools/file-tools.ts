/**
 * Filesystem tools: read_file and search_code.
 *
 * Read-only by design — mutation lives in shell-tool.ts so the confirmation
 * gate can apply selectively to destructive operations.
 *
 * Schema rules for Groq compatibility:
 * - No `additionalProperties` at the top-level parameters object
 * - All property descriptions must be plain strings (no nested objects)
 * - `required` must be an array of strings that exist in `properties`
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ToolDefinition, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);
const IS_WINDOWS = os.platform() === "win32";

// ─── read_file ────────────────────────────────────────────────────────────────

interface ReadFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
}

/** Detect binary files by scanning for null bytes in the first 8 KB. */
function isBinary(buffer: Buffer): boolean {
  const sample = Math.min(buffer.length, 8000);
  for (let i = 0; i < sample; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export const readFileTool: ToolDefinition<ReadFileInput> = {
  name: "read_file",
  description:
    "Read the contents of a text file on disk. " +
    "Use startLine/endLine to read a specific section of a large file. " +
    "Binary files are rejected. Always prefer reading a focused range over the whole file.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file.",
      },
      startLine: {
        type: "number",
        description: "1-indexed start line (inclusive). Defaults to 1.",
      },
      endLine: {
        type: "number",
        description: "1-indexed end line (inclusive). Defaults to end of file.",
      },
      maxLines: {
        type: "number",
        description: "Max lines to return when no explicit range is set. Default 500.",
      },
    },
    required: ["path"],
  },

  async execute(input: ReadFileInput): Promise<ToolResult> {
    const resolved = path.resolve(input.path);

    // Verify the file exists and is a regular file.
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolved);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return { content: `File not found: ${resolved}`, isError: true };
      if (e.code === "EACCES") return { content: `Permission denied: ${resolved}`, isError: true };
      return { content: `Cannot stat file: ${e.message}`, isError: true };
    }

    if (!stat.isFile()) {
      return {
        content: stat.isDirectory()
          ? `Path is a directory: ${resolved}`
          : `Not a regular file: ${resolved}`,
        isError: true,
      };
    }

    // Guard against reading huge files without a line range.
    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
    if (stat.size > MAX_BYTES) {
      return {
        content:
          `File too large (${(stat.size / 1024).toFixed(0)} KB). ` +
          `Use startLine/endLine to read a specific section.`,
        isError: true,
      };
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolved);
    } catch (err) {
      return { content: `Failed to read: ${(err as Error).message}`, isError: true };
    }

    if (isBinary(buffer)) {
      return { content: `Binary file, cannot read as text: ${resolved}`, isError: true };
    }

    const lines = buffer.toString("utf-8").split("\n");
    const total = lines.length;
    const maxLines = input.maxLines ?? 500;
    const hasExplicitRange = input.startLine !== undefined || input.endLine !== undefined;

    const start = Math.max(0, (input.startLine ?? 1) - 1);
    let end = Math.min(total, input.endLine ?? total);

    // Apply the maxLines cap only when the caller didn't request a specific end.
    if (input.endLine === undefined && end - start > maxLines) {
      end = start + maxLines;
    }

    if (start >= total) {
      return {
        content: `startLine (${input.startLine}) exceeds file length (${total} lines).`,
        isError: true,
      };
    }

    const sliced = lines.slice(start, end);
    const truncated = !hasExplicitRange && end < total;

    // Prefix every line with its number so the model can reference them precisely.
    const numbered = sliced
      .map((line, i) => `${String(start + i + 1).padStart(4, " ")} | ${line}`)
      .join("\n");

    const rangeLabel = hasExplicitRange
      ? `lines ${start + 1}–${end} of ${total}`
      : `${sliced.length} of ${total} lines`;

    const truncationNote = truncated
      ? `\n\n[Truncated at line ${end}. Use startLine/endLine to read more.]`
      : "";

    return {
      content: `[${resolved}] ${rangeLabel}\n\n${numbered}${truncationNote}`,
      isError: false,
    };
  },
};

// ─── search_code ──────────────────────────────────────────────────────────────

interface SearchCodeInput {
  pattern: string;
  directory?: string;
  fileGlob?: string;
  maxResults?: number;
}

async function grepFallback(pattern: string, dir: string, max: number): Promise<ToolResult> {
  try {
    const { stdout } = await execFileAsync("grep", ["-rn", pattern, dir], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const lines = stdout.trim().split("\n").slice(0, max);
    return { content: lines.join("\n") || "No matches found.", isError: false };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e.status === 1) return { content: "No matches found.", isError: false };
    return { content: `grep failed: ${e.message}`, isError: true };
  }
}

async function findstrFallback(pattern: string, dir: string, max: number): Promise<ToolResult> {
  try {
    const { stdout } = await execFileAsync(
      "findstr",
      ["/s", "/n", "/i", "/r", pattern, path.join(dir, "*")],
      { maxBuffer: 2 * 1024 * 1024, shell: false }
    );
    const lines = stdout.trim().split("\n").slice(0, max);
    return { content: lines.join("\n") || "No matches found.", isError: false };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    if (e.status === 1) return { content: "No matches found.", isError: false };
    return { content: `findstr failed: ${e.message}`, isError: true };
  }
}

export const searchCodeTool: ToolDefinition<SearchCodeInput> = {
  name: "search_code",
  description:
    "Search for a regex pattern across source files using ripgrep (rg). " +
    "Falls back to grep on Unix or findstr on Windows if rg is not installed. " +
    "Use this to find function definitions, symbol usages, or any string in the codebase.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for.",
      },
      directory: {
        type: "string",
        description: "Root directory to search. Defaults to current working directory.",
      },
      fileGlob: {
        type: "string",
        description: "Limit search to files matching this glob, e.g. '*.ts'.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of matching lines to return. Default 50.",
      },
    },
    required: ["pattern"],
  },

  async execute(input: SearchCodeInput): Promise<ToolResult> {
    const dir = input.directory ? path.resolve(input.directory) : process.cwd();
    const max = input.maxResults ?? 50;

    try {
      const dirStat = await fs.stat(dir);
      if (!dirStat.isDirectory()) {
        return { content: `Not a directory: ${dir}`, isError: true };
      }
    } catch {
      return { content: `Directory not found: ${dir}`, isError: true };
    }

    const args: string[] = [
      "--line-number",
      "--color=never",
      "--no-heading",
      "-m", String(max),
    ];

    if (input.fileGlob) args.push("--glob", input.fileGlob);
    args.push(input.pattern, dir);

    try {
      const { stdout } = await execFileAsync("rg", args, {
        maxBuffer: 2 * 1024 * 1024,
      });
      const trimmed = stdout.trim();
      if (!trimmed) return { content: "No matches found.", isError: false };
      return {
        content: `Results for \`${input.pattern}\` in ${dir}:\n\n${trimmed}`,
        isError: false,
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { status?: number };
      if (e.status === 1) return { content: "No matches found.", isError: false };
      // rg not installed — try the platform native fallback.
      if (e.code === "ENOENT") {
        return IS_WINDOWS
          ? findstrFallback(input.pattern, dir, max)
          : grepFallback(input.pattern, dir, max);
      }
      return { content: `Search failed: ${e.message}`, isError: true };
    }
  },
};