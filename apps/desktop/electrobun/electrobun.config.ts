import type { ElectrobunConfig } from "electrobun";

// Qualification target only. Never shares a released application's profile,
// updater, backend, or credential storage. CEF is required for browser parity.
const platform = {
  bundleCEF: true,
  defaultRenderer: "cef" as const,
  chromiumFlags: { "remote-debugging-port": false },
};
export default {
  app: {
    name: "Synara Electrobun Qualification",
    identifier: "com.emanueledipietro.synara.electrobun.qualification",
    version: "0.0.1",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main.ts" },
    views: { probe: { entrypoint: "src/view.ts" } },
    copy: { "src/index.html": "views/probe/index.html" },
    mac: { ...platform, icons: "assets/sona.iconset" },
    win: { ...platform, icon: "assets/sona.ico" },
    linux: { ...platform, icon: "assets/sona.png" },
  },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
