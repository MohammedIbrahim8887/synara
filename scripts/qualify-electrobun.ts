import { fileURLToPath } from "node:url";
import { runProcess } from "../apps/server/src/processRunner.ts";
import { readElectrobunQualification } from "./lib/electrobun-qualification.ts";

const cwd = fileURLToPath(new URL("../apps/desktop/electrobun", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--require-parity")) {
  throw new Error("Usage: bun run test:electrobun [--require-parity]");
}

// No application home or backend is passed to this native qualification app.
// Its dedicated bundle identity isolates its webview profile from all releases.
await runProcess("hutch", ["electrobun", "build", "--env=dev"], {
  cwd,
  timeoutMs: 15 * 60_000,
  onStdoutChunk: (chunk) => process.stdout.write(chunk),
  onStderrChunk: (chunk) => process.stderr.write(chunk),
});
await runProcess(
  "node",
  [
    fileURLToPath(new URL("../node_modules/@typescript/native/bin/tsc", import.meta.url)),
    "--project",
    "tsconfig.json",
  ],
  { cwd, timeoutMs: 60_000 },
);
const result = await runProcess("hutch", ["electrobun", "run", "--env=dev"], {
  cwd,
  timeoutMs: 60_000,
  allowNonZeroExit: true,
});
const report = readElectrobunQualification({
  ...result,
  platform: process.platform,
  arch: process.arch,
  requireParity: false,
});
if (result.code !== 0 || result.signal !== null) {
  throw new Error(
    `Native qualification exited abnormally: code=${result.code}, signal=${result.signal}`,
  );
}
console.log(JSON.stringify(report, null, 2));
readElectrobunQualification({
  ...result,
  platform: process.platform,
  arch: process.arch,
  requireParity: args.includes("--require-parity"),
});
