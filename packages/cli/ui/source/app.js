import React, { useRef, useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Banner } from './components/banner-text.js';
import CommandsHelp from './components/command-help.js';
import Prompt from './components/prompt.js';
import { CommandHistory } from './engine/history.js';
import { createShell } from './engine/shell.js';
import { runAgentCommand, clearAgentHistory } from './engine/agent-bridge.js';

export default function App() {
  const { exit } = useApp();

  const historyRef = useRef(new CommandHistory(200));
  const [entries, setEntries] = useState([]);
  const [ctrlCount, setCtrlCount] = useState(0);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // Buffer for streaming agent text (accumulates deltas into full lines)
  const agentTextBuffer = useRef('');

  const shellRef = useRef(null);

  if (!shellRef.current) {
    shellRef.current = createShell(data => {
      const lines = data
        .replace(/\r/g, '')
        .split('\n')
        .filter(Boolean);

      setEntries(prev => [
        ...prev,
        ...lines.map(line => ({ command: '', output: line, type: 'shell' })),
      ]);
    });
  }

  function pushEntry(output, type = 'shell') {
    setEntries(prev => [...prev, { command: '', output, type }]);
  }

  async function runCommand(command) {
    // Echo the command
    setEntries(prev => [...prev, { command, output: '', type: 'input' }]);

    const lowerCaseCommand = command.toLowerCase();

    if (lowerCaseCommand.startsWith('lemonade debug ')) {
      const message = command.substring('lemonade debug '.length);
      setIsAgentRunning(true);
      agentTextBuffer.current = '';

      try {
        await runAgentCommand(message, (chunk, type) => {
          if (type === 'meta' && chunk === '\x00TURN_COMPLETE') {
            // Flush any remaining buffered text as a final line
            if (agentTextBuffer.current.trim()) {
              pushEntry(agentTextBuffer.current.trim(), 'agent');
              agentTextBuffer.current = '';
            }
            return;
          }

          if (type === 'text') {
            // Accumulate deltas and flush on newlines
            agentTextBuffer.current += chunk;
            const lines = agentTextBuffer.current.split('\n');
            // Keep the last (incomplete) chunk in the buffer
            agentTextBuffer.current = lines.pop() ?? '';
            for (const line of lines) {
              if (line.trim()) pushEntry(line, 'agent');
            }
            return;
          }

          // tool / error lines – push immediately
          pushEntry(chunk, type);
        });
      } catch (err) {
        pushEntry(`Agent error: ${err.message}`, 'error');
      } finally {
        // Flush anything left in the buffer
        if (agentTextBuffer.current.trim()) {
          pushEntry(agentTextBuffer.current.trim(), 'agent');
          agentTextBuffer.current = '';
        }
        setIsAgentRunning(false);
      }

      return;
    }

    // ── Shell passthrough for everything else ────────────────────────────
    shellRef.current.write(command + '\r');
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (ctrlCount === 1) {
        shellRef.current?.kill();
        exit();
        return;
      }

      setCtrlCount(1);
      setTimeout(() => {
        setCtrlCount(0);
      }, 2000);
      return;
    }
  });

  function entryColor(type) {
    switch (type) {
      case 'agent':
        return 'cyan';
      case 'tool':
        return 'yellow';
      case 'error':
        return 'red';
      case 'info':
        return 'green';
      case 'input':
        return 'green';
      default:
        return 'gray';
    }
  }

  return (
    <Box flexDirection="column">
      <Banner />
      <CommandsHelp />

      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, i) => (
          <Box key={i} flexDirection="column">
            {entry.command && (
              <Text color="green">{`> ${entry.command}`}</Text>
            )}
            {entry.output && (
              <Text color={entryColor(entry.type)}>{entry.output}</Text>
            )}
          </Box>
        ))}
      </Box>

      {isAgentRunning && (
        <Box marginTop={1}>
          <Text color="cyan">⟳ Agent thinking…</Text>
        </Box>
      )}

      <Prompt
        history={historyRef.current}
        onCommand={runCommand}
        disabled={isAgentRunning}
      />

      {ctrlCount === 1 && (
        <Text>
          Press Ctrl+C again to terminate{' '}
          <Text color="yellow">LEMONADE</Text>
        </Text>
      )}
    </Box>
  );
}