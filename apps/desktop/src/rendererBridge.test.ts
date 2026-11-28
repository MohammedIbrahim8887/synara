import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_IPC_CHANNELS as IPC } from "./ipcChannels";
import { createDesktopRendererBridge, type DesktopRendererTransport } from "./rendererBridge";

function fixture() {
  const events = new EventEmitter();
  const values = new Map<string, unknown>();
  const invoke = vi.fn(async (_channel: string, ..._args: unknown[]): Promise<unknown> => null);
  const send = vi.fn();
  const transport: DesktopRendererTransport = {
    invoke: <T>(channel: string, ...args: unknown[]) => invoke(channel, ...args) as Promise<T>,
    send,
    sendSync: <T>(channel: string) => values.get(channel) as T,
    on: (channel, listener) => {
      events.on(channel, listener);
    },
    removeListener: (channel, listener) => {
      events.removeListener(channel, listener);
    },
  };
  const create = () =>
    createDesktopRendererBridge({
      transport,
      fallbackWsUrl: "ws://127.0.0.1:1234",
      getPathForFile: () => null,
    });
  return { events, values, invoke, send, create };
}

describe("desktop renderer bridge", () => {
  it("keeps diagnostics absent unless the host explicitly enables them", () => {
    const f = fixture();
    for (const value of [undefined, false, "true", 1]) {
      f.values.set(IPC.betaDiagnostics.enabled, value);
      expect(f.create().betaDiagnostics).toBeUndefined();
    }
    f.values.set(IPC.betaDiagnostics.enabled, true);
    f.create().betaDiagnostics!.rendererReady();
    expect(f.send).toHaveBeenCalledWith(IPC.betaDiagnostics.rendererReady);
  });

  it("reads synchronous host state and retains the existing websocket fallback", () => {
    const f = fixture();
    const bridge = f.create();
    expect(bridge.getWsUrl()).toBe("ws://127.0.0.1:1234");
    f.values.set(IPC.wsUrl, " ws://127.0.0.1:4321 ");
    expect(bridge.getWsUrl()).toBe("ws://127.0.0.1:4321");
    for (const zoom of [0, -1, NaN, Infinity, "2"]) {
      f.values.set(IPC.zoomFactor, zoom);
      expect(bridge.getZoomFactor()).toBe(1);
    }
    f.values.set(IPC.zoomFactor, 1.5);
    expect(bridge.getZoomFactor()).toBe(1.5);
  });

  it("propagates native failures rather than reporting a successful operation", async () => {
    const f = fixture();
    f.invoke.mockRejectedValue(new Error("Native operation failed"));
    await expect(f.create().pickFolder()).rejects.toThrow("Native operation failed");
  });

  it("validates event payloads and releases only the owning listener", () => {
    const f = fixture();
    const bridge = f.create();
    const first = vi.fn();
    const second = vi.fn();
    const release = bridge.onMenuAction(first);
    bridge.onMenuAction(second);
    f.events.emit(IPC.menuAction, {}, { action: "bad" });
    expect(first).not.toHaveBeenCalled();
    f.events.emit(IPC.menuAction, {}, "new-thread");
    expect(first).toHaveBeenCalledWith("new-thread");
    release();
    release();
    f.events.emit(IPC.menuAction, {}, "settings");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("retains one capture demand per renderer and normalizes binary frames", () => {
    const f = fixture();
    const bridge = f.create();
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = bridge.computerPreview!.onFrame(first);
    const releaseSecond = bridge.computerPreview!.onFrame(second);
    expect(f.send.mock.calls).toEqual([[IPC.computerPreviewSubscribe]]);
    f.events.emit(IPC.computerPreviewFrame, {}, { windowId: 1, seq: 1, jpeg: [] });
    expect(first).not.toHaveBeenCalled();
    const frame = { windowId: 1, seq: 2, jpeg: { type: "Buffer", data: [255, 216, 255] } };
    f.events.emit(IPC.computerPreviewFrame, {}, frame);
    expect(first).toHaveBeenCalledWith({ ...frame, jpeg: new Uint8Array([255, 216, 255]) });
    releaseFirst();
    releaseFirst();
    expect(f.send).toHaveBeenCalledTimes(1);
    releaseSecond();
    expect(f.send.mock.calls).toEqual([
      [IPC.computerPreviewSubscribe],
      [IPC.computerPreviewUnsubscribe],
    ]);
  });

  it("does not share capture demand across bridge instances", () => {
    const f = fixture();
    const releaseA = f.create().computerPreview!.onFrame(() => {});
    const releaseB = f.create().computerPreview!.onFrame(() => {});
    expect(f.send.mock.calls).toEqual([
      [IPC.computerPreviewSubscribe],
      [IPC.computerPreviewSubscribe],
    ]);
    releaseA();
    releaseB();
    expect(f.send).toHaveBeenCalledTimes(4);
  });
});
