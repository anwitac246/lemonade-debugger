/**
 * agent-bridge.js
 * Manages a single Agent instance with proper session lifecycle.
 * Lazy-inits on first call; exposes streaming runAgentCommand().
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

let agentHandle = null; // { agent, sessionId }

async function getHandle() {
  if (agentHandle) return agentHandle;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to your shell environment or a .env file in the project root."
    );
  }

  const { createAgent } = await import("@ai-cli/core");

  // noDb=true if MONGODB_URI is not set — graceful degradation
  const noDb = !process.env.MONGODB_URI;
  agentHandle = await createAgent({ apiKey, requireConfirmation: false, noDb });
  return agentHandle;
}

/**
 * @param {string} userMessage
 * @param {(chunk: string, type: 'text'|'tool'|'error'|'meta') => void} onLine
 */
export async function runAgentCommand(userMessage, onLine) {
  const { agent } = await getHandle();

  await agent.run({
    userMessage,
    onEvent(event) {
      switch (event.type) {
        case "text_delta":
          onLine(event.delta, "text");
          break;
        case "tool_call":
          onLine(`⚙  ${event.toolName}(${JSON.stringify(event.input)})`, "tool");
          break;
        case "tool_result":
          onLine(
            `  ${event.result.isError ? "✖" : "✔"}  ${event.result.content.slice(0, 200)}`,
            "tool"
          );
          break;
        case "error":
          onLine(`Error: ${event.message}`, "error");
          break;
        case "turn_complete":
          onLine("\x00TURN_COMPLETE", "meta");
          break;
        default:
          break;
      }
    },
    confirmTool: async () => true,
  });
}

export function clearAgentHistory() {
  agentHandle?.agent?.clearHistory();
  agentHandle = null; // force re-init with fresh session
}

export function getSessionId() {
  return agentHandle?.sessionId ?? null;
}