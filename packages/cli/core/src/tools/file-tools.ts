/**
 * Filesystem tools: read_file and search_code.
 *
 * These are intentionally narrow – they read, never write. Mutation tools
 * (run_shell_command) are separate so the confirmation gate can apply
 * selectively to destructive operations.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ToolDefinition, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

const IS_WINDOWS = os.platform() === "win32";

// ─── read_file ───────────────────────────────────────────────────────────────

interface ReadFileInput {
  path: string;
  /** Optional line range to avoid sending huge files to the LLM. */
  startLine?: number;
  endLine?: number;
  /** Max lines to return even without an explicit range. Default: 500. */
  maxLines?: number;
}

/** Naively detect binary content by looking for null bytes in the first chunk. */
function isBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8000);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export const readFileTool: ToolDefinition<ReadFileInput> = {
  name: "read_file",
  description:
    "Read the contents of a text file on disk. Supports optional line-range slicing to avoid " +
    "overwhelming the context window with large files. Binary files are rejected gracefully.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file.",
      },
      startLine: {
        type: "number",
        description: "1-indexed start line (inclusive). Omit to start from beginning.",
      },
      endLine: {
        type: "number",
        description: "1-indexed end line (inclusive). Omit to read to end of file.",
      },
      maxLines: {
        type: "number",
        description:
          "Maximum number of lines to return when no explicit range is given. Default 500.",
      },
    },
    required: ["path"],
  },

  async execute(input: ReadFileInput): Promise<ToolResult> {
    const resolved = path.resolve(input.path);

    // ── existence & type check ───────────────────────────────────────────────
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolved);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        return { content: `File not found: ${resolved}`, isError: true };
      }
      if (e.code === "EACCES") {
        return { content: `Permission denied: ${resolved}`, isError: true };
      }
      return { content: `Cannot stat file: ${e.message}`, isError: true };
    }

    if (!stat.isFile()) {
      return {
        content: stat.isDirectory()
          ? `Path is a directory, not a file: ${resolved}`
          : `Path is not a regular file: ${resolved}`,
        isError: true,
      };
    }

    // ── size guard (skip reading huge files entirely) ────────────────────────
    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
    if (stat.size > MAX_BYTES) {
      return {
        content:
          `File is too large to read in full (${(stat.size / 1024).toFixed(0)} KB). ` +
          `Use startLine/endLine to read a specific section.`,
        isError: true,
      };
    }

    // ── read & binary check ──────────────────────────────────────────────────
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolved);
    } catch (err) {
      return { content: `Failed to read file: ${(err as Error).message}`, isError: true };
    }

    if (isBinary(buffer)) {
      return {
        content: `File appears to be binary and cannot be read as text: ${resolved}`,
        isError: true,
      };
    }

    const raw = buffer.toString("utf-8");
    const lines = raw.split("\n");
    const total = lines.length;
    const maxLines = input.maxLines ?? 500;

    // ── line range resolution ────────────────────────────────────────────────
    const hasExplicitRange =
      input.startLine !== undefined || input.endLine !== undefined;

    const start = Math.max(0, (input.startLine ?? 1) - 1);
    let end = Math.min(total, input.endLine ?? total);

    // Apply maxLines cap only when no explicit end was requested.
    if (input.endLine === undefined && end - start > maxLines) {
      end = start + maxLines;
    }

    if (start >= total) {
      return {
        content: `startLine (${input.startLine}) exceeds file length (${total} lines): ${resolved}`,
        isError: true,
      };
    }

    const sliced = lines.slice(start, end);
    const truncated = !hasExplicitRange && end < total;

    // Prefix line numbers so the LLM can reference them precisely.
    const numbered = sliced
      .map((line, i) => `${String(start + i + 1).padStart(4, " ")} | ${line}`)
      .join("\n");

    const rangeLabel = hasExplicitRange
      ? `lines ${start + 1}–${end} of ${total}`
      : `${sliced.length} of ${total} lines`;

    const truncationNote = truncated
      ? `\n\n[Truncated at line ${end}. Use startLine/endLine to read more.]`
      : "";

    const header = `[${resolved}] ${rangeLabel}\n\n`;

    return { content: header + numbered + truncationNote, isError: false };
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

// ── Windows-native fallback using findstr ────────────────────────────────────

async function findstrFallback(
  pattern: string,
  dir: string,
  maxResults: number
): Promise<ToolResult> {
  try {
    // /s = recursive, /n = line numbers, /i = case-insensitive, /r = regex
    const { stdout } = await execFileAsync(
      "findstr",
      ["/s", "/n", "/i", "/r", pattern, path.join(dir, "*")],
      { maxBuffer: 2 * 1024 * 1024, shell: false }
    );
    const lines = stdout.trim().split("\n").slice(0, maxResults);
    return {
      content: lines.length ? lines.join("\n") : "No matches found.",
      isError: false,
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    // findstr exits 1 for "no matches"
    if (e.status === 1) {
      return { content: "No matches found.", isError: false };
    }
    return {
      content: `findstr fallback failed: ${e.message}`,
      isError: true,
    };
  }
}

// ── Unix grep fallback ───────────────────────────────────────────────────────

async function grepFallback(
  pattern: string,
  dir: string,
  maxResults: number
): Promise<ToolResult> {
  try {
    const { stdout } = await execFileAsync(
      "grep",
      ["-rn", "--include=*", pattern, dir],
      { maxBuffer: 2 * 1024 * 1024 }
    );
    const lines = stdout.trim().split("\n").slice(0, maxResults);
    return {
      content: lines.length ? lines.join("\n") : "No matches found.",
      isError: false,
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    // grep exits with status 1 for "no matches" — NOT e.code
    if (e.status === 1) {
      return { content: "No matches found.", isError: false };
    }
    return {
      content: `grep fallback failed: ${e.message}`,
      isError: true,
    };
  }
}

// ── Platform-aware fallback dispatcher ───────────────────────────────────────

function nativeFallback(
  pattern: string,
  dir: string,
  maxResults: number
): Promise<ToolResult> {
  return IS_WINDOWS
    ? findstrFallback(pattern, dir, maxResults)
    : grepFallback(pattern, dir, maxResults);
}

// ── Main tool ─────────────────────────────────────────────────────────────────

export const searchCodeTool: ToolDefinition<SearchCodeInput> = {
  name: "search_code",
  description:
    "Search for a regex pattern across source files using ripgrep (rg). " +
    "Falls back to grep (Unix) or findstr (Windows) if rg is not installed. " +
    "Use this to locate function definitions, usages, or any string/pattern in the codebase. " +
    "Prefer this over read_file when you don't know which file contains the symbol.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for.",
      },
      directory: {
        type: "string",
        description:
          "Root directory to search. Defaults to current working directory.",
      },
      fileGlob: {
        type: "string",
        description: "Limit search to files matching this glob, e.g. '*.ts'.",
      },
      maxResults: {
        type: "number",
        description: "Cap results at this many matching lines. Default 50.",
      },
    },
    required: ["pattern"],
  },

  async execute(input: SearchCodeInput): Promise<ToolResult> {
    const dir = input.directory ? path.resolve(input.directory) : process.cwd();
    const maxResults = input.maxResults ?? 50;

    // ── verify directory exists ──────────────────────────────────────────────
    try {
      const dirStat = await fs.stat(dir);
      if (!dirStat.isDirectory()) {
        return {
          content: `Provided path is not a directory: ${dir}`,
          isError: true,
        };
      }
    } catch {
      return { content: `Directory not found: ${dir}`, isError: true };
    }

    // ── build ripgrep args ───────────────────────────────────────────────────
    // Note: do NOT combine --max-count=1 (per-file cap) with -m (total cap).
    // --max-count=1 means "stop after first match in each file", which is
    // useful for existence checks but not for showing all usages.
    // We only use -m here to cap total output lines.
    const args: string[] = [
      "--line-number",
      "--color=never",
      "--no-heading",        // one "file:line:match" per output line
      "-m", String(maxResults),
    ];

    if (input.fileGlob) {
      args.push("--glob", input.fileGlob);
    }

    args.push(input.pattern, dir);

    // ── try ripgrep ──────────────────────────────────────────────────────────
    try {
      const { stdout } = await execFileAsync("rg", args, {
        maxBuffer: 2 * 1024 * 1024,
      });
      const trimmed = stdout.trim();
      if (!trimmed) return { content: "No matches found.", isError: false };

      return {
        content: `Search results for \`${input.pattern}\` in ${dir}:\n\n${trimmed}`,
        isError: false,
      };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { status?: number };

      // rg exits with STATUS 1 (not e.code) for "no matches found".
      // e.code is for OS-level errors like ENOENT, EACCES.
      if (e.status === 1) {
        return { content: "No matches found.", isError: false };
      }

      // rg not installed — fall back to platform-native search tool.
      if (e.code === "ENOENT") {
        return nativeFallback(input.pattern, dir, maxResults);
      }

      // rg is installed but failed for another reason (bad regex, etc.)
      return {
        content: `Search failed: ${e.message}`,
        isError: true,
      };
    }
  },
};