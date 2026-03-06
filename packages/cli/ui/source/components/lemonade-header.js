import React from 'react';
import {Box, Text} from 'ink';
import gradient from 'gradient-string';
import figlet from 'figlet';

const lemonGradient = gradient(['#FFFF00', '#FFA500']);

export function LemonadeGradient({children}) {
	const text = typeof children === 'string' ? children : '';

	const figletText = figlet.textSync(text, {font: 'ANSI Shadow'});
	const lines = figletText
		.split('\n')
		.filter((line, i, a) => i < a.length - 1 || line.trim() !== '');

	const gradientBlock = lemonGradient(figletText);
	const gradientLines = gradientBlock.split('\n');

	return (
		<Box flexDirection="column">
			{lines.map(line => (
				<Box key={line} flexDirection="column">
					<Text dimColor color="grey">
						{' ' + line}
					</Text>
					<Box marginTop={-1}>
						<Text>{gradientLines[lines.indexOf(line)] ?? ''}</Text>
					</Box>
				</Box>
			))}
		</Box>
	);
}
