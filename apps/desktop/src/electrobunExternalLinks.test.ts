import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerElectrobunExternalLinks } from "./electrobunExternalLinks";

describe("Electrobun external links", () => {
  it("opens asynchronous OAuth popups only from the app view, then unsubscribes", async () => {
    const events = new EventEmitter();
    const open = vi.fn(() => true);
    const dispose = registerElectrobunExternalLinks(events, 7, open, vi.fn());
    const event = {
      data: {
        detail: { url: "https://connect.composio.dev/authorize?state=fixture", userGesture: false },
      },
    };
    events.emit("new-window-open-8", event);
    expect(open).not.toHaveBeenCalled();
    await Promise.resolve();
    events.emit("new-window-open-7", event);
    expect(open).toHaveBeenCalledExactlyOnceWith(event.data.detail.url);
    dispose();
    events.emit("new-window-open-7", event);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "custom:launch",
    "invalid",
    null,
    {},
  ])("rejects unsafe or malformed links: %j", (url) => {
    const events = new EventEmitter();
    const open = vi.fn(() => true);
    registerElectrobunExternalLinks(events, 1, open, vi.fn());
    events.emit("new-window-open-1", { data: { detail: { url } } });
    expect(open).not.toHaveBeenCalled();
  });

  it("supports legacy string payloads and reports launch failure without exposing the URL", () => {
    const events = new EventEmitter();
    const failure = vi.fn();
    const open = vi.fn(() => false);
    registerElectrobunExternalLinks(events, 1, open, failure);
    events.emit("new-window-open-1", { data: { detail: "http://localhost:1234/authorize" } });
    expect(failure).toHaveBeenCalledExactlyOnceWith();
    open.mockImplementation(() => {
      throw new Error("private URL");
    });
    events.emit("new-window-open-1", { data: { detail: "https://example.com/" } });
    expect(failure).toHaveBeenCalledTimes(2);
  });
});
