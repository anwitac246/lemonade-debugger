import React, {useState} from "react";
import {Box, Text, useInput} from "ink";

export default function Prompt({history, onCommand}) {
	const [input, setInput] = useState("");

	useInput((char, key) => {
		if (key.return) {
			const command = input.trim();

			if (command) {
				history.add(command);
				onCommand(command);
			}

			setInput("");
		}

		else if (key.upArrow) {
			setInput(history.up());
		}

		else if (key.downArrow) {
			setInput(history.down());
		}

		else if (key.backspace || key.delete) {
			setInput(prev => prev.slice(0, -1));
		}

		else {
			setInput(prev => prev + char);
		}
	});

	return (
		<Box>
			<Text color="green">{"> "}</Text>
			<Text>{input}_</Text>
		</Box>
	);
}