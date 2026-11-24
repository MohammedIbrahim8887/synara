import { describe, expect, it, vi } from "vitest";
import { createCompanionRequestHandler } from "./sonaCompanionRequests";

describe("sandboxed desktop companion channel", () => {
  const origin = "http://127.0.0.1:4400";
  function setup() {
    const actions = {
      notify: vi.fn(),
      ready: vi.fn(),
    };
    const stopped = { value: false };
    const handler = createCompanionRequestHandler(
      origin,
      "test-token",
      () => stopped.value,
      actions,
    );
    const request = (
      path: string,
      body: unknown,
      headers = { origin, authorization: "Bearer test-token" },
    ) =>
      handler(
        new Request(`http://127.0.0.1:5500${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
    return { actions, stopped, request };
  }
  it("refuses foreign origins, missing capabilities and stopped instances", async () => {
    const { request, actions, stopped } = setup();
    expect(
      (
        await request(
          "/ready",
          { viewId: 1 },
          { origin: "https://evil.test", authorization: "Bearer test-token" },
        )
      ).status,
    ).toBe(403);
    expect((await request("/ready", { viewId: 1 }, { origin, authorization: "" })).status).toBe(
      403,
    );
    stopped.value = true;
    expect((await request("/ready", { viewId: 1 })).status).toBe(403);
    expect(actions.ready).not.toHaveBeenCalled();
  });
  it("validates notification copy and submits sound-enabled notifications", async () => {
    const { request, actions } = setup();
    expect((await request("/notify", { title: "x".repeat(161), body: "" })).status).toBe(400);
    expect(
      (await request("/notify", { title: "Finished", body: "Review the changes" })).status,
    ).toBe(204);
    expect(actions.notify).toHaveBeenCalledExactlyOnceWith({
      title: "Finished",
      body: "Review the changes",
      silent: false,
    });
  });
  it("bounds notification floods and rejects arbitrary commands", async () => {
    const { request, actions } = setup();
    for (let i = 0; i < 30; i++)
      expect((await request("/notify", { title: "Done", body: "" })).status).toBe(204);
    expect((await request("/notify", { title: "Done", body: "" })).status).toBe(429);
    expect((await request("/execute", {})).status).toBe(404);
    expect((await request("/island", { mode: "expanded", viewId: 2 })).status).toBe(404);
    expect(actions.ready).not.toHaveBeenCalled();
  });
  it("hands the browser-pane socket only to the authenticated Sona page", async () => {
    const pane = { url: "ws://127.0.0.1:6000/pane", token: "pane-token" };
    const handler = createCompanionRequestHandler(origin, "test-token", () => false, {
      notify: vi.fn(),
      ready: vi.fn(),
      browserPane: async () => pane,
    });
    const request = (headers: Record<string, string>) =>
      handler(
        new Request("http://127.0.0.1:5500/browser-pane", {
          method: "POST",
          headers,
          body: "{}",
        }),
      );
    const allowed = await request({ origin, authorization: "Bearer test-token" });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(pane);
    expect(
      (await request({ origin: "https://evil.test", authorization: "Bearer test-token" })).status,
    ).toBe(403);
    expect((await request({ origin, authorization: "Bearer wrong" })).status).toBe(403);
  });
});
