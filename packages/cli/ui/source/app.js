/**
 * App.js — Main terminal UI component.
 *
 * Architecture:
 * - Shell passthrough via node-pty for all non-agent commands
 * - Agent commands prefixed with "lemonade debug " or "ai "
 * - Streaming output with proper line buffering
 * - Ctrl+C: first press cancels agent/sends SIGINT to shell, second press exits
 */

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { Banner } from "./components/banner-text.js";
import CommandsHelp from "./components/command-help.js";
import Prompt from "./components/prompt.js";
import { CommandHistory } from "./engine/history.js";
import { createShell } from "./engine/shell.js";
import {
  runAgentCommand,
  cancelCurrentCommand,
  clearAgentHistory,
  resetAgent,
  getSessionId,
} from "./engine/agent-bridge.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const AGENT_PREFIXES = ["lemonade debug ", "ai ", "debug "];
const MAX_ENTRIES = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function entryColor(type) {
  switch (type) {
    case "agent":
      return "cyan";
    case "tool":
      return "yellow";
    case "error":
      return "red";
    case "info":
      return "#888888";
    case "input":
      return "green";
    case "system":
      return "magenta";
    default:
      return "gray";
  }
}

function isAgentCommand(command) {
  const lower = command.toLowerCase();
  return AGENT_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function extractAgentMessage(command) {
  const lower = command.toLowerCase();
  for (const prefix of AGENT_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return command.slice(prefix.length).trim();
    }
  }
  return command;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const historyRef = useRef(new CommandHistory(200));
  const [entries, setEntries] = useState([]);
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");

  // Text buffer for streaming — accumulates partial lines
  const streamBuffer = useRef("");
  // Ref to track if agent is running (stable reference for async callbacks)
  const agentRunningRef = useRef(false);

  // Shell
  const shellRef = useRef(null);

  // ── Shell init ───────────────────────────────────────────────────────────

  useEffect(() => {
    shellRef.current = createShell((data) => {
      const cleaned = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = cleaned.split("\n");

      setEntries((prev) => {
        const newEntries = lines
          .filter((l) => l.length > 0)
          .map((line) => ({ output: line, type: "shell" }));
        const combined = [...prev, ...newEntries];
        return combined.length > MAX_ENTRIES
          ? combined.slice(-MAX_ENTRIES)
          : combined;
      });
    });

    return () => {
      shellRef.current?.kill?.();
    };
  }, []);

  // ── Entry helpers ────────────────────────────────────────────────────────

  const pushEntry = useCallback((output, type = "shell") => {
    if (!output || (typeof output === "string" && output.trim() === "")) return;
    setEntries((prev) => {
      const next = [...prev, { output, type }];
      return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    });
  }, []);

  const pushEntries = useCallback((lines, type) => {
    const filtered = lines.filter((l) => l.trim().length > 0);
    if (filtered.length === 0) return;
    setEntries((prev) => {
      const next = [
        ...prev,
        ...filtered.map((output) => ({ output, type })),
      ];
      return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
    });
  }, []);

  // ── Agent streaming handler ───────────────────────────────────────────────

  const handleAgentChunk = useCallback(
    (chunk, type) => {
      if (type === "meta" && chunk === "\x00TURN_COMPLETE") {
        // Flush remaining buffer
        if (streamBuffer.current.trim()) {
          pushEntry(streamBuffer.current.trim(), "agent");
          streamBuffer.current = "";
        }
        agentRunningRef.current = false;
        setIsAgentRunning(false);
        setAgentStatus("");
        return;
      }

      if (type === "text") {
        // Accumulate and flush on newlines
        streamBuffer.current += chunk;
        const lines = streamBuffer.current.split("\n");
        streamBuffer.current = lines.pop() ?? "";
        if (lines.length > 0) pushEntries(lines, "agent");
        return;
      }

      if (type === "tool") {
        setAgentStatus("Using tools…");
      }

      // tool / error / info: push immediately
      pushEntry(chunk, type);
    },
    [pushEntry, pushEntries]
  );

  // ── Command handler ──────────────────────────────────────────────────────

  const runCommand = useCallback(
    async (command) => {
      const trimmed = command.trim();
      if (!trimmed) return;

      // Echo input
      pushEntry(`> ${trimmed}`, "input");

      // Built-in commands
      if (trimmed === "/clear" || trimmed === "clear") {
        clearAgentHistory();
        setEntries([]);
        pushEntry("Agent history cleared.", "system");
        return;
      }

      if (trimmed === "/reset") {
        resetAgent();
        setEntries([]);
        pushEntry("Agent fully reset.", "system");
        return;
      }

      if (trimmed === "/session") {
        const id = getSessionId();
        pushEntry(`Session ID: ${id ?? "none"}`, "system");
        return;
      }

      if (trimmed === "/help" || trimmed === "--help") {
        pushEntry(
          "Commands:\n" +
            "  ai <message>         Run agent command\n" +
            "  lemonade debug <msg> Run agent command\n" +
            "  /clear               Clear agent history\n" +
            "  /reset               Fully reset agent\n" +
            "  /session             Show session ID\n" +
            "  Ctrl+C               Cancel agent / SIGINT shell\n" +
            "  Ctrl+C Ctrl+C        Exit",
          "system"
        );
        return;
      }

      // Agent commands
      if (isAgentCommand(trimmed)) {
        const message = extractAgentMessage(trimmed);
        if (!message) {
          pushEntry("Usage: ai <your question or task>", "error");
          return;
        }

        agentRunningRef.current = true;
        setIsAgentRunning(true);
        setAgentStatus("Thinking…");
        streamBuffer.current = "";

        try {
          await runAgentCommand(message, handleAgentChunk);
        } catch (err) {
          pushEntry(`Agent error: ${err.message}`, "error");
          agentRunningRef.current = false;
          setIsAgentRunning(false);
          setAgentStatus("");
          streamBuffer.current = "";
        }
        return;
      }

      // Shell passthrough
      if (shellRef.current) {
        shellRef.current.write(trimmed + "\r");
      } else {
        pushEntry("Shell not initialized.", "error");
      }
    },
    [pushEntry, handleAgentChunk]
  );

  // ── Input handling (Ctrl+C) ───────────────────────────────────────────────

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (agentRunningRef.current) {
        // First Ctrl+C: cancel agent
        cancelCurrentCommand();
        pushEntry("^C  [Agent cancelled]", "system");
        agentRunningRef.current = false;
        setIsAgentRunning(false);
        setAgentStatus("");
        streamBuffer.current = "";
        setCtrlCCount(0);
        return;
      }

      // Double Ctrl+C to exit
      if (ctrlCCount >= 1) {
        shellRef.current?.kill?.();
        exit();
        return;
      }

      setCtrlCCount((n) => n + 1);
      pushEntry("^C  Press Ctrl+C again to exit.", "system");

      setTimeout(() => setCtrlCCount(0), 2000);
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column">
      <Banner />
      <CommandsHelp />

      {/* Output area */}
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, i) => (
          <Text key={i} color={entryColor(entry.type)} wrap="wrap">
            {entry.output}
          </Text>
        ))}
      </Box>

      {/* Agent status indicator */}
      {isAgentRunning && (
        <Box marginTop={1}>
          <Text color="cyan">⟳ {agentStatus || "Running…"}</Text>
        </Box>
      )}

      {/* Input prompt */}
      <Box marginTop={1}>
        <Prompt
          history={historyRef.current}
          onCommand={runCommand}
          disabled={isAgentRunning}
        />
      </Box>

      {/* Exit hint */}
      {ctrlCCount >= 1 && (
        <Text color="yellow">Press Ctrl+C again to exit.</Text>
      )}
    </Box>
  );
}