import { createCompanionRequestHandler } from "../../src/sonaCompanionRequests";
import { BrowserWindow, Screen, Utils } from "electrobun/main";
import { islandFrame, raiseIntoNotch, type IslandMode } from "./notchWindow";

/** Capability-authenticated loopback channel keeps the renderer's RPC sandbox enabled. */
export function createDesktopCompanion(origin: string, appUrl: string) {
  const token = crypto.randomUUID();
  let stopped = false;
  const timers = new Map<number, ReturnType<typeof setInterval>>();
  function ready(viewId: number) {
    clearInterval(timers.get(viewId));
    timers.delete(viewId);
  }
  function attach(
    window: BrowserWindow,
    islandView: Exclude<IslandMode, "hidden"> | false = false,
  ) {
    const view = window.webview;
    const initialize = () => {
      ready(view.id);
      let attempts = 0;
      const timer = setInterval(() => {
        if (++attempts > 60 || stopped) {
          ready(view.id);
          return;
        }
        view.executeJavascript(preload(islandView, view.id));
      }, 250);
      timers.set(view.id, timer);
    };
    // Native navigation fires in sandboxed CEF; its DOM-ready preload event does not.
    // Retry only during document startup and stop as soon as the renderer acknowledges.
    view.on("did-navigate", initialize);
    window.on("close", () => ready(view.id));
    initialize();
  }
  // Transparent CEF windows do not repaint after a native resize, so the pill and
  // the expanded panel are separate fixed-size windows instead of one resized window.
  let pill: BrowserWindow | undefined;
  let panel: BrowserWindow | undefined;
  let pillWanted = false;
  function createIslandWindow(variant: Exclude<IslandMode, "hidden">) {
    const window = new BrowserWindow({
      title: variant === "compact" ? "Sona Island" : "Sona Island Panel",
      url: appUrl,
      renderer: "cef",
      sandbox: true,
      titleBarStyle: "hidden",
      transparent: true,
      hidden: true,
      activate: false,
      allowedProtocols: { views: false, appData: false },
      navigationRules: JSON.stringify([`${origin}/*`]),
      frame: islandFrame(Screen.getPrimaryDisplay(), variant),
    });
    if (!raiseIntoNotch(window.ptr)) window.setAlwaysOnTop(true);
    attach(window, variant);
    window.on("close", () => {
      if (window === pill) pill = undefined;
      if (window === panel) panel = undefined;
    });
    return window;
  }
  function setIsland(mode: IslandMode, viewId: number) {
    if (stopped) return;
    const fromPanel = panel !== undefined && viewId === panel.webview.id;
    if (mode === "expanded") {
      panel ??= createIslandWindow("expanded");
      panel.show();
      pill?.hide();
      return;
    }
    if (fromPanel) panel?.hide();
    else pillWanted = mode === "compact";
    if (panel?.isVisible()) return;
    if (pillWanted) pill?.showInactive();
    else pill?.hide();
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 4096,
    fetch: createCompanionRequestHandler(origin, token, () => stopped, {
      ready,
      notify: Utils.showNotification,
      island: setIsland,
    }),
  });
  function preload(islandView: Exclude<IslandMode, "hidden"> | false, viewId: number) {
    return `if (location.origin === ${JSON.stringify(origin)} && window === window.top && !window.sonaDesktop) {
      const request = async (path, body = {}) => {
        const response = await fetch(${JSON.stringify(`http://127.0.0.1:${server.port}`)} + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: ${JSON.stringify(`Bearer ${token}`)} }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error('Sona desktop action failed');
      };
      Object.defineProperty(window, 'sonaDesktop', { value: Object.freeze({ island: ${JSON.stringify(islandView)}, notify: value => request('/notify', value), setIsland: mode => request('/island', { mode, viewId: ${viewId} }) }) });
      window.dispatchEvent(new Event("sona-desktop-ready"));
      void request("/ready", { viewId: ${viewId} }).catch(() => {});
    }`;
  }
  // The pill lives at the notch for the app's lifetime; its renderer decides
  // when there is live work to show.
  pill = createIslandWindow("compact");
  return {
    attach,
    stop() {
      stopped = true;
      for (const id of timers.keys()) ready(id);
      pill?.close();
      panel?.close();
      void server.stop(true);
    },
  };
}
