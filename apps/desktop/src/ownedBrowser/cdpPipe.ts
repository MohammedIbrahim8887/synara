import type { Readable, Writable } from "node:stream";

export type CdpParams = Record<string, unknown>;

export interface CdpEvent {
  readonly method: string;
  readonly params: CdpParams;
  readonly sessionId?: string;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

/** Called synchronously, in wire order with events, when the reply arrives. */
export type CdpReplyCallback = (error: Error | null, result: unknown) => void;

/** Bounded per-message input. Screenshots are the largest replies (~11 MiB base64). */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export class CdpError extends Error {
  constructor(
    readonly method: string,
    message: string,
  ) {
    super(`${method}: ${message}`);
    this.name = "CdpError";
  }
}

/**
 * Chromium DevTools protocol over `--remote-debugging-pipe`: NUL-delimited JSON
 * on fd 3 (to Chromium) and fd 4 (from Chromium). No port is opened, so only
 * this process can drive the browser.
 */
export class CdpPipe {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private closedError: Error | null = null;

  constructor(
    private readonly output: Writable,
    input: Readable,
  ) {
    input.on("data", (chunk: Buffer) => this.onData(chunk));
    input.on("close", () => this.fail(new Error("Browser connection closed.")));
    input.on("error", (error) => this.fail(error));
    output.on("error", (error) => this.fail(error));
  }

  get closed(): boolean {
    return this.closedError !== null;
  }

  send<T = unknown>(method: string, params: CdpParams = {}, sessionId?: string): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject });
      const message = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
      this.output.write(`${message}\0`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  /**
   * Like `send`, but reports the reply synchronously from the read loop so a
   * consumer can keep replies and events in the order Chromium sent them.
   */
  sendOrdered(
    method: string,
    params: CdpParams,
    sessionId: string | undefined,
    callback: CdpReplyCallback,
  ): void {
    if (this.closedError) {
      callback(this.closedError, undefined);
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, {
      method,
      resolve: (value) => callback(null, value),
      reject: (error) => callback(error, undefined),
    });
    const message = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    this.output.write(`${message}\0`, (error) => {
      if (!error || !this.pending.delete(id)) return;
      callback(error, undefined);
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.fail(new Error("Browser connection closed."));
    this.output.end();
  }

  private onData(chunk: Buffer): void {
    let start = 0;
    for (let index = chunk.indexOf(0); index !== -1; index = chunk.indexOf(0, start)) {
      this.chunks.push(chunk.subarray(start, index));
      const message = Buffer.concat(this.chunks).toString("utf8");
      this.chunks = [];
      this.bufferedBytes = 0;
      start = index + 1;
      this.dispatch(message);
    }
    if (start < chunk.length) {
      this.bufferedBytes += chunk.length - start;
      if (this.bufferedBytes > MAX_MESSAGE_BYTES) {
        this.fail(new Error("Browser message exceeded the size limit."));
        return;
      }
      this.chunks.push(chunk.subarray(start));
    }
  }

  private dispatch(raw: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: CdpParams;
      sessionId?: string;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CdpError(pending.method, message.error.message ?? "Command failed."));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const event: CdpEvent = {
      method: message.method,
      params: message.params ?? {},
      ...(message.sessionId ? { sessionId: message.sessionId } : {}),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[owned-browser] CDP listener failed:", error);
      }
    }
  }

  private fail(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
