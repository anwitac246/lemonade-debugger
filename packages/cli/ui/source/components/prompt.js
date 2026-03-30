import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export default function Prompt({ history, onCommand, disabled = false }) {
  const [input, setInput] = useState('');

  useInput((char, key) => {
    // Always allow Ctrl+C (handled in app.js)
    if (key.ctrl) return;

    // Block all other input while agent is running
    if (disabled) return;

    if (key.return) {
      const command = input.trim();
      if (command) {
        history.add(command);
        onCommand(command);
      }
      setInput('');
      return;
    }

    if (key.upArrow) {
      const previous = history.up();
      if (previous !== undefined) setInput(previous);
      return;
    }

    if (key.downArrow) {
      const next = history.down();
      if (next !== undefined) setInput(next);
      return;
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }

    if (char && char.length === 1) {
      setInput(prev => prev + char);
    }
  });

  return (
    <Box>
      <Text color={disabled ? 'gray' : 'green'}>{disabled ? '⟳ ' : '> '}</Text>
      <Text color="cyan">{input}</Text>
      {!disabled && <Text color="gray">_</Text>}
    </Box>
  );
}