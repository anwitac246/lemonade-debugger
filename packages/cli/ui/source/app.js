import React, { useRef, useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Banner } from './components/banner-text.js';
import CommandsHelp from './components/command-help.js';
import Prompt from './components/prompt.js';
import { CommandHistory } from './engine/history.js';
import { createShell } from "./engine/shell.js";

export default function App() {

	const { exit } = useApp();

	const historyRef = useRef(new CommandHistory(200));
	const [entries, setEntries] = useState([]);
	const [ctrlCount, setCtrlCount] = useState(0);

	const shellRef = useRef(null);

	if (!shellRef.current) {
		shellRef.current = createShell(data => {

			const lines = data
				.replace(/\r/g, "")
				.split("\n")
				.filter(Boolean);

			setEntries(prev => [
				...prev,
				...lines.map(line => ({
					command: "",
					output: line
				}))
			]);
		});
	}

	function runCommand(command) {

		setEntries(prev => [
			...prev,
			{ command, output: "" }
		]);

		if (command.startsWith("debug")) {

			setEntries(prev => [
				...prev,
				{ command: "", output: "Running debugger..." }
			]);

			return;
		}

		shellRef.current.write(command + "\r");
	}

	useInput((input, key) => {

		if (key.ctrl && input === "c") {

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
						<Text color="gray">{entry.output}</Text>
					</Box>
				))}
			</Box>

			<Prompt
				history={historyRef.current}
				onCommand={runCommand}
			/>

			{ctrlCount === 1 && (
				<Text>
					Press Ctrl+C again to terminate{" "}
					<Text color="yellow">LEMONADE</Text>
				</Text>
			)}

		</Box>
	);
}