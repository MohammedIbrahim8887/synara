// Sona's in-app browser: a Chromium owned by the Sona desktop shell, streamed
// into the browser pane over a loopback socket. This adapts that channel to the
// same `desktopBridge.browser` surface Synara's Electron app provides.
import type {
  BrowserCaptureScreenshotResult,
  BrowserUseOpenPanelRequest,
  DesktopBridge,
  ThreadBrowserState,
  ThreadId,
} from "@synara/contracts";

import "./sonaDesktop";

export interface SonaBrowserFrame {
  readonly tabId: string;
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

export type SonaBrowserInput =
  | {
      kind: "mouse";
      type: "mousePressed" | "mouseReleased" | "mouseMoved";
      x: number;
      y: number;
      button: "none" | "left" | "middle" | "right";
      buttons: number;
      clickCount: number;
      modifiers: number;
    }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | {
      kind: "key";
      type: "keyDown" | "rawKeyDown" | "keyUp";
      key: string;
      code: string;
      keyCode: number;
      modifiers: number;
      text?: string;
      commands?: string[];
      location?: number;
      repeat?: boolean;
    }
  | { kind: "text"; text: string };

const CALL_TIMEOUT_MS = 45_000;
const ENDPOINT_RETRY_MS = 500;
const ENDPOINT_ATTEMPTS = 60;

class SonaBrowserPaneClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly stateListeners = new Set<(state: ThreadBrowserState) => void>();
  private readonly openPanelListeners = new Set<(request: BrowserUseOpenPanelRequest) => void>();
  private readonly frameListeners = new Map<string, Set<(frame: SonaBrowserFrame) => void>>();
  private subscribedTabId: string | null = null;

  private connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    this.connecting ??= this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(): Promise<WebSocket> {
    const desktop = window.sonaDesktop;
    if (!desktop?.browserPane) throw new Error("The in-app browser requires the Sona app.");
    let endpoint: { url: string; token: string } | null = null;
    // Chromium starts alongside the window; give it a moment on first use.
    for (let attempt = 0; attempt < ENDPOINT_ATTEMPTS && !endpoint; attempt += 1) {
      endpoint = await desktop.browserPane().catch(() => null);
      if (!endpoint) await new Promise((resolve) => setTimeout(resolve, ENDPOINT_RETRY_MS));
    }
    if (!endpoint) {
      throw new Error(
        "The in-app browser needs Google Chrome, Chromium, Edge or Brave installed on this Mac.",
      );
    }
    const socket = new WebSocket(endpoint.url);
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error("Could not connect to the in-app browser."));
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token: endpoint.token }));
      });
      socket.addEventListener("message", function onReady(event) {
        if (typeof event.data !== "string" || !event.data.includes('"ready"')) return;
        socket.removeEventListener("message", onReady);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        resolve();
      });
    });
    socket.addEventListener("message", (event) => this.onMessage(event));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("The in-app browser disconnected."));
      }
      this.pending.clear();
      // Keep a visible pane live across a host restart.
      if (this.subscribedTabId) {
        setTimeout(() => void this.resubscribe(), ENDPOINT_RETRY_MS);
      }
    });
    this.socket = socket;
    if (this.subscribedTabId) {
      socket.send(JSON.stringify({ type: "subscribe", tabId: this.subscribedTabId }));
    }
    return socket;
  }

  private async resubscribe(): Promise<void> {
    await this.connect().catch(() => {});
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.type) {
      case "result": {
        const pending = this.pending.get(message.id as number);
        if (!pending) return;
        this.pending.delete(message.id as number);
        if (typeof message.error === "string") pending.reject(new Error(message.error));
        else pending.resolve(message.result);
        return;
      }
      case "state":
        for (const listener of this.stateListeners) listener(message.state as ThreadBrowserState);
        return;
      case "openPanel":
        for (const listener of this.openPanelListeners) {
          listener({ threadId: message.threadId as ThreadId });
        }
        return;
      case "frame": {
        const frame = message as unknown as SonaBrowserFrame;
        for (const listener of this.frameListeners.get(frame.tabId) ?? []) listener(frame);
        return;
      }
    }
  }

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const socket = await this.connect();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The in-app browser did not respond."));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ type: "call", id, method, params }));
    });
  }

  /** One live stream per window: the pane that is currently showing. */
  subscribeFrames(tabId: string, listener: (frame: SonaBrowserFrame) => void): () => void {
    let listeners = this.frameListeners.get(tabId);
    if (!listeners) {
      listeners = new Set();
      this.frameListeners.set(tabId, listeners);
    }
    listeners.add(listener);
    this.subscribedTabId = tabId;
    void this.connect()
      .then((socket) => socket.send(JSON.stringify({ type: "subscribe", tabId })))
      .catch(() => {});
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.frameListeners.delete(tabId);
      if (this.subscribedTabId === tabId && !this.frameListeners.has(tabId)) {
        this.subscribedTabId = null;
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: "subscribe", tabId: null }));
        }
      }
    };
  }

  sendInput(tabId: string, input: SonaBrowserInput): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "input", tabId, input }));
  }

  onState(listener: (state: ThreadBrowserState) => void): () => void {
    this.stateListeners.add(listener);
    // Pushes only flow on an open socket; connect so agent-driven changes arrive.
    void this.connect().catch(() => {});
    return () => this.stateListeners.delete(listener);
  }

  onOpenPanel(listener: (request: BrowserUseOpenPanelRequest) => void): () => void {
    this.openPanelListeners.add(listener);
    void this.connect().catch(() => {});
    return () => this.openPanelListeners.delete(listener);
  }
}

let client: SonaBrowserPaneClient | null = null;

/** The Sona pane client, or null outside the Sona desktop app. */
export function readSonaBrowserPane(): SonaBrowserPaneClient | null {
  if (typeof window === "undefined" || window.desktopBridge || !window.sonaDesktop?.browserPane) {
    return null;
  }
  client ??= new SonaBrowserPaneClient();
  return client;
}

const base64ToBytes = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

type BrowserBridge = DesktopBridge["browser"];

let bridge: BrowserBridge | null = null;

const unsupported = (feature: string) => async () => {
  throw new Error(`${feature} is not available in Sona's browser yet.`);
};

/** Adapts the Sona pane client to the Electron `desktopBridge.browser` shape. */
export function readSonaBrowserBridge(): BrowserBridge | null {
  const pane = readSonaBrowserPane();
  if (!pane) return null;
  bridge ??= createSonaBrowserBridge(pane);
  return bridge;
}

function createSonaBrowserBridge(pane: SonaBrowserPaneClient): BrowserBridge {
  const state = (method: string) => (params: object) =>
    pane.call<ThreadBrowserState>(method, params as Record<string, unknown>);
  const activeUrl = async (threadId: ThreadId, tabId: string) => {
    const current = await pane.call<ThreadBrowserState>("getState", { threadId });
    return current.tabs.find((tab) => tab.id === tabId)?.url ?? "";
  };
  const screenshot = async (input: {
    threadId: ThreadId;
    tabId: string;
  }): Promise<BrowserCaptureScreenshotResult> => {
    const { data } = await pane.call<{ data: string }>("captureScreenshot", { ...input });
    const bytes = base64ToBytes(data);
    return {
      name: `browser-${new Date().toISOString().replace(/[:.]/gu, "-")}.png`,
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      bytes,
    };
  };
  return {
    open: state("open"),
    close: state("close"),
    hide: async (input) => {
      await pane.call("hide", input as unknown as Record<string, unknown>);
    },
    getState: state("getState"),
    setPanelBounds: async (input) => {
      await pane.call("setPanelBounds", {
        ...input,
        deviceScaleFactor: window.devicePixelRatio || 1,
      });
    },
    attachWebview: state("getState"),
    detachWebview: async () => {},
    copyLink: async (input) => {
      await navigator.clipboard.writeText(await activeUrl(input.threadId, input.tabId));
    },
    copyScreenshotToClipboard: async (input) => {
      const result = await screenshot(input);
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        }),
      ]);
    },
    captureScreenshot: screenshot,
    capturePreview: (input) => pane.call<string | null>("capturePreview", { ...input }),
    navigate: state("navigate"),
    reload: state("reload"),
    goBack: state("goBack"),
    goForward: state("goForward"),
    newTab: state("newTab"),
    closeTab: state("closeTab"),
    selectTab: state("selectTab"),
    openDevTools: unsupported("Developer tools"),
    annotations: {
      start: unsupported("Page annotations"),
      cancel: async () => {},
      syncMarkers: async () => {},
      onEvent: () => () => {},
    },
    onState: (listener) => pane.onState(listener),
    onBrowserUseOpenPanelRequest: (listener) => pane.onOpenPanel(listener),
    onBrowserCopyLink: () => () => {},
  } as BrowserBridge;
}
