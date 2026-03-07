import pty from "node-pty";

export function createShell(onOutput) {
	const shell = pty.spawn(
		process.platform === "win32" ? "powershell.exe" : "bash",
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