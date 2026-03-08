/**
 * Tools for reading, writing, and listing files on disk.
 * write_file should only be called after user approval.
 */

import fs from "fs/promises";
import path from "path";
import { globby } from "globby";
import { ReadFileInput, ReadFileOutput, WriteFileInput, WriteFileOutput, ListFilesInput, ListFilesOutput } from "../schemas/index.js";

export async function read_file(rawInput) {
  const input = ReadFileInput.parse(rawInput);
  try {
    const absPath = path.resolve(input.path);
    const raw = await fs.readFile(absPath, "utf-8");
    const allLines = raw.split("\n");
    const truncated = allLines.length > input.maxLines;
    const content = truncated
      ? allLines.slice(0, input.maxLines).join("\n") + `\n// ... truncated at ${input.maxLines} lines`
      : raw;

    return ReadFileOutput.parse({ ok: true, path: absPath, content, lines: allLines.length, truncated });
  } catch (err) {
    return ReadFileOutput.parse({ ok: false, path: input.path, content: "", lines: 0, truncated: false, error: { code: err.code ?? "READ_ERROR", message: err.message, recoverable: err.code === "ENOENT" } });
  }
}

export async function write_file(rawInput) {
  const input = WriteFileInput.parse(rawInput);
  try {
    const absPath = path.resolve(input.path);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, input.content, "utf-8");
    return WriteFileOutput.parse({ ok: true, path: absPath });
  } catch (err) {
    return WriteFileOutput.parse({ ok: false, path: input.path, error: { code: err.code ?? "WRITE_ERROR", message: err.message, recoverable: false } });
  }
}

export async function list_files(rawInput) {
  const input = ListFilesInput.parse(rawInput);
  try {
    const absPath = path.resolve(input.path);
    const pattern = input.recursive ? "**/*" : "*";
    const rawPaths = await globby(pattern, {
      cwd: absPath,
      onlyFiles: false,
      deep: input.recursive ? 4 : 1,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    });

    const entries = rawPaths
      .filter(p => !input.extensions?.length || input.extensions.some(ext => p.endsWith(ext)))
      .map(relPath => ({
        name: path.basename(relPath),
        path: path.join(absPath, relPath),
        type: relPath.endsWith("/") ? "directory" : "file",
        extension: path.extname(relPath) || undefined,
      }));

    return ListFilesOutput.parse({ ok: true, path: absPath, entries });
  } catch (err) {
    return ListFilesOutput.parse({ ok: false, path: input.path, entries: [], error: { code: err.code ?? "LIST_ERROR", message: err.message, recoverable: true } });
  }
}