import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { CdpError, CdpPipe } from "./cdpPipe";

function setup() {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const written: string[] = [];
  toChrome.on("data", (chunk: Buffer) =>
    written.push(...chunk.toString().split("\0").filter(Boolean)),
  );
  return { pipe: new CdpPipe(toChrome, fromChrome), fromChrome, written };
}

describe("CdpPipe", () => {
  it("frames commands with NUL and resolves replies split across chunks", async () => {
    const { pipe, fromChrome, written } = setup();
    const reply = pipe.send("Browser.getVersion", {}, "session-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.parse(written[0]!)).toEqual({
      id: 1,
      method: "Browser.getVersion",
      params: {},
      sessionId: "session-1",
    });
    const message = JSON.stringify({ id: 1, result: { product: "Chrome" } });
    fromChrome.write(message.slice(0, 10));
    fromChrome.write(`${message.slice(10)}\0`);
    await expect(reply).resolves.toEqual({ product: "Chrome" });
  });

  it("dispatches several events in one chunk and rejects protocol errors", async () => {
    const { pipe, fromChrome } = setup();
    const events: string[] = [];
    pipe.on((event) => events.push(`${event.method}:${event.sessionId ?? "root"}`));
    const failing = pipe.send("Page.navigate", { url: "x" });
    fromChrome.write(
      `${JSON.stringify({ method: "Page.loadEventFired", params: {}, sessionId: "s" })}\0` +
        `${JSON.stringify({ method: "Target.targetCreated", params: {} })}\0` +
        `${JSON.stringify({ id: 1, error: { message: "Cannot navigate" } })}\0`,
    );
    await expect(failing).rejects.toBeInstanceOf(CdpError);
    expect(events).toEqual(["Page.loadEventFired:s", "Target.targetCreated:root"]);
  });

  it("delivers an ordered reply before the next execution-context event in the same read", () => {
    const { pipe, fromChrome } = setup();
    const order: string[] = [];
    pipe.on((event) => order.push(event.method));
    pipe.sendOrdered("Page.getFrameTree", {}, "s", (error) => {
      expect(error).toBeNull();
      order.push("frame tree");
    });
    const messages = [
      { id: 1, result: { frameTree: {} } },
      { method: "Runtime.executionContextCreated", sessionId: "s", params: {} },
    ];
    fromChrome.write(messages.map((message) => JSON.stringify(message) + "\0").join(""));
    expect(order).toEqual(["frame tree", "Runtime.executionContextCreated"]);
  });

  it("rejects pending and later commands once the browser goes away", async () => {
    const { pipe, fromChrome } = setup();
    const pending = pipe.send("Page.enable");
    fromChrome.destroy();
    await expect(pending).rejects.toThrow("Browser connection closed.");
    await expect(pipe.send("Page.enable")).rejects.toThrow("Browser connection closed.");
    expect(pipe.closed).toBe(true);
  });
});
