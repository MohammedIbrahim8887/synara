import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SONA_PRODUCTION_BUNDLE_ID } from "@synara/shared/desktopIdentity";
import { afterEach, expect, it } from "vitest";
import { startElectrobunBackend } from "./electrobunBackend";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("owns a real backend process, reuses its origin, and closes it through the stdin lease", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sona-backend-"));
  roots.push(root);
  const resources = path.join(root, "resources");
  const home = path.join(root, "home");
  await mkdir(path.join(resources, "backend"), { recursive: true });
  await cp(process.execPath, path.join(resources, "node"));
  await writeFile(
    path.join(resources, "backend/index.mjs"),
    `
    import { createServer } from 'node:http';
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ mode: process.env.SYNARA_MODE, home: process.env.SYNARA_HOME,
        bundleId: process.env.SYNARA_DESKTOP_BUNDLE_ID,
        lease: process.env.SYNARA_DESKTOP_PARENT_STDIN, authenticated: Boolean(process.env.SYNARA_AUTH_TOKEN) }));
    });
    process.stdin.resume();
    process.stdin.on('end', () => server.close());
    server.listen(Number(process.env.SYNARA_PORT), process.env.SYNARA_HOST);
  `,
  );
  const first = await startElectrobunBackend(resources, home);
  try {
    expect(await (await fetch(`${first.origin}/health`)).json()).toEqual({
      mode: "desktop",
      home,
      bundleId: SONA_PRODUCTION_BUNDLE_ID,
      lease: "1",
      authenticated: true,
    });
    expect(new URL(first.url).pathname).toBe("/pair");
    expect(new URL(first.url).hash).toMatch(/^#token=[a-f0-9]{64}$/);
    // A concurrent instance must not attach to an existing backend.
    await expect(startElectrobunBackend(resources, home)).rejects.toThrow();
  } finally {
    await first.stop();
  }
  await expect(fetch(`${first.origin}/health`)).rejects.toThrow();
  const second = await startElectrobunBackend(resources, home);
  try {
    expect(second.origin).toBe(first.origin);
    expect(second.url).not.toBe(first.url);
  } finally {
    await second.stop();
  }
}, 20_000);
