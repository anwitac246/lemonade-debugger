import React from 'react';
import {Box, Text} from 'ink';

export default function CommandsHelp() {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color="yellow"> --help : Show help menu</Text>

			<Text color="yellow">
				{/* The link is to be changed as per the original link. Docs:{' '} */}
				<Text color="cyan">https://lemonade.dev/docs</Text>
			</Text>
		</Box>
	);
}
