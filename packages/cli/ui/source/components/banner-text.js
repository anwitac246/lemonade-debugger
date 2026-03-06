import React from 'react';
import {Box, Text} from 'ink';
import {LemonadeGradient} from './lemonade-header.js';

// Function declaration not arrow (function-component-definition)
export function Banner() {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box alignItems="flex-start" flexDirection="row">
				<LemonadeGradient>LEMONADE</LemonadeGradient>
			</Box>

			<Text color="#FFA500">{'='.repeat(100)}</Text>
		</Box>
	);
}
