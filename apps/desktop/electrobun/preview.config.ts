import type { ElectrobunConfig } from "electrobun";

// Single trusted app view only. Do not apply this popup policy to guest browsers.
export default {
  app: {
    name: "Sona Dev",
    identifier: "com.emanueledipietro.synara.electrobun.preview",
    version: "0.0.1",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/preview.ts" },
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
      chromiumFlags: {
        "remote-debugging-port": false,
        // OAuth URLs arrive after an async request, outside the click gesture.
        // The app-view handler routes HTTP(S) popups to the system browser.
        "disable-popup-blocking": true,
      },
    },
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;
