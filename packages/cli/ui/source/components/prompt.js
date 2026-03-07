import React, {useState} from "react";
import {Box, Text, useInput} from "ink";

export default function Prompt({history, onCommand}) {
	const [input, setInput] = useState("");

	useInput((char, key) => {

		// ENTER
		if (key.return) {
			const command = input.trim();

			if (command) {
				history.add(command);
				onCommand(command);
			}

			setInput("");
			return;
		}

		// HISTORY UP
		if (key.upArrow) {
			const previous = history.up();
			if (previous !== undefined) {
				setInput(previous);
			}
			return;
		}

		// HISTORY DOWN
		if (key.downArrow) {
			const next = history.down();
			if (next !== undefined) {
				setInput(next);
			}
			return;
		}

		// BACKSPACE
		if (key.backspace || key.delete) {
			setInput(prev => prev.slice(0, -1));
			return;
		}

		// IGNORE CONTROL KEYS
		if (key.ctrl || key.meta) {
			return;
		}

		// ADD CHARACTER (only if printable)
		if (char && char.length === 1) {
			setInput(prev => prev + char);
		}
	});

	return (
		<Box>
			<Text color="green">{"> "}</Text>
			<Text color="cyan">{input}</Text>
			<Text color="gray">_</Text>
		</Box>
	);
}