import { homedir } from "node:os";
import path from "node:path";
import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { startElectrobunBackend } from "../../src/electrobunBackend";
import { registerElectrobunExternalLinks } from "../../src/electrobunExternalLinks";

import { createDesktopCompanion } from "./desktopCompanion";

try {
  const backend = await startElectrobunBackend(
    path.join(PATHS.RESOURCES_FOLDER, "app", "runtime"),
    process.env.SONA_PREVIEW_HOME ?? path.join(homedir(), ".sona"),
  );
  const companion = createDesktopCompanion(backend.origin, backend.url);
  const window = new BrowserWindow({
    title: "Sona — Electrobun Preview",
    url: backend.url,
    renderer: "cef",
    sandbox: true,
    allowedProtocols: { views: false, appData: false },
    navigationRules: JSON.stringify([`${backend.origin}/*`]),
    frame: { x: 100, y: 80, width: 1280, height: 850 },
  });
  companion.attach(window);
  const dispose = registerElectrobunExternalLinks(
    Electrobun.events,
    window.webview.id,
    Utils.openExternal,
    () => console.error("Unable to open the system browser."),
  );
  let closing = false;
  window.on("close", () => {
    closing = true;
    dispose();
    companion.stop();
    void backend.stop().finally(() => Utils.quit());
  });
  void backend.closed.then(async () => {
    if (closing) return;
    await Utils.showMessageBox({
      type: "error",
      title: "Sona stopped",
      message: "The local backend stopped. Close and reopen Sona to try again.",
    });
    window.close();
  });
  window.activate();
} catch (error) {
  console.error("Sona backend startup failed:", error);
  await Utils.showMessageBox({
    type: "error",
    title: "Sona could not start",
    message:
      "The local backend could not start. Check that Sona is not already open and that your Sona data directory is writable.",
  });
  Utils.quit();
}
