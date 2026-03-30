/**
 * DAPSession wraps DAPClient and manages the lifecycle of a single debug
 * session (launch → pause → inspect → continue → terminate).
 *
 * Tools talk to DAPSession, not DAPClient directly, so that:
 *  - Session state (active thread, launch config) is centralized.
 *  - DAPClient stays a pure protocol driver with no business logic.
 */

import { DAPClient, type DAPTransport } from "./dap-client.js";
import type { DAPStackFrame, DAPVariable } from "../types.js";

type SupportedLanguage = "python" | "node" | "go";

const ADAPTER_CONFIGS: Record<SupportedLanguage, (file: string) => { transport: DAPTransport; program: string }> = {
  python: (file) => ({
    transport: { kind: "stdio", command: "python3", args: ["-m", "debugpy.adapter"] },
    program: file,
  }),
  node: (file) => ({
    transport: { kind: "tcp", host: "127.0.0.1", port: 9229 },
    program: file,
  }),
  go: (file) => ({
    // Delve runs as a DAP server on a fixed port by convention.
    transport: { kind: "tcp", host: "127.0.0.1", port: 2345 },
    program: file,
  }),
};

export class DAPSession {
  private client: DAPClient | null = null;
  private activeThreadId: number | null = null;
  private isInitialized = false;

  async start(file: string, language: SupportedLanguage): Promise<string> {
    const cfg = ADAPTER_CONFIGS[language];
    if (!cfg) {
      throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(ADAPTER_CONFIGS).join(", ")}`);
    }

    const { transport, program } = cfg(file);

    this.client = new DAPClient();
    await this.client.connect(transport);
    await this.client.initialize();

    // Listen for the first "stopped" event to capture the active thread.
    // We do this before launch so we don't miss a stopOnEntry event.
    const stopPromise = this.client.waitForStop(15_000);

    await this.client.launch(program, [], /* stopOnEntry */ true);

    const { threadId } = await stopPromise;
    this.activeThreadId = threadId;
    this.isInitialized = true;

    return `Debug session started for ${file} (${language}). Stopped at entry point, thread ${threadId}.`;
  }

  async getStackTrace(): Promise<DAPStackFrame[]> {
    this.assertReady();
    return this.client!.getStackTrace(this.activeThreadId!);
  }

  async getVariables(frameId: number): Promise<DAPVariable[]> {
    this.assertReady();
    return this.client!.getVariables(frameId);
  }

  async continueExecution(): Promise<string> {
    this.assertReady();
    await this.client!.continueExecution(this.activeThreadId!);

    // Wait for the next stop (breakpoint / exception / end).
    try {
      const { reason } = await this.client!.waitForStop(30_000);
      return `Execution resumed and stopped again. Reason: ${reason}.`;
    } catch {
      // Program may have exited without stopping – that's normal.
      return "Execution resumed. Program may have finished.";
    }
  }

  terminate(): void {
    this.client?.disconnect();
    this.client = null;
    this.activeThreadId = null;
    this.isInitialized = false;
  }

  private assertReady(): void {
    if (!this.isInitialized || !this.client || this.activeThreadId === null) {
      throw new Error(
        "No active debug session. Call start_debugger first."
      );
    }
  }
}
