export async function debugAgent(command) {
	const file = command.replace("debug ", "");

	return `Analyzing ${file}...`;
}