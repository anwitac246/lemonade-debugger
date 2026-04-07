/**
 * Smart context retrieval.
 *
 * Strategy (in priority order):
 * 1. Files explicitly mentioned by the user (path patterns)
 * 2. Ripgrep hits for symbols/terms in the query
 * 3. Files modified recently (git log)
 * 4. Entry-point heuristics (index, main, app files)
 *
 * We deliberately keep this fast and cheap — no embeddings, no vector DB.
 * The goal is to give the LLM just enough context, not everything.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { FileContext, ContextRetrievalOptions } from "../types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_BYTES = 32_000; // ~8k tokens per file generous estimate
const DEFAULT_MAX_TOTAL_BYTES = 120_000; // ~30k tokens total context budget

const EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".mypy_cache",
  "target",
  "vendor",
  ".yarn",
  "coverage",
  ".cache",
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".lock",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".ini",
  ".env",
  ".md",
  ".sql",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBinaryExtension(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function excludePathFilter(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  return !EXCLUDE_DIRS.some((dir) => parts.includes(dir));
}

function extractSearchTerms(query: string): string[] {
  // Extract identifiers, file paths, and meaningful tokens
  const terms: string[] = [];

  // File paths (e.g., "src/agent.ts")
  const pathMatches = query.match(/[\w./-]+\.\w{1,5}/g) ?? [];
  terms.push(...pathMatches);

  // CamelCase / snake_case identifiers
  const identMatches = query.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g) ?? [];
  // Filter common English words that won't help code search
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "this",
    "that",
    "with",
    "from",
    "what",
    "how",
    "why",
    "when",
    "where",
    "which",
    "have",
    "has",
    "not",
    "are",
    "can",
    "does",
    "use",
    "show",
    "make",
    "tell",
    "give",
    "get",
    "set",
    "add",
    "new",
    "old",
    "run",
    "will",
    "should",
  ]);
  terms.push(...identMatches.filter((t) => !stopWords.has(t.toLowerCase())));

  // Deduplicate and return longest-first (more specific terms first)
  return [...new Set(terms)].sort((a, b) => b.length - a.length).slice(0, 6);
}

async function readFileSafe(
  filePath: string,
  maxBytes: number
): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size === 0) return null;
    if (stat.size > maxBytes * 4) return null; // too large even to try

    const buffer = await fs.readFile(filePath);

    // Binary detection: null bytes in first 8KB
    const sample = buffer.slice(0, Math.min(buffer.length, 8192));
    if (sample.includes(0)) return null;

    const text = buffer.toString("utf-8");
    if (text.length <= maxBytes) return text;

    // Truncate at line boundary
    const truncated = text.slice(0, maxBytes);
    const lastNewline = truncated.lastIndexOf("\n");
    return lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
  } catch {
    return null;
  }
}

// ─── Search strategies ────────────────────────────────────────────────────────

async function ripgrepSearch(
  terms: string[],
  dir: string
): Promise<string[]> {
  if (terms.length === 0) return [];

  // Search for each term, collect unique file paths
  const files = new Set<string>();

  for (const term of terms.slice(0, 4)) {
    try {
      const args = [
        "--files-with-matches",
        "--no-heading",
        "--color=never",
        "-l",
        "--max-count=1",
        term,
        dir,
        ...EXCLUDE_DIRS.flatMap((d) => ["--glob", `!${d}`]),
      ];

      const { stdout } = await execFileAsync("rg", args, {
        maxBuffer: 512 * 1024,
      });

      for (const line of stdout.trim().split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !isBinaryExtension(trimmed) && isCodeFile(trimmed)) {
          files.add(trimmed);
        }
      }
    } catch {
      // rg not found or no matches — continue
    }
  }

  return [...files];
}

async function gitRecentFiles(dir: string, n = 10): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--name-only", "--pretty=format:", "-10", "--diff-filter=AM"],
      { cwd: dir, maxBuffer: 256 * 1024 }
    );

    const files = stdout
      .trim()
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f && isCodeFile(f) && excludePathFilter(f))
      .map((f) => path.resolve(dir, f));

    // Deduplicate preserving order
    return [...new Set(files)].slice(0, n);
  } catch {
    return [];
  }
}

async function findEntryPoints(dir: string): Promise<string[]> {
  const candidates = [
    "src/index.ts",
    "src/index.js",
    "src/main.ts",
    "src/main.js",
    "src/app.ts",
    "src/app.js",
    "index.ts",
    "index.js",
    "main.ts",
    "main.py",
    "main.go",
    "app.ts",
    "app.js",
  ];

  const found: string[] = [];
  for (const c of candidates) {
    const full = path.resolve(dir, c);
    try {
      await fs.access(full);
      found.push(full);
    } catch {
      // not found
    }
  }
  return found;
}

async function extractMentionedPaths(
  query: string,
  dir: string
): Promise<string[]> {
  const pathPattern = /[\w./\\-]+\.\w{1,10}/g;
  const matches = [...(query.match(pathPattern) ?? [])];
  const found: string[] = [];

  for (const m of matches) {
    const candidates = [
      path.resolve(dir, m),
      path.resolve(dir, "src", m),
      path.resolve(m),
    ];
    for (const c of candidates) {
      try {
        const stat = await fs.stat(c);
        if (stat.isFile()) {
          found.push(c);
          break;
        }
      } catch {
        // not found
      }
    }
  }

  return found;
}

// ─── Score & rank ─────────────────────────────────────────────────────────────

function scoreFile(
  filePath: string,
  query: string,
  searchTerms: string[],
  ripgrepHits: Set<string>,
  recentFiles: Set<string>,
  entryPoints: Set<string>,
  explicitMentions: Set<string>
): number {
  let score = 0;

  if (explicitMentions.has(filePath)) score += 100;
  if (ripgrepHits.has(filePath)) score += 50;
  if (recentFiles.has(filePath)) score += 20;
  if (entryPoints.has(filePath)) score += 10;

  // Bonus if the filename matches a search term
  const basename = path.basename(filePath).toLowerCase();
  for (const term of searchTerms) {
    if (basename.includes(term.toLowerCase())) {
      score += 15;
    }
  }

  // Prefer source files over config/lock files
  const ext = path.extname(filePath);
  if ([".ts", ".js", ".py", ".go", ".rs"].includes(ext)) score += 5;

  return score;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function retrieveContext(
  options: ContextRetrievalOptions
): Promise<FileContext[]> {
  const {
    query,
    workingDir,
    maxFiles = DEFAULT_MAX_FILES,
    maxBytesPerFile = DEFAULT_MAX_BYTES,
  } = options;

  const searchTerms = extractSearchTerms(query);

  // Run all strategies concurrently
  const [ripgrepFiles, recentFilesList, entryPointsList, mentionedPaths] =
    await Promise.all([
      ripgrepSearch(searchTerms, workingDir),
      gitRecentFiles(workingDir),
      findEntryPoints(workingDir),
      extractMentionedPaths(query, workingDir),
    ]);

  const ripgrepHits = new Set(ripgrepFiles);
  const recentFiles = new Set(recentFilesList);
  const entryPoints = new Set(entryPointsList);
  const explicitMentions = new Set(mentionedPaths);

  // Gather all candidate files
  const allCandidates = new Set([
    ...ripgrepFiles,
    ...recentFilesList,
    ...entryPointsList,
    ...mentionedPaths,
  ]);

  // Score and sort
  const scored = [...allCandidates]
    .filter((f) => !isBinaryExtension(f) && isCodeFile(f) && excludePathFilter(f))
    .map((f) => ({
      path: f,
      score: scoreFile(
        f,
        query,
        searchTerms,
        ripgrepHits,
        recentFiles,
        entryPoints,
        explicitMentions
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles * 2); // over-fetch, then budget-cap

  // Read files within total byte budget
  const results: FileContext[] = [];
  let totalBytes = 0;

  for (const { path: filePath, score } of scored) {
    if (results.length >= maxFiles) break;
    if (totalBytes >= DEFAULT_MAX_TOTAL_BYTES) break;

    const content = await readFileSafe(filePath, maxBytesPerFile);
    if (!content) continue;

    totalBytes += content.length;
    results.push({
      path: filePath,
      content,
      relevanceScore: score,
    });
  }

  return results;
}

/**
 * Format file contexts for injection into the system prompt.
 */
export function formatContextForPrompt(
  contexts: FileContext[],
  workingDir: string
): string {
  if (contexts.length === 0) return "";

  const sections = contexts.map((ctx) => {
    const relPath = path.relative(workingDir, ctx.path);
    const lines = ctx.content.split("\n").length;
    return `### ${relPath} (${lines} lines)\n\`\`\`\n${ctx.content}\n\`\`\``;
  });

  return `## Relevant Files\n\n${sections.join("\n\n")}`;
}