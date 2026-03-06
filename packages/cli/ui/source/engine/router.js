export async function routeCommand(command, shell, debugAgent) {
	if (command.startsWith("debug")) {
		return await debugAgent(command);
	}

	shell.write(command + "\r");

	return null;
}