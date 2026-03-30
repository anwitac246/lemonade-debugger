/**
 * DAPClient: a minimal but complete Debug Adapter Protocol client.
 *
 * The DAP is a JSON-RPC-like protocol where every request carries a monotonically
 * increasing sequence number (seq). The adapter echoes that seq back in the
 * response's `request_seq` field, which is how we match responses to pending
 * promises without a correlation ID map per-request.
 *
 * We support two transports because different adapters ship differently:
 *  - stdio: the adapter is a child process (e.g. debugpy, js-debug)
 *  - tcp:   the adapter listens on a port (e.g. Delve for Go)
 */

import { EventEmitter } from "events";
import * as net from "net";
import * as child_process from "child_process";
import type { DAPCapabilities, DAPStackFrame, DAPVariable, DAPThread } from "../types.js";

interface DAPMessage {
  seq: number;
  type: "request" | "response" | "event";
  [key: string]: unknown;
}

interface DAPResponse extends DAPMessage {
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  body?: Record<string, unknown>;
  message?: string;
}

interface DAPEvent extends DAPMessage {
  type: "event";
  event: string;
  body?: Record<string, unknown>;
}

type PendingRequest = {
  resolve: (body: Record<string, unknown>) => void;
  reject: (err: Error) => void;
};

export type DAPTransport =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "stdio"; command: string; args: string[] };

export class DAPClient extends EventEmitter {
  private seq = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private socket: net.Socket | null = null;
  private proc: child_process.ChildProcess | null = null;
  private capabilities: DAPCapabilities = {};

  // ──────────────────────────────────────────────────────────────────────────
  // Connection
  // ──────────────────────────────────────────────────────────────────────────

  async connect(transport: DAPTransport): Promise<void> {
    if (transport.kind === "tcp") {
      await this.connectTcp(transport.host, transport.port);
    } else {
      await this.connectStdio(transport.command, transport.args);
    }
  }

  private connectTcp(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host, port }, () => resolve());
      this.socket.on("data", (chunk: Buffer) => this.onData(chunk.toString()));
      this.socket.on("error", reject);
      this.socket.on("close", () => this.emit("close"));
    });
  }

  private connectStdio(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = child_process.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.on("error", reject);
      this.proc.on("exit", () => this.emit("close"));

      this.proc.stdout!.on("data", (chunk: Buffer) =>
        this.onData(chunk.toString())
      );

      // Resolve once the process is alive; the adapter sends its capabilities
      // in the initialize response, not on spawn.
      resolve();
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.proc?.kill();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DAP message framing (Content-Length headers, same as LSP)
  // ──────────────────────────────────────────────────────────────────────────

  private onData(raw: string): void {
    this.buffer += raw;

    // The DAP wire format is identical to LSP:
    //   Content-Length: <n>\r\n\r\n<json of length n>
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;

      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;

      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);

      try {
        this.dispatch(JSON.parse(body) as DAPMessage);
      } catch {
        // Malformed JSON from adapter – log and continue.
        process.stderr.write(`[DAP] Malformed message: ${body}\n`);
      }
    }
  }

  private dispatch(msg: DAPMessage): void {
    if (msg.type === "response") {
      const res = msg as DAPResponse;
      const pending = this.pending.get(res.request_seq);
      if (!pending) return;
      this.pending.delete(res.request_seq);

      if (res.success) {
        pending.resolve(res.body ?? {});
      } else {
        pending.reject(new Error(res.message ?? `DAP command failed: ${res.command}`));
      }
    } else if (msg.type === "event") {
      const evt = msg as DAPEvent;
      // Re-emit DAP events (stopped, terminated, output …) for consumers.
      this.emit(evt.event, evt.body);
    }
  }

  private send(command: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const seq = this.seq++;
    const message: Record<string, unknown> = {
      seq,
      type: "request",
      command,
      ...(args ? { arguments: args } : {}),
    };

    const raw = JSON.stringify(message);
    const framed = `Content-Length: ${Buffer.byteLength(raw)}\r\n\r\n${raw}`;

    if (this.socket) {
      this.socket.write(framed);
    } else if (this.proc?.stdin) {
      this.proc.stdin.write(framed);
    } else {
      return Promise.reject(new Error("DAP transport not connected"));
    }

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      // 10s timeout prevents hangs when the adapter crashes silently.
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP request timed out: ${command}`));
      }, 10_000);

      this.pending.set(seq, {
        resolve: (body) => { clearTimeout(timer); resolve(body); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // High-level DAP API
  // ──────────────────────────────────────────────────────────────────────────

  async initialize(): Promise<DAPCapabilities> {
    const body = await this.send("initialize", {
      clientID: "ai-cli",
      clientName: "AI CLI",
      adapterID: "ai-cli",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
    this.capabilities = body as DAPCapabilities;
    return this.capabilities;
  }

  async launch(program: string, args: string[] = [], stopOnEntry = true): Promise<void> {
    await this.send("launch", { program, args, stopOnEntry, noDebug: false });
    await this.send("configurationDone");
  }

  async getThreads(): Promise<DAPThread[]> {
    const body = await this.send("threads");
    return (body["threads"] as DAPThread[]) ?? [];
  }

  async getStackTrace(threadId: number): Promise<DAPStackFrame[]> {
    const body = await this.send("stackTrace", { threadId, startFrame: 0, levels: 20 });
    return (body["stackFrames"] as DAPStackFrame[]) ?? [];
  }

  async getVariables(frameId: number): Promise<DAPVariable[]> {
    // We need to get the scopes for the frame first, then variables for each scope.
    const scopesBody = await this.send("scopes", { frameId });
    const scopes = (scopesBody["scopes"] as Array<{ variablesReference: number; name: string }>) ?? [];

    const allVars: DAPVariable[] = [];
    for (const scope of scopes) {
      if (scope.variablesReference === 0) continue;
      const varsBody = await this.send("variables", {
        variablesReference: scope.variablesReference,
      });
      const vars = (varsBody["variables"] as DAPVariable[]) ?? [];
      allVars.push(...vars);
    }
    return allVars;
  }

  async continueExecution(threadId: number): Promise<void> {
    await this.send("continue", { threadId });
  }

  async setBreakpoint(file: string, line: number): Promise<void> {
    await this.send("setBreakpoints", {
      source: { path: file },
      breakpoints: [{ line }],
    });
  }

  /** Waits for the adapter to emit a "stopped" event (breakpoint/exception hit). */
  waitForStop(timeoutMs = 30_000): Promise<{ threadId: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for debugger to stop")),
        timeoutMs
      );

      this.once("stopped", (body: { threadId: number; reason: string }) => {
        clearTimeout(timer);
        resolve(body);
      });
    });
  }
}
