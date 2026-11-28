import { Electroview } from "electrobun/view";
import type { DesktopRpcSchema } from "../../../../packages/contracts/src/desktopRpc";
import { createElectrobunRendererTransport } from "../../src/electrobunRendererTransport";
import { createDesktopRendererBridge } from "../../src/rendererBridge";
import { DESKTOP_IPC_CHANNELS as IPC } from "../../src/ipcChannels";

const rpc = Electroview.defineRPC<DesktopRpcSchema>({
  maxRequestTime: 20_000,
  handlers: { messages: { desktopEvent: (event) => transport.receive(event) } },
});
const electroview = new Electroview({ rpc });
const transport = createElectrobunRendererTransport({
  request: (call) => electroview.rpc!.request.desktopInvoke(call),
  send: (call) => {
    void rpc.send.desktopSend(call);
  },
  initialValues: new Map<string, unknown>([
    [IPC.wsUrl, null],
    [IPC.zoomFactor, 1],
    [IPC.windowTranslucency, undefined],
    [IPC.betaDiagnostics.enabled, false],
  ]),
});
const bridge = createDesktopRendererBridge({
  transport: transport.transport,
  getPathForFile: () => null,
});

async function qualify() {
  const state = await bridge.windowControls!.getState();
  if (typeof state.isMaximized !== "boolean" || typeof state.isFullscreen !== "boolean") {
    throw new Error("Native window state did not cross the renderer bridge.");
  }
  let refused = false;
  try {
    await bridge.installUpdate();
  } catch {
    refused = true;
  }
  if (!refused) throw new Error("An unsupported operation reported success.");
  if (bridge.betaDiagnostics !== undefined) throw new Error("Diagnostics unexpectedly enabled.");
  await rpc.request.desktopInvoke({
    channel: "qualification:complete",
    args: [
      {
        windowRpc: true,
        unsupportedOperationRejected: refused,
        diagnosticsAbsent: true,
        userAgent: navigator.userAgent,
      },
    ],
  });
}
void qualify().catch(async (error: unknown) => {
  await rpc.request.desktopInvoke({ channel: "qualification:failed", args: [String(error)] });
});
