import type { DesktopRpcCall, DesktopRpcEvent } from "@synara/contracts";
import { DESKTOP_IPC_CHANNELS as IPC } from "./ipcChannels";
import type { DesktopRendererTransport } from "./rendererBridge";

type Listener = (event: unknown, payload: unknown) => void;

/**
 * Electrobun RPC is asynchronous. Only the explicit bootstrap values can be
 * read synchronously; requesting any other channel fails instead of guessing.
 * The host must push a fresh zoom value when native zoom changes.
 */
export function createElectrobunRendererTransport(options: {
  request: (call: DesktopRpcCall) => Promise<unknown>;
  send: (call: DesktopRpcCall) => void;
  initialValues: ReadonlyMap<string, unknown>;
}) {
  const values = new Map(options.initialValues);
  const listeners = new Map<string, Set<Listener>>();
  const pending = new Set<(error: Error) => void>();
  let disposed = false;
  function assertOpen() {
    if (disposed) throw new Error("Desktop renderer transport is closed.");
  }
  const transport: DesktopRendererTransport = {
    invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      if (disposed) return Promise.reject(new Error("Desktop renderer transport is closed."));
      return new Promise<T>((resolve, reject) => {
        pending.add(reject);
        // Observe both outcomes even if disposal has already rejected the call.
        Promise.resolve()
          .then(() => {
            assertOpen();
            return options.request({ channel, args });
          })
          .then(
            (result) => {
              pending.delete(reject);
              resolve(result as T);
            },
            (error: unknown) => {
              pending.delete(reject);
              reject(error);
            },
          );
      });
    },
    send(channel, ...args) {
      assertOpen();
      options.send({ channel, args });
    },
    sendSync<T>(channel: string, ...args: unknown[]): T {
      assertOpen();
      if (args.length || !values.has(channel)) {
        throw new Error(`Desktop synchronous operation is not available: ${channel}`);
      }
      return values.get(channel) as T;
    },
    on(channel, listener) {
      assertOpen();
      const group = listeners.get(channel) ?? new Set<Listener>();
      group.add(listener);
      listeners.set(channel, group);
    },
    removeListener(channel, listener) {
      const group = listeners.get(channel);
      group?.delete(listener);
      if (group?.size === 0) listeners.delete(channel);
    },
  };
  return {
    transport,
    receive(event: DesktopRpcEvent) {
      if (disposed) return;
      if (
        event.channel === IPC.zoomFactorChanged &&
        typeof event.payload === "number" &&
        Number.isFinite(event.payload) &&
        event.payload > 0
      ) {
        values.set(IPC.zoomFactor, event.payload);
      }
      // A callback may subscribe or unsubscribe during delivery. Match the
      // existing bridge's snapshot semantics for the current event.
      const currentListeners = [...(listeners.get(event.channel) ?? [])];
      for (const listener of currentListeners) {
        listener(undefined, event.payload);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      values.clear();
      for (const reject of pending) reject(new Error("Desktop renderer transport is closed."));
      pending.clear();
    },
  };
}
