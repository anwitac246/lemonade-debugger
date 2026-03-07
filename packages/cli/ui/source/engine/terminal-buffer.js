export class TerminalBuffer {
	constructor(limit = 500) {
		this.limit = limit;
		this.lines = [];
	}

	push(data) {
		const cleaned = data.replace(/\r/g, "");
		const newLines = cleaned.split("\n").filter(Boolean);

		this.lines.push(...newLines);

		if (this.lines.length > this.limit) {
			this.lines.splice(0, this.lines.length - this.limit);
		}
	}

	getLines() {
		return this.lines;
	}

	clear() {
		this.lines = [];
	}
}