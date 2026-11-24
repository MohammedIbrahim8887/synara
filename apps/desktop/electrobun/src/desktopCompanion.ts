import { createCompanionRequestHandler } from "../../src/sonaCompanionRequests";
import { BrowserWindow, Utils } from "electrobun/main";

/** Capability-authenticated loopback channel keeps the renderer's RPC sandbox enabled. */
export function createDesktopCompanion(
  origin: string,
  options: { browserPane?: () => Promise<{ url: string; token: string } | null> } = {},
) {
  const token = crypto.randomUUID();
  let stopped = false;
  const timers = new Map<number, ReturnType<typeof setInterval>>();
  function ready(viewId: number) {
    clearInterval(timers.get(viewId));
    timers.delete(viewId);
  }
  function attach(window: BrowserWindow) {
    const view = window.webview;
    const initialize = () => {
      ready(view.id);
      let attempts = 0;
      const timer = setInterval(() => {
        if (++attempts > 60 || stopped) {
          ready(view.id);
          return;
        }
        view.executeJavascript(preload(view.id));
      }, 250);
      timers.set(view.id, timer);
    };
    // Native navigation fires in sandboxed CEF; its DOM-ready preload event does not.
    // Retry only during document startup and stop as soon as the renderer acknowledges.
    view.on("did-navigate", initialize);
    window.on("close", () => ready(view.id));
    initialize();
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 4096,
    fetch: createCompanionRequestHandler(origin, token, () => stopped, {
      ready,
      notify: Utils.showNotification,
      ...(options.browserPane ? { browserPane: options.browserPane } : {}),
    }),
  });
  function preload(viewId: number) {
    return `if (location.origin === ${JSON.stringify(origin)} && window === window.top && !window.sonaDesktop) {
      const request = async (path, body = {}) => {
        const response = await fetch(${JSON.stringify(`http://127.0.0.1:${server.port}`)} + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: ${JSON.stringify(`Bearer ${token}`)} }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error('Sona desktop action failed');
      };
      const browserPane = async () => {
        const response = await fetch(${JSON.stringify(`http://127.0.0.1:${server.port}`)} + '/browser-pane', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: ${JSON.stringify(`Bearer ${token}`)} }, body: '{}' });
        return response.ok ? response.json() : null;
      };
      Object.defineProperty(window, 'sonaDesktop', { value: Object.freeze({ notify: value => request('/notify', value)${options.browserPane ? ", browserPane" : ""} }) });
      window.dispatchEvent(new Event("sona-desktop-ready"));
      void request("/ready", { viewId: ${viewId} }).catch(() => {});
    }`;
  }
  return {
    attach,
    stop() {
      stopped = true;
      for (const id of timers.keys()) ready(id);
      void server.stop(true);
    },
  };
}
