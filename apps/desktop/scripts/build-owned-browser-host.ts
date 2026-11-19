// Bundles Sona's owned-browser host for the bundled Node runtime. `electron` is
// replaced by a stub (the shared automation modules only need two members), and
// Betterwright stays external because it launches workers from its package files.
import { fileURLToPath } from "node:url";

const outdir = process.argv[2];
if (!outdir) throw new Error("Usage: bun scripts/build-owned-browser-host.ts <outdir>");

const stub = fileURLToPath(new URL("../src/ownedBrowser/electronStub.ts", import.meta.url));
const result = await Bun.build({
  entrypoints: [
    fileURLToPath(new URL("../src/ownedBrowser/ownedBrowserHostMain.ts", import.meta.url)),
  ],
  outdir,
  target: "node",
  format: "esm",
  naming: "index.mjs",
  external: ["betterwright", "betterwright/*"],
  plugins: [
    {
      name: "electron-stub",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: stub }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built owned browser host into ${outdir}`);
