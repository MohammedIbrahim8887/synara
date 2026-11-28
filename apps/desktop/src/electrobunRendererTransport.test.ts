import { describe, expect, it, vi } from "vitest";
import { createElectrobunRendererTransport } from "./electrobunRendererTransport";
import { DESKTOP_IPC_CHANNELS as IPC } from "./ipcChannels";

function fixture(request = vi.fn(async (): Promise<unknown> => "result")) {
  const send = vi.fn();
  return {
    ...createElectrobunRendererTransport({
      request,
      send,
      initialValues: new Map([[IPC.zoomFactor, 1]]),
    }),
    request,
    send,
  };
}

describe("Electrobun renderer transport", () => {
  it("forwards asynchronous calls without losing their argument boundaries", async () => {
    const f = fixture();
    await expect(
      f.transport.invoke(IPC.saveFile, { contents: "a\nb", defaultFilename: "a b.txt" }),
    ).resolves.toBe("result");
    expect(f.request).toHaveBeenCalledWith({
      channel: IPC.saveFile,
      args: [{ contents: "a\nb", defaultFilename: "a b.txt" }],
    });
  });

  it("rejects synchronous calls that cannot be answered from bootstrap state", () => {
    const f = fixture();
    expect(f.transport.sendSync(IPC.zoomFactor)).toBe(1);
    expect(() => f.transport.sendSync(IPC.pickFolder)).toThrow("not available");
    expect(() => f.transport.sendSync(IPC.zoomFactor, "unexpected")).toThrow("not available");
    expect(f.request).not.toHaveBeenCalled();
  });

  it("updates synchronous zoom before delivering the native event", () => {
    const f = fixture();
    const listener = vi.fn(() => expect(f.transport.sendSync(IPC.zoomFactor)).toBe(1.5));
    f.transport.on(IPC.zoomFactorChanged, listener);
    f.receive({ channel: IPC.zoomFactorChanged, payload: 1.5 });
    f.transport.removeListener(IPC.zoomFactorChanged, listener);
    f.receive({ channel: IPC.zoomFactorChanged, payload: NaN });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(f.transport.sendSync(IPC.zoomFactor)).toBe(1.5);
  });

  it("rejects pending requests on disposal and observes a late native rejection", async () => {
    let rejectNative!: (error: Error) => void;
    const f = fixture(
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectNative = reject;
          }),
      ),
    );
    const result = f.transport.invoke(IPC.pickFolder);
    const rejected = expect(result).rejects.toThrow("closed");
    await Promise.resolve();
    f.dispose();
    await rejected;
    rejectNative(new Error("late native error"));
    await Promise.resolve();
    await expect(f.transport.invoke(IPC.pickFolder)).rejects.toThrow("closed");
    expect(() => f.transport.send(IPC.windowClose)).toThrow("closed");
  });

  it("does not dispatch a request disposed before it reaches native code", async () => {
    const f = fixture();
    const result = f.transport.invoke(IPC.updateInstall);
    f.dispose();
    await expect(result).rejects.toThrow("closed");
    expect(f.request).not.toHaveBeenCalled();
  });

  it("releases event consumers when their renderer is destroyed", () => {
    const f = fixture();
    const listener = vi.fn();
    f.transport.on(IPC.menuAction, listener);
    f.dispose();
    f.dispose();
    f.receive({ channel: IPC.menuAction, payload: "new-thread" });
    expect(listener).not.toHaveBeenCalled();
  });
});
