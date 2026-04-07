/**
 * DAPClient: Minimal but complete Debug Adapter Protocol client.
 *
 * Supports both stdio and tcp transports.
 * All public methods are typed against the DAP spec subset we need.
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
  timer: NodeJS.Timeout;
};

export type DAPTransport =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "stdio"; command: string; args: string[] };

interface BreakpointDef {
  line: number;
  condition?: string;
  logMessage?: string;
  hitCondition?: string;
}

export class DAPClient extends EventEmitter {
  private seq = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private socket: net.Socket | null = null;
  private proc: child_process.ChildProcess | null = null;
  private capabilities: DAPCapabilities = {};
  private readonly REQUEST_TIMEOUT_MS = 15_000;

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(transport: DAPTransport): Promise<void> {
    if (transport.kind === "tcp") {
      await this.connectTcp(transport.host, transport.port);
    } else {
      await this.connectStdio(transport.command, transport.args);
    }
  }

  private connectTcp(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error(`DAP TCP connection timed out (${host}:${port})`));
      }, 5000);

      this.socket = net.createConnection({ host, port }, () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.on("data", (chunk: Buffer) => this.onData(chunk.toString()));
      this.socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      this.socket.on("close", () => this.emit("close"));
    });
  }

  private connectStdio(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = child_process.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.on("error", (err) => reject(err));
      this.proc.on("exit", (code) => {
        this.emit("close");
        if (code !== 0 && code !== null) {
          this.emit("exit-error", code);
        }
      });

      this.proc.stdout!.on("data", (chunk: Buffer) =>
        this.onData(chunk.toString())
      );

      // Give the adapter a moment to initialize, then resolve
      setTimeout(resolve, 100);
    });
  }

  disconnect(): void {
    // Reject all pending requests
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("DAP client disconnected"));
    }
    this.pending.clear();

    this.socket?.destroy();
    this.proc?.kill("SIGTERM");
    this.socket = null;
    this.proc = null;
  }

  // ── Message framing (Content-Length headers, same as LSP) ─────────────────

  private onData(raw: string): void {
    this.buffer += raw;

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Corrupt framing — discard up to next potential header
        this.buffer = this.buffer.slice(headerEnd + 4);
        break;
      }

      const length = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;

      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);

      try {
        this.dispatch(JSON.parse(body) as DAPMessage);
      } catch {
        process.stderr.write(`[DAP] Malformed message: ${body.slice(0, 200)}\n`);
      }
    }
  }

  private dispatch(msg: DAPMessage): void {
    if (msg.type === "response") {
      const res = msg as DAPResponse;
      const pending = this.pending.get(res.request_seq);
      if (!pending) return;
      this.pending.delete(res.request_seq);
      clearTimeout(pending.timer);

      if (res.success) {
        pending.resolve(res.body ?? {});
      } else {
        pending.reject(
          new Error(res.message ?? `DAP command failed: ${res.command}`)
        );
      }
    } else if (msg.type === "event") {
      const evt = msg as DAPEvent;
      this.emit(evt.event, evt.body);
    }
  }

  private send(
    command: string,
    args?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const seq = this.seq++;
    const message: Record<string, unknown> = {
      seq,
      type: "request",
      command,
      ...(args !== undefined ? { arguments: args } : {}),
    };

    const raw = JSON.stringify(message);
    const framed = `Content-Length: ${Buffer.byteLength(raw)}\r\n\r\n${raw}`;

    if (this.socket?.writable) {
      this.socket.write(framed);
    } else if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(framed);
    } else {
      return Promise.reject(new Error("DAP transport not connected or not writable"));
    }

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP request timed out: ${command}`));
      }, this.REQUEST_TIMEOUT_MS);

      this.pending.set(seq, { resolve, reject, timer });
    });
  }

  // ── High-level DAP API ────────────────────────────────────────────────────

  async initialize(): Promise<DAPCapabilities> {
    const body = await this.send("initialize", {
      clientID: "lemonade-cli",
      clientName: "Lemonade CLI",
      adapterID: "lemonade",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
      supportsProgressReporting: false,
    });
    this.capabilities = body as DAPCapabilities;
    return this.capabilities;
  }

  async launch(
    program: string,
    args: string[] = [],
    stopOnEntry = true
  ): Promise<void> {
    await this.send("launch", {
      program,
      args,
      stopOnEntry,
      noDebug: false,
    });
    await this.send("configurationDone").catch(() => {
      // Some adapters don't support configurationDone
    });
  }

  async getThreads(): Promise<DAPThread[]> {
    const body = await this.send("threads");
    return (body["threads"] as DAPThread[]) ?? [];
  }

  async getStackTrace(
    threadId: number,
    startFrame = 0,
    levels = 30
  ): Promise<DAPStackFrame[]> {
    const body = await this.send("stackTrace", {
      threadId,
      startFrame,
      levels,
    });
    return (body["stackFrames"] as DAPStackFrame[]) ?? [];
  }

  async getVariables(frameId: number): Promise<DAPVariable[]> {
    const scopesBody = await this.send("scopes", { frameId });
    const scopes =
      (scopesBody["scopes"] as Array<{
        variablesReference: number;
        name: string;
      }>) ?? [];

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

  async setBreakpoint(
    file: string,
    line: number,
    options: {
      condition?: string;
      logMessage?: string;
      hitCondition?: string;
    } = {}
  ): Promise<void> {
    const bp: BreakpointDef = { line };
    if (options.condition) bp.condition = options.condition;
    if (options.logMessage) bp.logMessage = options.logMessage;
    if (options.hitCondition) bp.hitCondition = options.hitCondition;

    await this.send("setBreakpoints", {
      source: { path: file },
      breakpoints: [bp],
    });
  }

  waitForStop(
    timeoutMs = 30_000
  ): Promise<{ threadId: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for debugger to stop (${timeoutMs}ms)`)),
        timeoutMs
      );

      this.once(
        "stopped",
        (body: { threadId: number; reason: string }) => {
          clearTimeout(timer);
          resolve(body);
        }
      );
    });
  }
}