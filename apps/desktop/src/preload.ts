import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createDesktopRendererBridge } from "./rendererBridge";
import { resolveDesktopWsUrlFromEnv } from "./desktopWsBridge";

contextBridge.exposeInMainWorld(
  "desktopBridge",
  createDesktopRendererBridge({
    transport: ipcRenderer,
    fallbackWsUrl: resolveDesktopWsUrlFromEnv(process.env),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  }),
);
