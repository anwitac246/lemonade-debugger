/**
 * Zod schemas for all tool inputs and outputs.
 * Every tool validates its input and output through these schemas.
 */

import { z } from "zod";

const FilePath = z.string().min(1);

const ToolError = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
});

// Filesystem Tools

export const ReadFileInput = z.object({
  path: FilePath,
  maxLines: z.number().optional().default(2000),
  // we limit the file read to a certain number of lines to prevent memory and context window issues with large files. 
  // The content is truncated if it exceeds this limit, and the output includes a flag indicating whether truncation occurred.
});

export const ReadFileOutput = z.object({
  ok: z.boolean(),
  path: z.string(),
  content: z.string(),
  lines: z.number(),
  truncated: z.boolean(),
  error: ToolError.optional(),
});

// WriteFileInput and WriteFileOutput are used for writing content to a file.
//  The input includes the file path and the content to be written,
//  while the output indicates whether the operation was successful, 
// the path of the file, and any error that may have occurred during the process.

export const WriteFileInput = z.object({
  path: FilePath,
  content: z.string(),
});

export const WriteFileOutput = z.object({
  ok: z.boolean(),
  path: z.string(),
  error: ToolError.optional(),
});

export const ListFilesInput = z.object({
  path: FilePath,
  recursive: z.boolean().optional().default(false),
  extensions: z.array(z.string()).optional(),
});

export const ListFilesOutput = z.object({
  ok: z.boolean(),
  path: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "directory"]),
    extension: z.string().optional(),
  })),
  error: ToolError.optional(),
});

// Code Discovery Tools

export const SearchCodeInput = z.object({
  query: z.string().min(1),
  path: FilePath.optional().default("."),
  filePattern: z.string().optional(),
  maxResults: z.number().optional().default(50),
});

export const SearchCodeOutput = z.object({
  ok: z.boolean(),
  matches: z.array(z.object({
    file: z.string(),
    line: z.number(),
    content: z.string(),
    contextBefore: z.array(z.string()),
    contextAfter: z.array(z.string()),
  })),
  totalMatches: z.number(),
  error: ToolError.optional(),
});

// AST Tools

export const ParseAstInput = z.object({
  path: FilePath,
});

export const ParseAstOutput = z.object({
  ok: z.boolean(),
  path: z.string(),
  language: z.enum(["typescript", "javascript", "python", "unknown"]),
  functions: z.array(z.object({
    name: z.string(),
    line: z.number(),
    params: z.array(z.string()),
    isAsync: z.boolean(),
    isExported: z.boolean(),
  })),
  imports: z.array(z.object({
    source: z.string(),
    specifiers: z.array(z.string()),
    line: z.number(),
  })),
  classes: z.array(z.object({
    name: z.string(),
    line: z.number(),
    methods: z.array(z.string()),
  })),
  exports: z.array(z.string()),
  error: ToolError.optional(),
});

// Static Analysis Tools

export const RunLinterInput = z.object({ path: FilePath });

export const RunLinterOutput = z.object({
  ok: z.boolean(),
  tool: z.string(),
  passed: z.boolean(),
  errorCount: z.number(),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number(),
    column: z.number(),
    severity: z.enum(["error", "warning"]),
    rule: z.string().optional(),
    message: z.string(),
  })),
  raw: z.string(),
  error: ToolError.optional(),
});

export const RunCompilerInput = z.object({ path: FilePath });

export const RunCompilerOutput = z.object({
  ok: z.boolean(),
  tool: z.string(),
  passed: z.boolean(),
  errorCount: z.number(),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number(),
    column: z.number(),
    severity: z.enum(["error", "warning"]),
    code: z.string().optional(),
    message: z.string(),
  })),
  raw: z.string(),
  error: ToolError.optional(),
});

// Patch Tools

export const GeneratePatchInput = z.object({
  path: FilePath,
  originalContent: z.string(),
  modifiedContent: z.string(),
});

export const GeneratePatchOutput = z.object({
  ok: z.boolean(),
  path: z.string(),
  diff: z.string(),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  error: ToolError.optional(),
});

export const ApplyPatchInput = z.object({
  path: FilePath,
  diff: z.string(),
});

export const ApplyPatchOutput = z.object({
  ok: z.boolean(),
  path: z.string(),
  backupPath: z.string().optional(),
  error: ToolError.optional(),
});