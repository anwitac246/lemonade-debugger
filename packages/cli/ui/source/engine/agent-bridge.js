/**
 * agent-bridge.js
 *
 * Manages a single AgentHandle with proper lifecycle.
 * - Lazy initialization on first command
 * - AbortController per command (cancellation)
 * - Clean error propagation (no swallowed errors)
 * - Graceful shutdown on process exit
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import os from "os";

// ── Environment setup ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env from project root (best-effort — never throws)
try {
  const dotenv = require("dotenv");
  const envPath = path.resolve(__dirname, "../../../../.env");
  dotenv.config({ path: envPath });
} catch {
  // dotenv not available — rely on shell environment
}

// ── State ──────────────────────────────────────────────────────────────────────

/** @type {import("@ai-cli/core").AgentHandle | null} */
let handle = null;

/** @type {AbortController | null} */
let currentAbortController = null;

// ── Initialization ─────────────────────────────────────────────────────────────

async function getHandle() {
  if (handle) return handle;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set.\n" +
        "Add it to your shell profile or create a .env file in the project root:\n" +
        "  GROQ_API_KEY=your_key_here"
    );
  }

  const { createAgent } = await import("@ai-cli/core");

  const noDb = !process.env.MONGODB_URI;

  handle = await createAgent({
    apiKey,
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS ?? "25", 10),
    requireConfirmation: process.env.AGENT_REQUIRE_CONFIRM === "true",
    noDb,
  });

  // Clean up DAP sessions on exit
  process.once("exit", () => {
    handle?.cleanup();
  });

  return handle;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run an agent command with streaming events.
 *
 * @param {string} userMessage
 * @param {(chunk: string, type: 'text'|'tool'|'error'|'info'|'meta') => void} onChunk
 * @returns {Promise<void>}
 */
export async function runAgentCommand(userMessage, onChunk) {
  // Cancel any in-progress command
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  const { agent } = await getHandle();

  await agent.run({
    userMessage,
    signal,
    onEvent(event) {
      switch (event.type) {
        case "text_delta":
          onChunk(event.delta, "text");
          break;

        case "tool_call": {
          const inputStr = formatToolInput(event.input);
          onChunk(`⚙  ${event.toolName}(${inputStr})`, "tool");
          break;
        }

        case "tool_result": {
          const icon = event.result.isError ? "✖" : "✔";
          const preview = event.result.content.slice(0, 300);
          const ellipsis = event.result.content.length > 300 ? "…" : "";
          onChunk(`   ${icon}  ${preview}${ellipsis}`, "tool");
          break;
        }

        case "thinking":
          onChunk(`💭 ${event.content}`, "info");
          break;

        case "error":
          onChunk(`Error: ${event.message}`, "error");
          break;

        case "turn_complete":
          if (event.totalTokens) {
            onChunk(`[${event.totalTokens} tokens]`, "info");
          }
          onChunk("\x00TURN_COMPLETE", "meta");
          break;

        default:
          break;
      }
    },
    confirmTool: async (_toolName, _input) => true,
  });

  currentAbortController = null;
}

/**
 * Cancel the currently running agent command (if any).
 */
export function cancelCurrentCommand() {
  currentAbortController?.abort();
  currentAbortController = null;
}

/**
 * Reset the agent session (clear history, force re-init on next call).
 */
export function clearAgentHistory() {
  handle?.agent?.clearHistory();
}

/**
 * Full reset — tears down handle so next call re-initializes.
 */
export function resetAgent() {
  handle?.cleanup();
  handle = null;
  currentAbortController = null;
}

/**
 * Returns the current session ID (for display/logging).
 * @returns {string | null}
 */
export function getSessionId() {
  return handle?.sessionId ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatToolInput(input) {
  if (!input || typeof input !== "object") return String(input);
  try {
    const str = JSON.stringify(input);
    return str.length > 120 ? str.slice(0, 117) + "…}" : str;
  } catch {
    return "[complex input]";
  }
}