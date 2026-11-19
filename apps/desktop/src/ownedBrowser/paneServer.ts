import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { ThreadBrowserState, ThreadId } from "@synara/contracts";
import { WebSocketServer, type WebSocket } from "ws";

import type { LoadMilestone, OwnedBrowser, PaneInput } from "./ownedBrowser";

const MAX_MESSAGE_BYTES = 256 * 1024;
const AUTH_TIMEOUT_MS = 5_000;
/** Frames are dropped, not queued, while a slow client drains its socket. */
const MAX_BUFFERED_FRAME_BYTES = 4 * 1024 * 1024;

type CallMethod =
  | "open"
  | "close"
  | "hide"
  | "getState"
  | "setPanelBounds"
  | "navigate"
  | "reload"
  | "goBack"
  | "goForward"
  | "newTab"
  | "closeTab"
  | "selectTab"
  | "capturePreview"
  | "captureScreenshot";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown, max = 8_192): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Normalizes an address-bar entry to a URL Chromium can load. */
export function normalizePaneUrl(raw: string): string {
  const value = raw.trim();
  if (/^(https?|file|about|data):/iu.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/iu.test(value)) return `http://${value}`;
  if (/^[^\s/]+\.[^\s/]{2,}(\/.*)?$/u.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function parsePaneInput(value: unknown): PaneInput | null {
  if (!isRecord(value)) return null;
  const modifiers = Math.max(0, Math.min(15, Math.trunc(finite(value.modifiers))));
  switch (value.kind) {
    case "mouse": {
      const type = value.type;
      if (type !== "mousePressed" && type !== "mouseReleased" && type !== "mouseMoved") return null;
      const button = value.button;
      if (button !== "none" && button !== "left" && button !== "middle" && button !== "right") {
        return null;
      }
      return {
        kind: "mouse",
        type,
        x: finite(value.x),
        y: finite(value.y),
        button,
        buttons: Math.max(0, Math.min(31, Math.trunc(finite(value.buttons)))),
        clickCount: Math.max(0, Math.min(3, Math.trunc(finite(value.clickCount)))),
        modifiers,
      };
    }
    case "wheel":
      return {
        kind: "wheel",
        x: finite(value.x),
        y: finite(value.y),
        deltaX: Math.max(-10_000, Math.min(10_000, finite(value.deltaX))),
        deltaY: Math.max(-10_000, Math.min(10_000, finite(value.deltaY))),
        modifiers,
      };
    case "key": {
      const type = value.type;
      if (type !== "keyDown" && type !== "rawKeyDown" && type !== "keyUp") return null;
      const key = asString(value.key, 64);
      if (!key) return null;
      const text =
        typeof value.text === "string" && value.text.length <= 8 ? value.text : undefined;
      const commands = Array.isArray(value.commands)
        ? value.commands.filter(
            (command): command is string =>
              typeof command === "string" && /^[a-zA-Z]{1,40}$/u.test(command),
          )
        : undefined;
      return {
        kind: "key",
        type,
        key,
        code: asString(value.code, 64) ?? "",
        keyCode: Math.max(0, Math.min(255, Math.trunc(finite(value.keyCode)))),
        modifiers,
        ...(text ? { text } : {}),
        ...(commands?.length ? { commands: commands.slice(0, 4) } : {}),
        ...(value.location === 1 || value.location === 2 ? { location: value.location } : {}),
        ...(value.repeat === true ? { repeat: true } : {}),
      };
    }
    case "text": {
      const text = typeof value.text === "string" ? value.text.slice(0, 65_536) : "";
      return text ? { kind: "text", text } : null;
    }
    default:
      return null;
  }
}

export interface PaneServerOptions {
  readonly browser: OwnedBrowser;
  /** The only page origin allowed to connect (Sona's backend origin). */
  readonly allowedOrigin: string;
  readonly token: string;
}

/**
 * Loopback channel between Sona's browser pane and the owned Chromium. A
 * connection must come from Sona's own page origin and present the token the
 * desktop shell injected into that page before it gets any state or input.
 */
export class PaneServer {
  private readonly server: Server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  private readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  private readonly clients = new Set<WebSocket>();
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly options: PaneServerOptions) {
    this.server.on("upgrade", (request, socket, head) => {
      if (request.headers.origin !== options.allowedOrigin || request.url !== "/pane") {
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (client) => this.accept(client));
    });
    this.unsubscribe.push(
      options.browser.onState((state) => this.broadcast({ type: "state", state })),
      options.browser.onOpenPanel((threadId) => this.broadcast({ type: "openPanel", threadId })),
    );
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Pane server has no port.");
    return address.port;
  }

  async close(): Promise<void> {
    for (const dispose of this.unsubscribe) dispose();
    for (const client of this.clients) client.terminate();
    await new Promise<void>((resolve) => this.sockets.close(() => resolve()));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private accept(client: WebSocket): void {
    let authenticated = false;
    let frameSubscription: { key: string; dispose: () => void } | null = null;
    const authTimer = setTimeout(() => client.close(4001, "auth"), AUTH_TIMEOUT_MS);
    const send = (message: unknown) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
    };
    const cleanup = () => {
      clearTimeout(authTimer);
      frameSubscription?.dispose();
      frameSubscription = null;
      this.clients.delete(client);
    };
    client.on("close", cleanup);
    client.on("error", cleanup);
    client.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        client.close(4002, "malformed");
        return;
      }
      if (!isRecord(message)) return;
      if (!authenticated) {
        const supplied = Buffer.from(typeof message.token === "string" ? message.token : "");
        const expected = Buffer.from(this.options.token);
        if (
          message.type !== "auth" ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          client.close(4003, "unauthorized");
          return;
        }
        authenticated = true;
        clearTimeout(authTimer);
        this.clients.add(client);
        send({ type: "ready" });
        return;
      }
      switch (message.type) {
        case "call":
          void this.call(message.method as CallMethod, message.params).then(
            (result) => send({ type: "result", id: message.id, result }),
            (error: unknown) =>
              send({
                type: "result",
                id: message.id,
                error: error instanceof Error ? error.message : "Browser action failed.",
              }),
          );
          return;
        case "subscribe": {
          const tabId = asString(message.tabId, 128);
          const key = tabId ?? "";
          if (frameSubscription?.key === key) return;
          frameSubscription?.dispose();
          frameSubscription = null;
          const tab = tabId ? this.options.browser.tab(tabId) : undefined;
          if (!tab) return;
          frameSubscription = {
            key,
            dispose: this.options.browser.subscribeFrames(tab, (frame) => {
              if (client.bufferedAmount > MAX_BUFFERED_FRAME_BYTES) return;
              send({ type: "frame", ...frame });
            }),
          };
          return;
        }
        case "input": {
          const tab = this.options.browser.tab(asString(message.tabId, 128) ?? "");
          const input = parsePaneInput(message.input);
          if (!tab || !input) return;
          void this.options.browser.dispatchInput(tab, input).catch(() => {});
          return;
        }
      }
    });
  }

  private async call(method: CallMethod, rawParams: unknown): Promise<unknown> {
    const browser = this.options.browser;
    const params = isRecord(rawParams) ? rawParams : {};
    const threadId = asString(params.threadId, 256) as ThreadId | null;
    if (!threadId) throw new Error("Missing thread.");
    const tabFor = (tabId: unknown) => {
      const tab = browser.tab(asString(tabId, 128) ?? "") ?? browser.activeTab(threadId);
      if (!tab || tab.threadId !== threadId) throw new Error("Unknown browser tab.");
      return tab;
    };
    const state = (): ThreadBrowserState => browser.getState(threadId);
    const settle = (operation: Promise<unknown>) =>
      operation.then(state, (error: unknown) => {
        // Page errors surface on the tab itself; the pane still gets fresh state.
        if (error instanceof Error && /Navigation (failed|timed out)/u.test(error.message)) {
          return state();
        }
        throw error;
      });
    const commit: LoadMilestone = "commit";
    switch (method) {
      case "open": {
        const initialUrl = asString(params.initialUrl);
        return browser.openThread(threadId, initialUrl ? normalizePaneUrl(initialUrl) : undefined);
      }
      case "close":
        return browser.closeThread(threadId);
      case "hide":
        return null;
      case "getState":
        return state();
      case "setPanelBounds": {
        const bounds = isRecord(params.bounds) ? params.bounds : null;
        if (bounds && !params.occluded) {
          await browser.setPaneViewport(threadId, {
            width: finite(bounds.width, 1280),
            height: finite(bounds.height, 800),
            deviceScaleFactor: finite(params.deviceScaleFactor, 1),
          });
        }
        return null;
      }
      case "navigate": {
        const url = asString(params.url);
        if (!url) throw new Error("Missing URL.");
        const tab = tabFor(params.tabId);
        await browser.releaseAgentViewport(tab);
        return settle(browser.navigate(tab, normalizePaneUrl(url), commit, 30_000));
      }
      case "reload":
        return settle(browser.navigateBy(tabFor(params.tabId), "reload", commit, 30_000));
      case "goBack":
        return settle(browser.navigateBy(tabFor(params.tabId), "back", commit, 30_000));
      case "goForward":
        return settle(browser.navigateBy(tabFor(params.tabId), "forward", commit, 30_000));
      case "newTab": {
        const tab = await browser.createTab(threadId, { activate: params.activate !== false });
        const url = asString(params.url);
        if (url) return settle(browser.navigate(tab, normalizePaneUrl(url), commit, 30_000));
        return state();
      }
      case "closeTab": {
        await browser.closeTab(tabFor(params.tabId));
        return state();
      }
      case "selectTab":
        browser.selectTab(threadId, tabFor(params.tabId).id);
        return state();
      case "capturePreview":
        return browser.captureJpeg(tabFor(params.tabId));
      case "captureScreenshot": {
        const tab = tabFor(params.tabId);
        const result = (await tab.contents.debugger.sendCommand("Page.captureScreenshot", {
          format: "png",
        })) as { data?: string };
        if (!result.data) throw new Error("Screenshot failed.");
        return { data: result.data };
      }
      default:
        throw new Error("Unsupported browser action.");
    }
  }
}
