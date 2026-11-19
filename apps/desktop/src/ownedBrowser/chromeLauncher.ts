import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { spawnProcess } from "@synara/shared/processRuntime";

import { CdpPipe } from "./cdpPipe";

const MAC_APPS = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Chromium.app/Contents/MacOS/Chromium",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "Brave Browser.app/Contents/MacOS/Brave Browser",
];

export function chromeExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const override = env.SONA_BROWSER_EXECUTABLE?.trim();
  const candidates = override ? [override] : [];
  if (platform === "darwin") {
    for (const root of ["/Applications", join(homedir(), "Applications")]) {
      for (const app of MAC_APPS) candidates.push(join(root, app));
    }
  } else if (platform === "win32") {
    for (const root of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]) {
      if (!root) continue;
      candidates.push(join(root, "Google/Chrome/Application/chrome.exe"));
      candidates.push(join(root, "Microsoft/Edge/Application/msedge.exe"));
    }
  } else {
    for (const name of [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "microsoft-edge",
    ]) {
      candidates.push(join("/usr/bin", name));
    }
  }
  return candidates;
}

export function findChromeExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const candidate of chromeExecutableCandidates(platform, env)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  return null;
}

export interface LaunchChromeOptions {
  readonly executable: string;
  readonly profileDirectory: string;
  /** SOCKS5 network guard every page request goes through. */
  readonly proxyPort: number;
  readonly platform?: NodeJS.Platform;
}

export function chromeLaunchArguments(options: LaunchChromeOptions): string[] {
  const platform = options.platform ?? process.platform;
  return [
    "--remote-debugging-pipe",
    `--user-data-dir=${options.profileDirectory}`,
    // The page is streamed into Sona's browser pane; no OS window is shown.
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    // A bfcache restore skips lifecycle events that navigation waits rely on.
    "--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache",
    "--hide-crash-restore-bubble",
    // As Playwright launches Chromium: no component-extension background pages,
    // and no throttling of pages the user is not looking at. Agent scripts
    // otherwise stall waiting on timers and frames.
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-ipc-flooding-protection",
    `--proxy-server=socks5://127.0.0.1:${options.proxyPort}`,
    "--proxy-bypass-list=<-loopback>",
    // A private profile must not raise a Keychain/secret-service prompt.
    ...(platform === "darwin" ? ["--use-mock-keychain"] : []),
    ...(platform === "linux" ? ["--password-store=basic"] : []),
    "--window-size=1280,800",
    "about:blank",
  ];
}

export interface LaunchedChrome {
  readonly child: ChildProcess;
  readonly cdp: CdpPipe;
  readonly exited: Promise<void>;
}

export function launchChrome(options: LaunchChromeOptions): LaunchedChrome {
  mkdirSync(options.profileDirectory, { recursive: true, mode: 0o700 });
  const child = spawnProcess(options.executable, chromeLaunchArguments(options), {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  });
  // Chromium's stderr is noisy in headless mode; keep only a bounded tail for diagnostics.
  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4_096);
  });
  const toChrome = child.stdio[3] as Writable | null;
  const fromChrome = child.stdio[4] as Readable | null;
  if (!toChrome || !fromChrome) {
    child.kill();
    throw new Error("Browser pipe could not be opened.");
  }
  const cdp = new CdpPipe(toChrome, fromChrome);
  const exited = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      if (code !== 0 && signal === null && stderrTail.trim()) {
        console.warn("[owned-browser] Chromium exited:", code, stderrTail.trim().slice(-800));
      }
      cdp.close();
      resolve();
    });
    child.once("error", (error) => {
      console.error("[owned-browser] Chromium failed to start:", error.message);
      cdp.close();
      resolve();
    });
  });
  return { child, cdp, exited };
}
