import { isLocalConnectionEndpoint } from "@synara/contracts/localConnections";
import http from "node:http";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { writeFileStringAtomically } from "./atomicWrite";
import type { Duplex } from "node:stream";
import { initializeRemoteTlsIdentity } from "./remoteTransport/certificates";

import type { LocalConnectionStatus } from "@synara/contracts";

/** Opt-in LAN transport. The private loopback server retains all application authorization.
 * Authentication at this boundary also prevents its legacy loopback bypass from leaking out.
 */
export class LocalConnections {
  private listener: https.Server | undefined;
  private sockets = new Set<Duplex>();
  private state: LocalConnectionStatus = {
    enabled: false,
    endpoints: [],
    certificateFingerprint: null,
  };
  private changing: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly options: {
      secretsDir: string;
      upstreamPort: number;
      authorize: (request: http.IncomingMessage, websocket: boolean) => Promise<void>;
    },
  ) {}
  status(): LocalConnectionStatus {
    return { ...this.state, endpoints: [...this.state.endpoints] };
  }
  setEnabled(enabled: boolean): Promise<LocalConnectionStatus> {
    const next = this.changing.then(() => (enabled ? this.start() : this.stop()));
    this.changing = next.catch(() => {});
    return next;
  }
  private async start(): Promise<LocalConnectionStatus> {
    if (this.listener) return this.status();
    const ips = Object.values(networkInterfaces()).flatMap((entries) =>
      (entries ?? [])
        .filter(
          (entry) =>
            entry.family === "IPv4" &&
            !entry.internal &&
            isLocalConnectionEndpoint(`https://${entry.address}`),
        )
        .map((entry) => entry.address),
    );
    if (!ips.length) throw new Error("Connect this computer to Wi-Fi or Ethernet first.");
    const identity = await initializeRemoteTlsIdentity(
      path.join(this.options.secretsDir, "sona-lan-tls.json"),
      "sona-local-mobile",
    );
    const portFile = path.join(this.options.secretsDir, "sona-lan-port");
    let requestedPort = 0;
    try {
      requestedPort = Number(await readFile(portFile, "utf8"));
      if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)
        throw new Error("Invalid local connection port.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const server = https.createServer({
      key: identity.leafPrivateKey,
      cert: identity.leafCertificate,
      minVersion: "TLSv1.3",
    });
    server.maxConnections = 64;
    server.requestTimeout = 30_000;
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    const validOrigin = (request: http.IncomingMessage) => {
      const host = request.headers.host;
      return (
        this.state.endpoints.includes(`https://${host}`) &&
        (!request.headers.origin || request.headers.origin === `https://${host}`)
      );
    };
    const headers = (request: http.IncomingMessage) => ({
      ...request.headers,
      host: `127.0.0.1:${this.options.upstreamPort}`,
      ...(request.headers.origin
        ? { origin: `http://127.0.0.1:${this.options.upstreamPort}` }
        : {}),
    });
    server.on("request", async (request, response) => {
      if (!validOrigin(request)) {
        response.writeHead(403).end();
        return;
      }
      const target = request.url ?? "/";
      if (!target.startsWith("/") || target.startsWith("//")) {
        response.writeHead(400).end();
        return;
      }
      const pathname = new URL(target, "https://localhost").pathname;
      const publicRequest =
        (request.method === "POST" && pathname === "/api/auth/bootstrap") ||
        (request.method === "GET" &&
          (pathname === "/pair" ||
            pathname === "/" ||
            pathname === "/api/auth/session" ||
            /^\/(assets|fonts|icons|central-icons|central-icons-reversed|central-icons-fill)\//.test(
              pathname,
            )));
      try {
        if (!publicRequest) await this.options.authorize(request, false);
      } catch {
        response.writeHead(401).end();
        return;
      }
      if (response.destroyed) return;
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: this.options.upstreamPort,
          method: request.method,
          path: request.url,
          headers: headers(request),
        },
        (result) => {
          const cookies = result.headers["set-cookie"]?.map((cookie) =>
            /;\s*secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`,
          );
          response.writeHead(result.statusCode ?? 502, {
            ...result.headers,
            ...(cookies ? { "set-cookie": cookies } : {}),
          });
          result.pipe(response);
        },
      );
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    });
    server.on("upgrade", async (request, socket, head) => {
      socket.on("error", () => {});
      if (!validOrigin(request)) {
        socket.destroy();
        return;
      }
      try {
        await this.options.authorize(request, true);
      } catch {
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
      const upstream = http.request({
        hostname: "127.0.0.1",
        port: this.options.upstreamPort,
        path: request.url,
        headers: headers(request),
      });
      upstream.on("upgrade", (response, peer, initial) => {
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n")}\r\n\r\n`,
        );
        if (initial.length) socket.write(initial);
        if (head.length) peer.write(head);
        socket.pipe(peer).pipe(socket);
        socket.on("close", () => peer.destroy());
        peer.on("error", () => socket.destroy());
      });
      upstream.on("response", () => socket.destroy());
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(requestedPort, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("LAN listener failed.");
    }
    try {
      await Effect.runPromise(
        writeFileStringAtomically({ filePath: portFile, contents: String(address.port) }),
      );
    } catch (error) {
      server.close();
      throw error;
    }
    this.listener = server;
    this.state = {
      enabled: true,
      endpoints: ips.map((ip) => `https://${ip}:${address.port}`),
      certificateFingerprint: new X509Certificate(identity.leafCertificate).fingerprint256
        .replaceAll(":", "")
        .toLowerCase(),
    };
    return this.status();
  }
  private async stop(): Promise<LocalConnectionStatus> {
    const listener = this.listener;
    this.listener = undefined;
    this.state = { enabled: false, endpoints: [], certificateFingerprint: null };
    for (const socket of this.sockets) socket.destroy();
    if (listener)
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    return this.status();
  }
}
