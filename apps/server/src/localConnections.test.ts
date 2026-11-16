import { afterEach, expect, it, vi } from "vitest";
import http from "node:http";
import https from "node:https";
import WebSocket, { WebSocketServer } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalConnections } from "./localConnections";
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  networkInterfaces: () => ({ test: [{ address: "127.0.0.1", family: "IPv4", internal: false }] }),
}));
vi.mock("@synara/contracts/localConnections", () => ({ isLocalConnectionEndpoint: () => true }));
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false, headers }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode!, body }));
      })
      .on("error", reject);
  });
}
it("requires authentication and matching origins, preserves the TLS identity, and closes its listener", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sona-lan-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const upstream = http.createServer((req, res) =>
    res.end(JSON.stringify({ url: req.url, origin: req.headers.origin })),
  );
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const webSockets = new WebSocketServer({ server: upstream });
  webSockets.on("connection", (socket) => socket.on("message", (message) => socket.send(message)));
  cleanup.push(() => new Promise<void>((resolve) => webSockets.close(() => resolve())));
  const port = (upstream.address() as { port: number }).port;
  const authorize = vi.fn(async (req: http.IncomingMessage) => {
    if (req.headers.cookie !== "session=valid") throw Error("unauthorized");
  });
  const manager = new LocalConnections({ secretsDir: root, upstreamPort: port, authorize });
  cleanup.push(() => manager.setEnabled(false));
  expect(manager.status().enabled).toBe(false);
  const enabled = await manager.setEnabled(true);
  const origin = enabled.endpoints[0]!;
  expect(enabled.certificateFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await get(origin + "/api/private")).status).toBe(401);
  expect((await get(origin + "//[")).status).toBe(400);
  expect(
    (
      await get(origin + "/api/private", {
        cookie: "session=valid",
        origin: "https://attacker.invalid",
      })
    ).status,
  ).toBe(403);
  const allowed = await get(origin + "/api/private", { cookie: "session=valid", origin });
  expect(allowed.status).toBe(200);
  expect(JSON.parse(allowed.body).origin).toBe(`http://127.0.0.1:${port}`);
  expect((await get(origin + "/pair")).status).toBe(200);
  expect((await get(origin + "/api/local-connections/invite")).status).toBe(401);
  const connect = (cookie?: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(origin.replace("https:", "wss:") + "/ws", {
        rejectUnauthorized: false,
        headers: { origin, ...(cookie ? { cookie } : {}) },
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  await expect(connect()).rejects.toThrow();
  const socket = await connect("session=valid");
  const echo = new Promise<string>((resolve) =>
    socket.once("message", (data) => resolve(data.toString())),
  );
  socket.send("live-stream");
  expect(await echo).toBe("live-stream");
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  await manager.setEnabled(false);
  await closed;
  await expect(get(origin + "/pair")).rejects.toThrow();
  const again = await manager.setEnabled(true);
  expect(again.endpoints).toEqual(enabled.endpoints);
  expect(again.certificateFingerprint).toBe(enabled.certificateFingerprint);
}, 20_000);
