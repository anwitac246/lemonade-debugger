export class CommandHistory {
	constructor(limit = 200) {
		this.limit = limit;
		this.commands = [];
		this.index = -1;
	}
	// each new command is added to the history, but duplicates are avoided if they are consecutive. The history is also capped at a specified limit, removing the oldest entries when the limit is exceeded.
	add(command) {
		if (!command) return;

		if (this.commands[this.commands.length - 1] !== command) {
			this.commands.push(command);
		}

		if (this.commands.length > this.limit) {
			this.commands.shift();
		}

		this.reset();
	}
	// The up method retrieves the previous command in the history. If the user is not currently navigating through the history (index is -1), it starts from the most recent command. Each call to up moves one step back in the history, and it returns the command at the current index.
	up() {
		if (this.commands.length === 0) return "";

		if (this.index === -1) {
			this.index = this.commands.length - 1;
		} else {
			this.index = Math.max(0, this.index - 1);
		}

		return this.commands[this.index];
	}
	// The down method retrieves the next command in the history. If the user is navigating through the history, each call to down moves one step forward. If the user reaches the end of the history (index exceeds the last command), it resets the index and returns an empty string, indicating that there are no more commands to navigate through.
	down() {
		if (this.index === -1) return "";

		this.index++;

		if (this.index >= this.commands.length) {
			this.reset();
			return "";
		}

		return this.commands[this.index];
	}
	// The reset method resets the navigation index to -1, indicating that the user is not currently navigating through the history.
	reset() {
		this.index = -1;
	}
}