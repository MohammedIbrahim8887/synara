import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Writable } from "node:stream";

import { spawnProcess } from "@synara/shared/processRuntime";

const READY = "SONA_BROWSER_HOST_READY";
const UNAVAILABLE = "SONA_BROWSER_HOST_UNAVAILABLE";
const STARTUP_TIMEOUT_MS = 30_000;

export interface SonaBrowserHostCredentials {
  readonly pipePath: string;
  readonly capability: string;
}

/** Decided before the backend starts so it can be handed the pipe and capability. */
export function createSonaBrowserHostCredentials(home: string): SonaBrowserHostCredentials {
  return {
    // A dedicated 0700 directory (the pipe server refuses a shared parent); kept
    // short because macOS caps Unix socket paths at 104 bytes.
    pipePath: path.join(home, "browser-host", "host.sock"),
    capability: randomBytes(32).toString("base64url"),
  };
}

export interface SonaBrowserPane {
  readonly url: string;
  readonly token: string;
}

export interface SonaBrowserHost {
  /** Resolves once Chromium is up; null when no Chromium-based browser is installed. */
  readonly pane: Promise<SonaBrowserPane | null>;
  stop(): Promise<void>;
}

/**
 * Starts the owned-browser host under Sona's bundled Node runtime. Its config
 * travels on a private fd, never argv or the environment, and its stdin is a
 * lifetime lease: the host shuts Chromium down when Sona closes it.
 */
export function startSonaBrowserHost(input: {
  readonly runtime: string;
  readonly home: string;
  readonly allowedOrigin: string;
  readonly credentials: SonaBrowserHostCredentials;
}): SonaBrowserHost {
  const token = randomBytes(32).toString("base64url");
  const child = spawnProcess(
    path.join(input.runtime, "node"),
    [path.join(input.runtime, "browser-host", "index.mjs")],
    { cwd: input.home, stdio: ["pipe", "pipe", "inherit", "pipe"] },
  );
  child.stdin?.on("error", () => {});
  (child.stdio[3] as Writable | null)?.end(
    JSON.stringify({
      home: input.home,
      pipePath: input.credentials.pipePath,
      capability: input.credentials.capability,
      paneToken: token,
      allowedOrigin: input.allowedOrigin,
    }),
  );
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const pane = new Promise<SonaBrowserPane | null>((resolve) => {
    let buffered = "";
    const timer = setTimeout(() => {
      console.error("[sona] Browser host did not start in time.");
      resolve(null);
    }, STARTUP_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered = (buffered + chunk.toString("utf8")).slice(-8_192);
      for (const line of buffered.split("\n")) {
        if (line.startsWith(READY)) {
          clearTimeout(timer);
          const { panePort } = JSON.parse(line.slice(READY.length)) as { panePort: number };
          resolve({ url: `ws://127.0.0.1:${panePort}/pane`, token });
        } else if (line.startsWith(UNAVAILABLE)) {
          clearTimeout(timer);
          console.warn("[sona] No Chromium-based browser found; the browser pane is unavailable.");
          resolve(null);
        }
      }
    });
    void closed.then(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  return {
    pane,
    async stop() {
      child.stdin?.end();
      const timeout = setTimeout(() => child.kill("SIGTERM"), 5_000);
      await closed;
      clearTimeout(timeout);
    },
  };
}
