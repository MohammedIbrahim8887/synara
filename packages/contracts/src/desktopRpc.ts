/** Electrobun wire envelopes. Host handlers still authorize each operation. */
export interface DesktopRpcCall {
  channel: string;
  args: unknown[];
}

export interface DesktopRpcEvent {
  channel: string;
  payload: unknown;
}

/** Structurally matches Electrobun's RPC schema without a framework dependency. */
export type DesktopRpcSchema = {
  bun: {
    requests: { desktopInvoke: { params: DesktopRpcCall; response: unknown } };
    messages: { desktopSend: DesktopRpcCall };
  };
  webview: {
    requests: Record<never, never>;
    messages: { desktopEvent: DesktopRpcEvent };
  };
};
