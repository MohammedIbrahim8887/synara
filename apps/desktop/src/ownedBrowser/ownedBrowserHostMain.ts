/**
 * Sona's owned-browser host. Runs under the bundled Node runtime as a child of
 * the Sona desktop shell, which hands it a private config on fd 3 and holds
 * its stdin as a lifetime lease. It owns one headless Chromium driven over
 * `--remote-debugging-pipe`, serves the backend's `browser_*` tools on the
 * standard browser-host pipe, and streams pages into Sona's browser pane.
 */
import { closeSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getBetterwrightNetworkGuard } from "../browserAutomation/betterwrightNetworkGuard";
import { BrowserHostPipeServer } from "../browserUsePipeServer";
import { findChromeExecutable, launchChrome } from "./chromeLauncher";
import { OwnedBrowser, OwnedBrowserSession } from "./ownedBrowser";
import { OwnedBrowserAutomationHost, ownedBrowserEngineHome } from "./ownedBrowserAutomationHost";
import { PaneServer } from "./paneServer";

export const OWNED_BROWSER_HOST_READY = "SONA_BROWSER_HOST_READY";
export const OWNED_BROWSER_HOST_UNAVAILABLE = "SONA_BROWSER_HOST_UNAVAILABLE";

export interface OwnedBrowserHostConfig {
  readonly home: string;
  readonly pipePath: string;
  readonly capability: string;
  readonly paneToken: string;
  readonly allowedOrigin: string;
}

function readConfig(): OwnedBrowserHostConfig {
  let raw: string;
  try {
    raw = readFileSync(3, "utf8");
  } finally {
    try {
      closeSync(3);
    } catch {
      // Already closed by the runtime.
    }
  }
  const config = JSON.parse(raw) as Partial<OwnedBrowserHostConfig>;
  for (const key of ["home", "pipePath", "capability", "paneToken", "allowedOrigin"] as const) {
    if (typeof config[key] !== "string" || !config[key]) throw new Error(`Missing ${key}.`);
  }
  return config as OwnedBrowserHostConfig;
}

async function main(): Promise<void> {
  const config = readConfig();
  process.env.SONA_OWNED_BROWSER_HOME = config.home;
  const executable = findChromeExecutable();
  if (!executable) {
    console.log(`${OWNED_BROWSER_HOST_UNAVAILABLE} ${JSON.stringify({ reason: "no-chromium" })}`);
    process.exit(0);
  }

  const session = new OwnedBrowserSession();
  const guard = getBetterwrightNetworkGuard(session as never);
  await guard.initialize();
  const proxyPort = Number(/:(\d+)$/u.exec(session.proxyRules ?? "")?.[1]);
  if (!Number.isInteger(proxyPort) || proxyPort <= 0) throw new Error("Network guard has no port.");

  const chrome = launchChrome({
    executable,
    profileDirectory: join(config.home, "browser-profile"),
    proxyPort,
  });
  const browser = new OwnedBrowser(chrome.cdp, session);
  await browser.initialize();

  const automationHost = new OwnedBrowserAutomationHost(browser, {
    engineHome: ownedBrowserEngineHome(config.home),
  });
  const pipeServer = new BrowserHostPipeServer({
    automationHost,
    pipePath: config.pipePath,
    capability: config.capability,
  });
  await pipeServer.start();
  const paneServer = new PaneServer({
    browser,
    allowedOrigin: config.allowedOrigin,
    token: config.paneToken,
  });
  const panePort = await paneServer.listen();

  let stopping: Promise<void> | undefined;
  const shutdown = (code: number) => {
    stopping ??= (async () => {
      await Promise.allSettled([pipeServer.dispose(), paneServer.close()]);
      await browser.dispose().catch(() => {});
      await guard.dispose().catch(() => {});
      if (chrome.child.exitCode === null) chrome.child.kill();
      process.exit(code);
    })();
    return stopping;
  };
  // The desktop shell holds stdin open for exactly as long as Sona runs.
  process.stdin.on("end", () => void shutdown(0));
  process.stdin.on("error", () => void shutdown(0));
  process.stdin.resume();
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  void chrome.exited.then(() => {
    console.error("[owned-browser] Chromium exited; stopping the browser host.");
    void shutdown(1);
  });

  console.log(`${OWNED_BROWSER_HOST_READY} ${JSON.stringify({ panePort })}`);
}

main().catch((error: unknown) => {
  console.error("[owned-browser] Host failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
