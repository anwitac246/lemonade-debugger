/**
 * DAPSession: High-level debug session lifecycle manager.
 *
 * Wraps DAPClient and handles:
 * - Multi-language adapter configuration
 * - Thread tracking
 * - Graceful error recovery
 */

import { DAPClient, type DAPTransport } from "./dap-client.js";
import type { DAPStackFrame, DAPVariable, DAPLanguage } from "../types.js";

type AdapterConfig = {
  transport: DAPTransport;
  program: string;
  programArgs?: string[];
};

const ADAPTER_FACTORY: Record<
  DAPLanguage,
  (file: string, args?: string[]) => AdapterConfig
> = {
  python: (file, args) => ({
    transport: {
      kind: "stdio",
      command: "python3",
      args: ["-m", "debugpy.adapter"],
    },
    program: file,
    programArgs: args,
  }),
  node: (file, args) => ({
    // js-debug runs as a DAP server on a user-specified port
    transport: { kind: "tcp", host: "127.0.0.1", port: 9229 },
    program: file,
    programArgs: args,
  }),
  go: (file, args) => ({
    // Delve runs as a DAP server
    transport: { kind: "tcp", host: "127.0.0.1", port: 2345 },
    program: file,
    programArgs: args,
  }),
  rust: (file, args) => ({
    // CodeLLDB or lldb-vscode
    transport: { kind: "tcp", host: "127.0.0.1", port: 13000 },
    program: file,
    programArgs: args,
  }),
  java: (file, args) => ({
    // java-debug (vscode-java-debug)
    transport: { kind: "tcp", host: "127.0.0.1", port: 5005 },
    program: file,
    programArgs: args,
  }),
};

interface BreakpointOptions {
  condition?: string;
  logMessage?: string;
  hitCondition?: string;
}

export class DAPSession {
  private client: DAPClient | null = null;
  private activeThreadId: number | null = null;
  private isRunning = false;
  private currentFile: string | null = null;

  // ── Public API ────────────────────────────────────────────────────────────

  async start(
    file: string,
    language: DAPLanguage,
    args?: string[],
    stopOnEntry = true
  ): Promise<string> {
    const factory = ADAPTER_FACTORY[language];
    if (!factory) {
      throw new Error(
        `Unsupported language: "${language}". Supported: ${Object.keys(ADAPTER_FACTORY).join(", ")}`
      );
    }

    // Terminate any existing session
    this.terminate();

    const { transport, program, programArgs } = factory(file, args);

    this.client = new DAPClient();
    await this.client.connect(transport);
    await this.client.initialize();

    this.currentFile = file;

    // Listen for initial stop BEFORE launch
    const stopPromise = this.client.waitForStop(20_000);

    await this.client.launch(program, programArgs ?? [], stopOnEntry);

    const { threadId, reason } = await stopPromise;
    this.activeThreadId = threadId;
    this.isRunning = true;

    return (
      `Debug session started: ${file} (${language})\n` +
      `Stopped at entry — thread ${threadId}, reason: ${reason}`
    );
  }

  async setBreakpoint(
    file: string,
    line: number,
    options: BreakpointOptions = {}
  ): Promise<void> {
    this.assertReady();
    await this.client!.setBreakpoint(file, line, options);
  }

  async getStackTrace(): Promise<DAPStackFrame[]> {
    this.assertReady();
    return this.client!.getStackTrace(this.activeThreadId!);
  }

  async getVariables(frameId: number): Promise<DAPVariable[]> {
    this.assertReady();
    return this.client!.getVariables(frameId);
  }

  async continueExecution(timeoutMs = 30_000): Promise<string> {
    this.assertReady();
    await this.client!.continueExecution(this.activeThreadId!);

    try {
      const { reason, threadId } = await this.client!.waitForStop(timeoutMs);
      this.activeThreadId = threadId;
      return `Execution resumed and paused again. Reason: ${reason} (thread ${threadId}).`;
    } catch {
      // Program exited without stopping — normal end of execution
      this.isRunning = false;
      return "Execution resumed. Program appears to have finished.";
    }
  }

  terminate(): void {
    try {
      this.client?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.client = null;
    this.activeThreadId = null;
    this.isRunning = false;
    this.currentFile = null;
  }

  get active(): boolean {
    return this.isRunning && this.client !== null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private assertReady(): void {
    if (!this.isRunning || !this.client || this.activeThreadId === null) {
      throw new Error(
        "No active debug session. Call start_debugger first."
      );
    }
  }
}