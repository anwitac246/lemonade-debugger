/**
 * agent-bridge.js
 *
 * Loads the compiled core package and exposes a simple runAgentCommand()
 * function your app.js can call. We lazy-import so the UI stays fast on
 * startup (the agent client isn't created until first use).
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createAgent } = require("@ai-cli/core");

let agent = null;

function getAgent() {
  if (!agent) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Add it to your .env file or shell environment."
      );
    }
    agent = createAgent({ apiKey, requireConfirmation: false });
  }
  return agent;
}

/**
 * Run a user message through the agent and stream output lines back via
 * the onLine callback.
 *
 * @param {string} userMessage
 * @param {(line: string, type: 'text'|'tool'|'error') => void} onLine
 */
export async function runAgentCommand(userMessage, onLine) {
  const a = getAgent();

  await a.run({
    userMessage,
    onEvent(event) {
      switch (event.type) {
        case "text_delta":
          // Stream text deltas – the caller buffers them into lines
          onLine(event.delta, "text");
          break;
        case "tool_call":
          onLine(
            `⚙  ${event.toolName}(${JSON.stringify(event.input)})`,
            "tool"
          );
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
          // sentinel so app.js knows streaming is done
          onLine("\x00TURN_COMPLETE", "meta");
          break;
      }
    },
    // No interactive confirm in UI mode – destructive tools run freely
    confirmTool: async () => true,
  });
}

export function clearAgentHistory() {
  agent?.clearHistory();
}