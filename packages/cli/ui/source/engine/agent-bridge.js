/**
 * Lazy-loads @ai-cli/core and exposes a streaming runAgentCommand().
 * We use a dynamic import() — the package is ESM-only and cannot be
 * require()'d. Lazy loading keeps startup fast.
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });


let agent = null;

async function getAgent() {
  if (agent) return agent;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to your shell environment or .env file."
    );
  }

  // Dynamic import works for both ESM and CJS consumers.
  const { createAgent } = await import("@ai-cli/core");
  agent = createAgent({ apiKey, requireConfirmation: false });
  return agent;
}

/**
 * Run a user message through the agent, forwarding streamed events to onLine.
 *
 * @param {string} userMessage
 * @param {(chunk: string, type: 'text'|'tool'|'error'|'meta') => void} onLine
 */
export async function runAgentCommand(userMessage, onLine) {
  const a = await getAgent();

  await a.run({
    userMessage,
    onEvent(event) {
      switch (event.type) {
        case "text_delta":
          onLine(event.delta, "text");
          break;
        case "tool_call":
          // Show the tool invocation so the user can see what the agent is doing.
          onLine(`⚙  ${event.toolName}(${JSON.stringify(event.input)})`, "tool");
          break;
        case "tool_result":
          onLine(
            `  ${event.result.isError ? "✖" : "✔"}  ${event.result.content.slice(0, 120)}`,
            "tool"
          );
          break;
        case "error":
          onLine(`Error: ${event.message}`, "error");
          break;
        case "turn_complete":
          // Sentinel so app.js knows the stream is done.
          onLine("\x00TURN_COMPLETE", "meta");
          break;
      }
    },
    // Destructive tool confirmation is disabled in UI mode — the user
    // already invoked the command intentionally.
    confirmTool: async () => true,
  });
}

export function clearAgentHistory() {
  agent?.clearHistory();
}