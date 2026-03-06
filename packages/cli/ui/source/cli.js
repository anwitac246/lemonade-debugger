#!/usr/bin/env node
import React from "react";
import {render} from "ink";
import meow from "meow";
import App from "./app.js";

meow(
	`
Usage
  $ lemonade

Commands
  help        Show help
  debug FILE  Analyze a log or stacktrace

Examples
  $ lemonade
  > help
`,
	{
		importMeta: import.meta
	}
);

render(<App />);