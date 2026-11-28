import { homedir } from "node:os";
import path from "node:path";
import Electrobun, { BrowserWindow, PATHS, Utils } from "electrobun/main";
import { startElectrobunBackend } from "../../src/electrobunBackend";
import {
  createSonaBrowserHostCredentials,
  startSonaBrowserHost,
} from "../../src/sonaOwnedBrowserHost";
import { registerElectrobunExternalLinks } from "../../src/electrobunExternalLinks";

import { createDesktopCompanion } from "./desktopCompanion";
import { installApplicationMenu } from "./applicationMenu";
import { checkForSonaUpdates } from "./updates";

try {
  installApplicationMenu(() => void checkForSonaUpdates());
  const runtime = path.join(PATHS.RESOURCES_FOLDER, "app", "runtime");
  const home =
    process.env.SONA_HOME ?? process.env.SONA_PREVIEW_HOME ?? path.join(homedir(), ".sona");
  const browserHostCredentials = createSonaBrowserHostCredentials(home);
  const backend = await startElectrobunBackend(runtime, home, browserHostCredentials);
  // Chromium starts alongside the window; the pane connects once it is ready.
  const browserHost = startSonaBrowserHost({
    runtime,
    home,
    allowedOrigin: backend.origin,
    credentials: browserHostCredentials,
  });
  const companion = createDesktopCompanion(backend.origin, {
    browserPane: () => browserHost.pane,
  });
  const window = new BrowserWindow({
    title: "Sona",
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
    void Promise.allSettled([browserHost.stop(), backend.stop()]).finally(() => Utils.quit());
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
