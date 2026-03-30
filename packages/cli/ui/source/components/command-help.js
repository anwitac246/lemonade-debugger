import React from 'react';
import { Box, Text } from 'ink';

export default function CommandsHelp() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="yellow"> --help : Show help menu</Text>
      <Text color="yellow"> ai &lt;question&gt; : Ask the AI agent (uses Groq)</Text>
      <Text color="yellow"> /clear : Clear agent memory</Text>
      <Text color="yellow">
        Docs: <Text color="cyan">https://lemonade.dev/docs</Text>
      </Text>
    </Box>
  );
}
