/**
 * Provides a way to route commands entered in the CLI to the appropriate handlers. 
 * It checks if the command starts with "lemonade debug" and routes it to the debugAgent function. 
 * If the command does not match this pattern, it writes the command to the shell for execution.
 * 
 * @param {*} command 
 * @param {*} shell 
 * @param {*} debugAgent 
 * @returns 
 */

export async function routeCommand(command, shell, debugAgent) {

	if (command.startsWith("lemonade debug")) {
		return await debugAgent(command);
	}

	shell.write(command + "\r");

	return null;
}