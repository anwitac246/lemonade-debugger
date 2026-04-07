import React from "react";
import { Box, Text } from "ink";

export default function CommandsHelp() {
  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="yellow" bold>Commands</Text>
      <Text color="yellow">  ai &lt;question&gt;          Ask the AI agent (Groq)</Text>
      <Text color="yellow">  lemonade debug &lt;msg&gt;   Alias for ai</Text>
      <Text color="yellow">  /clear                 Clear agent memory</Text>
      <Text color="yellow">  /reset                 Full agent reset</Text>
      <Text color="yellow">  /session               Show session ID</Text>
      <Text color="yellow">  Ctrl+C                 Cancel agent / SIGINT</Text>
      <Text color="yellow">  Ctrl+C Ctrl+C          Exit</Text>
    </Box>
  );
}