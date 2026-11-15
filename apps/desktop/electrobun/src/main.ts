import { BrowserView, BrowserWindow, Session, Utils } from "electrobun/main";
import type { DesktopRpcSchema } from "../../../../packages/contracts/src/desktopRpc";
import { DESKTOP_IPC_CHANNELS as IPC } from "../../src/ipcChannels";

const checks: Record<string, unknown> = {};
let finished = false;
let window: BrowserWindow;
const timeout = setTimeout(() => finish(false, "Renderer qualification timed out."), 30_000);

async function qualifyCookieIsolation(): Promise<void> {
  const name = "synara-qualification";
  const served = new Set<string>();
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      served.add(new URL(request.url).pathname);
      checks.guestFixtureRequests = [...served];
      return new Response(
        "<!doctype html><html><head><title>Session isolation fixture</title></head><body></body></html>",
        {
          headers: {
            "Content-Type": "text/html",
            ...(new URL(request.url).pathname === "/source"
              ? { "Set-Cookie": `${name}=from-page; Path=/; SameSite=Lax` }
              : {}),
          },
        },
      );
    },
  });
  const partitions = [0, 1].map(() => `persist:qualification-${crypto.randomUUID()}`);
  const origin = `http://127.0.0.1:${fixture.port}`;
  try {
    await Promise.all(
      partitions.map(
        (partition, index) =>
          new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(
              () =>
                reject(
                  new Error(
                    `Partitioned sandboxed CEF view ${index} did not emit dom-ready (HTTP fixture served: ${served.has(index === 0 ? "/source" : "/other")}).`,
                  ),
                ),
              10_000,
            );
            const view = new BrowserView({
              windowId: window.id,
              renderer: "cef",
              partition,
              url: `${origin}/${index === 0 ? "source" : "other"}`,
              frame: { x: 0, y: 0, width: 1, height: 1 },
              autoResize: false,
              sandbox: true,
              allowedProtocols: { views: false, appData: false },
              navigationRules: JSON.stringify([`${origin}/*`]),
            });
            view.on("dom-ready", () => {
              clearTimeout(deadline);
              resolve();
            });
          }),
      ),
    );
    const first = Session.fromPartition(partitions[0]!);
    const second = Session.fromPartition(partitions[1]!);
    const deadline = Date.now() + 5_000;
    while (!first.cookies.get({ name }).some((cookie) => cookie.value === "from-page")) {
      if (Date.now() >= deadline)
        throw new Error("CEF page cookie was not readable through the Session API.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (second.cookies.get({ name }).length !== 0)
      throw new Error("CEF cookies leaked across partitions.");
    if (
      !first.cookies.set({
        name,
        value: "from-host",
        domain: "127.0.0.1",
        path: "/",
        expirationDate: Math.floor(Date.now() / 1000) + 300,
      })
    ) {
      throw new Error("CEF session refused the qualification cookie.");
    }
    const writeDeadline = Date.now() + 5_000;
    while (!first.cookies.get({ name }).some((cookie) => cookie.value === "from-host")) {
      if (Date.now() >= writeDeadline)
        throw new Error("CEF cookie write was not readable from its session.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    checks.cookieIsolation = true;
  } finally {
    await fixture.stop(true);
  }
}

function finish(ok: boolean, error?: string) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    console.log(
      "SYNARA_ELECTROBUN_QUALIFICATION " +
        JSON.stringify({
          version: "2.0.6",
          platform: process.platform,
          arch: process.arch,
          ok,
          checks,
          ...(error ? { error } : {}),
          productionParity: false,
        }),
    );
    Utils.quit(ok ? 0 : 1);
  };
  if (!window) {
    report();
    return;
  }
  const closeTimeout = setTimeout(() => {
    ok = false;
    error = "Native window did not close.";
    report();
  }, 3_000);
  window.on("close", () => {
    clearTimeout(closeTimeout);
    checks.windowClosed = true;
    report();
  });
  window.close();
}

const rpc = BrowserView.defineRPC<DesktopRpcSchema>({
  maxRequestTime: 20_000,
  handlers: {
    requests: {
      desktopInvoke: async ({ channel, args }) => {
        // Explicit host dispatch; a renderer-supplied name never selects an
        // arbitrary method, filesystem operation, or native object property.
        if (channel === IPC.windowGetState && args.length === 0) {
          return { isMaximized: window.isMaximized(), isFullscreen: window.isFullScreen() };
        }
        if (channel === "qualification:complete") {
          checks.renderer = args[0];
          await qualifyCookieIsolation();
          setTimeout(() => finish(true), 100);
          return null;
        }
        if (channel === "qualification:failed") {
          setTimeout(() => finish(false, String(args[0])), 100);
          return null;
        }
        throw new Error(`Desktop operation has not been ported: ${channel}`);
      },
    },
    messages: {
      desktopSend: () => {
        throw new Error("No one-way native operations are enabled in qualification.");
      },
    },
  },
});

try {
  window = new BrowserWindow({
    title: "Synara runtime qualification",
    url: "views://probe/index.html",
    renderer: "cef",
    rpc,
    hidden: true,
    frame: { width: 800, height: 600 },
    navigationRules: JSON.stringify(["views://probe/*"]),
    allowedProtocols: { views: true, appData: false },
  });
  const session = Session.fromPartition(`qualification-${crypto.randomUUID()}`);
  // These are API availability observations, not behavioral parity claims.
  checks.publicApi = {
    cookies: typeof session.cookies.get === "function",
    perSessionProxy: "setProxy" in session,
    permissionHandler: "setPermissionRequestHandler" in session,
    debuggerTransport: "debugger" in window.webview,
    nativeInput: "sendInputEvent" in window.webview,
    screenshotCapture: "capturePage" in window.webview,
  };
} catch (error) {
  finish(false, String(error));
}
