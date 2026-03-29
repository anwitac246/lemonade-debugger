import { Annotation } from "@langchain/langgraph";

/**
 * graph/state.js — the shared state schema.
 *
 * This is the most important file in packages/core.
 * Every agent node reads from this state and writes back to it.
 * Think of it as the "whiteboard" the entire debugging session shares.
 *
 * LangGraph's Annotation.Root() defines:
 *   - what fields exist on the state
 *   - how to merge updates (reducer functions)
 *
 * Reducer rules used here:
 *   - Default (no reducer): last write wins — used for single values
 *   - Array fields use a custom append reducer so agents can add
 *     to a list without overwriting what previous agents wrote
 */

// A simple reducer that appends new items to an existing array.
// Used for fields where multiple agents contribute (e.g. toolCallLog).
const appendReducer = (existing, incoming) => [
  ...(existing ?? []),
  ...(Array.isArray(incoming) ? incoming : [incoming]),
];

export const GraphState = Annotation.Root({

  // ── Input ────────────────────────────────────────────────────────────────

  // The original query the user typed, e.g. "appointmentService crashes on null user".
  // Set once at the start, never modified.
  userQuery: Annotation({ reducer: (_, v) => v }),

  // Absolute path to the project root.
  // Used by tools to resolve relative file paths.
  projectRoot: Annotation({ reducer: (_, v) => v }),

  // ── Context ──────────────────────────────────────────────────────────────

  // Files loaded by the Context Agent.
  // Map of { path: string, content: string }
  // We store as an array so multiple agents can add files without collision.
  loadedFiles: Annotation({ default: () => [], reducer: appendReducer }),

  // ── Analysis ─────────────────────────────────────────────────────────────

  // Output from the Static Analysis node.
  // { lintErrors: [], compileErrors: [], resolved: boolean }
  // resolved = true means we found a clear fix without needing the debugger.
  analysisResults: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Debug session ────────────────────────────────────────────────────────

  // Set by the Debug Agent when it attaches via DAP.
  // { sessionId, breakpoints, stackFrames, variables, threadId }
  // Null until the Debug Agent runs.
  debugSession: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Web research ─────────────────────────────────────────────────────────

  // Snippets gathered by the Web Agent (optional node).
  // Appended so multiple searches accumulate.
  webResults: Annotation({ default: () => [], reducer: appendReducer }),

  // ── Fix ──────────────────────────────────────────────────────────────────

  // The patch proposed by the Fix Agent.
  // { filePath, diff, explanation }
  // Replaced on every Fix Agent run (Reflect may send it back for revision).
  proposedPatch: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Reflection ───────────────────────────────────────────────────────────

  // Score from the Reflect node (0.0 – 1.0).
  // >= 0.7 → proceed to user approval
  // <  0.7 → route back to Fix Agent with the critique
  reflectionScore: Annotation({ reducer: (_, v) => v, default: () => null }),

  // Critique text from the Reflect node.
  // Passed back to the Fix Agent as additional context when score is low.
  reflectionCritique: Annotation({ reducer: (_, v) => v, default: () => null }),

  // How many times the Reflect→Fix loop has cycled.
  // Guards against infinite loops — we cap at 3 revision attempts.
  revisionCount: Annotation({ reducer: (_, v) => v, default: () => 0 }),

  // ── Permissions ──────────────────────────────────────────────────────────

  // An action that is waiting for user approval before it can proceed.
  // { action: string, description: string, command?: string }
  // Set by a tool when it needs approval. Cleared after the user responds.
  pendingPermission: Annotation({ reducer: (_, v) => v, default: () => null }),

  // The user's response to the last permission request.
  // "approved" | "denied" | null
  permissionResponse: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Routing ──────────────────────────────────────────────────────────────

  // Signal written by each agent to tell the graph which node runs next.
  // The graph's conditional edges read this field to route execution.
  // Values: "context" | "staticAnalysis" | "debugAgent" | "webAgent" |
  //         "fixAgent" | "reflect" | "applyPatch" | "end"
  nextNode: Annotation({ reducer: (_, v) => v, default: () => null }),

  // ── Observability ────────────────────────────────────────────────────────

  // A log of every tool call made during this session.
  // Each entry: { agent, tool, input, output, durationMs, timestamp }
  // Appended by each tool call — never overwritten.
  toolCallLog: Annotation({ default: () => [], reducer: appendReducer }),

  // Human-readable status messages for streaming to the CLI.
  // Each entry: { type: "agentStep"|"toolCall"|"info"|"error", message, timestamp }
  events: Annotation({ default: () => [], reducer: appendReducer }),
});