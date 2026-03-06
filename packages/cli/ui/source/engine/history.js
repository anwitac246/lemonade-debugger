export class CommandHistory {
	constructor(limit = 200) {
		this.limit = limit;
		this.commands = [];
		this.index = -1;
	}

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

	up() {
		if (this.commands.length === 0) return "";

		if (this.index === -1) {
			this.index = this.commands.length - 1;
		} else {
			this.index = Math.max(0, this.index - 1);
		}

		return this.commands[this.index];
	}

	down() {
		if (this.index === -1) return "";

		this.index++;

		if (this.index >= this.commands.length) {
			this.reset();
			return "";
		}

		return this.commands[this.index];
	}

	reset() {
		this.index = -1;
	}
}