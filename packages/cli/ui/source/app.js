import React, {useRef, useState} from 'react';
import {Box, Text} from 'ink';
import {Banner} from './components/banner-text.js';
import CommandsHelp from './components/command-help.js';
import Prompt from './components/prompt.js';
import {CommandHistory} from './engine/history.js';
import {createShell} from "./engine/shell.js";

export default function App() {

	const historyRef = useRef(new CommandHistory(200));
	const [entries, setEntries] = useState([]);

	const shellRef = useRef(null);

	if (!shellRef.current) {
		shellRef.current = createShell(data => {
			setEntries(prev => [
				...prev,
				{command: "", output: data}
			]);
		});
	}

	function runCommand(command) {

		if (command.startsWith("debug")) {
			setEntries(prev => [
				...prev,
				{command, output: "Running debugger..."}
			]);
			return;
		}

		shellRef.current.write(command + "\r");
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
						<Text>{entry.output}</Text>
					</Box>
				))}
			</Box>

			<Prompt
				history={historyRef.current}
				onCommand={runCommand}
			/>

		</Box>
	);
}