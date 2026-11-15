// Local preview only; the authenticated production desktop migration is not complete.
import Electrobun, { BrowserWindow, Utils } from "electrobun/main";
import { registerElectrobunExternalLinks } from "../../src/electrobunExternalLinks";

const origin = "http://localhost:6733";
const window = new BrowserWindow({
  title: "Sona — Electrobun Preview",
  url: origin,
  renderer: "cef",
  sandbox: true,
  allowedProtocols: { views: false, appData: false },
  navigationRules: JSON.stringify([`${origin}/*`]),
  frame: { x: 100, y: 80, width: 1280, height: 850 },
});
const dispose = registerElectrobunExternalLinks(
  Electrobun.events,
  window.webview.id,
  Utils.openExternal,
  () => console.error("Unable to open the system browser."),
);
window.on("close", dispose);
window.activate();
