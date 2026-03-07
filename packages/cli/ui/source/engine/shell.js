import pty from "node-pty";

export function createShell(onOutput) {
	const shell = pty.spawn(
		process.platform === "win32" ? "powershell.exe" : "bash",

		// Windows uses PowerShell, while other platforms use Bash as the default shell.
		// The arguments passed to the shell are determined based on the platform. 
		// For Windows, it includes "-NoLogo" and "-NoProfile" to start PowerShell without loading the profile or displaying the logo. 
		// For other platforms, no additional arguments are passed.
		
		process.platform === "win32"
			? ["-NoLogo", "-NoProfile"]
			: [],
		
		{
			name: "xterm-color",
			cwd: process.cwd(),
			env: process.env
		}
	);

	shell.onData(data => {
		onOutput(data);
	});

	return shell;
}