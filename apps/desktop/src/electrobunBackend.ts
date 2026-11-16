import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawnProcess } from "@synara/shared/processRuntime";

/** Stable local origin preserves renderer preferences across launches. The server's
 * own data lock and stdin lifetime lease remain authoritative for ownership.
 */
export async function startElectrobunBackend(resources: string, home: string) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const portFile = path.join(home, "desktop-port");
  let requestedPort = 0;
  try {
    requestedPort = Number(await readFile(portFile, "utf8"));
    if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
      throw new Error("Invalid Sona desktop port file.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const port = await new Promise<number>((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(requestedPort, "127.0.0.1", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") return reject(new Error("No loopback port."));
      reservation.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  if (!requestedPort) await writeFile(portFile, String(port), { mode: 0o600, flag: "wx" });
  const token = randomBytes(32).toString("hex");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("SYNARA_") ||
      key.startsWith("VITE_") ||
      ["NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"].includes(key)
    )
      delete env[key];
  }
  Object.assign(env, {
    SYNARA_HOME: home,
    SYNARA_MODE: "desktop",
    SYNARA_DESKTOP_FLAVOR: "production",
    SYNARA_HOST: "127.0.0.1",
    SYNARA_PORT: String(port),
    SYNARA_AUTH_TOKEN: token,
    SYNARA_NO_BROWSER: "true",
    SYNARA_DESKTOP_PARENT_STDIN: "1",
    SYNARA_STATIC_DIR: path.join(resources, "backend", "client"),
  });
  const child = spawnProcess(
    path.join(resources, "node"),
    [path.join(resources, "backend", "index.mjs")],
    {
      cwd: home,
      env,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  child.stdin?.on("error", () => {});
  let failure: Error | undefined;
  child.once("error", (error) => {
    failure = error;
  });
  let exited = false;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => {
      exited = true;
      resolve();
    }),
  );
  const stop = async () => {
    child.stdin?.end();
    // The backend owns its provider teardown and has its own bounded watchdog.
    await closed;
  };
  const origin = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (failure || exited) throw failure ?? new Error("Sona backend exited during startup.");
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok)
          return { child, closed, stop, origin, url: `${origin}/pair#token=${token}` };
      } catch {
        /* Retry while the owned child initializes its database. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Sona backend startup timed out.");
  } catch (error) {
    await stop();
    throw error;
  }
}
