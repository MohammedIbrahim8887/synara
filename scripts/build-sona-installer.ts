// Builds the Sona stable installer and its matching Electrobun update artifacts.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnProcessSync } from "@synara/shared/processRuntime";
import { SONA_PRODUCTION_BUNDLE_ID } from "@synara/shared/desktopIdentity";
import { stageRuntimeDependencies } from "./lib/stage-runtime-dependencies.ts";
import { buildSonaFfmpeg } from "./lib/build-sona-ffmpeg.ts";

if (process.platform !== "darwin" || process.arch !== "arm64" || process.versions.bun) {
  throw new Error(
    "Build with Node on an Apple Silicon Mac. Other installer targets are not qualified.",
  );
}
const root = path.resolve(import.meta.dirname, "..");
const version = "0.1.3";
const updateBaseUrl = "https://github.com/MohammedIbrahim8887/synara/releases/latest/download";
const updatePrefix = "stable-macos-arm64";

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
const stage = await mkdtemp(path.join(tmpdir(), "sona-installer-"));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (
    key.startsWith("VITE_") ||
    key.startsWith("SYNARA_") ||
    key === "NODE_ENV" ||
    key === "NODE_OPTIONS" ||
    key === "NODE_PATH"
  )
    delete env[key];
}
env.SONA_RELEASE_VERSION = version;
function run(command: string, args: string[], cwd = root) {
  const result = spawnProcessSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.signal}). Staging: ${stage}`);
}
console.log(`Staging Sona ${version} in ${stage}`);
run("bun", ["run", "--cwd", "apps/web", "build"]);
run("bun", ["run", "--cwd", "apps/server", "build"]);
const runtime = path.join(stage, "runtime");
await mkdir(runtime);
await cp(path.join(root, "apps/server/dist"), path.join(runtime, "backend"), { recursive: true });
await cp(process.execPath, path.join(runtime, "node"));
// The owned-browser host drives a local Chromium for the browser pane and browser_* tools.
// Betterwright stays external: it starts its worker from its own package files.
run("bun", [
  "apps/desktop/scripts/build-owned-browser-host.ts",
  path.join(runtime, "browser-host"),
]);
const inventory = await stageRuntimeDependencies(
  path.join(root, "apps/server"),
  path.join(runtime, "node_modules"),
  [{ from: path.join(root, "apps/desktop"), names: ["betterwright"] }],
);
await writeFile(path.join(runtime, "dependencies.json"), JSON.stringify(inventory, null, 2));
await cp(path.join(root, "LICENSE"), path.join(runtime, "LICENSE"));
// LGPL ffmpeg (with its license and source pins) converts H.264/HEVC video
// previews, which the bundled Chromium cannot decode, to VP9 WebM.
await cp(await buildSonaFfmpeg(), path.join(runtime, "ffmpeg"), { recursive: true });
run(path.join(runtime, "ffmpeg/ffmpeg"), ["-hide_banner", "-loglevel", "error", "-version"], stage);
// Exercise real imports, the bundled Node runtime, native PTY and SQLite before packaging.
run(path.join(runtime, "node"), [path.join(runtime, "backend/runtimeDependencySmoke.mjs")], stage);
await cp(
  path.join(root, "apps/desktop/electrobun/assets/sona.iconset"),
  path.join(stage, "sona.iconset"),
  { recursive: true },
);
await cp(
  path.join(root, "apps/desktop/electrobun/hutch.config.ts"),
  path.join(stage, "hutch.config.ts"),
);
await writeFile(
  path.join(stage, "main.ts"),
  `import ${JSON.stringify(path.join(root, "apps/desktop/electrobun/src/installed.ts"))};\n`,
);
await writeFile(
  path.join(stage, "electrobun.config.ts"),
  `export default ${JSON.stringify(
    {
      app: { name: "Sona", identifier: SONA_PRODUCTION_BUNDLE_ID, version },
      build: {
        mainProcess: "bun",
        bun: { entrypoint: "main.ts" },
        mac: {
          bundleCEF: true,
          defaultRenderer: "cef",
          icons: "sona.iconset",
          createDmg: false,
          codesign: false,
          notarize: false,
          chromiumFlags: { "remote-debugging-port": false, "disable-popup-blocking": true },
        },
      },
      runtime: { exitOnLastWindowClosed: false },
      release: { baseUrl: updateBaseUrl, generatePatch: false },
    },
    null,
    2,
  )};\n`,
);
run(process.env.HUTCH_BIN ?? "hutch", ["electrobun", "build", "--env=stable"], stage);
const imageRoot = path.join(stage, "disk-image");
await mkdir(imageRoot);
// Hutch wraps the stable bundle in a self-extracting installer. Extract the
// inner app and add the runtime here to preserve its dependency symlinks.
run("tar", [
  "-xf",
  path.join(stage, "artifacts/stable-macos-arm64-Sona.app.tar.zst"),
  "-C",
  imageRoot,
]);
const app = path.join(imageRoot, "Sona.app");
await cp(runtime, path.join(app, "Contents/Resources/app/runtime"), {
  recursive: true,
  verbatimSymlinks: true,
});
run(
  "plutil",
  [
    "-replace",
    "CFBundleShortVersionString",
    "-string",
    version,
    path.join(app, "Contents/Info.plist"),
  ],
  stage,
);
run(
  "plutil",
  ["-replace", "CFBundleDisplayName", "-string", "Sona", path.join(app, "Contents/Info.plist")],
  stage,
);
// macOS requires a purpose string in the responsible app bundle before CEF can
// request microphone access. Set it before signing; never reuse Synara's TCC identity.
run(
  "plutil",
  [
    "-replace",
    "NSMicrophoneUsageDescription",
    "-string",
    "Sona uses your microphone to record voice notes and transcribe them into the chat composer.",
    path.join(app, "Contents/Info.plist"),
  ],
  stage,
);
// Ad-hoc signing is for local integrity only; this is not Developer ID signing or notarization.
run("codesign", ["--force", "--deep", "--sign", "-", app], stage);
run("codesign", ["--verify", "--deep", "--strict", app], stage);
const output = path.join(root, "release/sona");
await mkdir(output, { recursive: true });
const { symlink } = await import("node:fs/promises");
await symlink("/Applications", path.join(imageRoot, "Applications"));
const dmg = path.join(output, `Sona-${version}-macos-arm64.dmg`);
run(
  "hdiutil",
  ["create", "-ov", "-volname", "Sona", "-srcfolder", imageRoot, "-format", "UDZO", dmg],
  stage,
);
await rm(path.join(output, "Sona.app"), { recursive: true, force: true });
await cp(app, path.join(output, "Sona.app"), {
  recursive: true,
  verbatimSymlinks: true,
});
// Archive the signed, complete bundle. Hutch's initial archive only contains
// the shell because the runtime and final plist are staged after extraction.
const tar = path.join(stage, "Sona.app.tar");
run("tar", ["-cf", tar, "-C", imageRoot, "Sona.app"], stage);
const tarSha256 = await sha256(tar);
const { size: tarSize } = await stat(tar);
const artifact = `${updatePrefix}-Sona-${version}.app.tar.zst`;
run("zstd", ["-f", "-T0", "--rm", tar, "-o", path.join(output, artifact)], stage);
const { identifier, channel, hash, baseUrl } = JSON.parse(
  await readFile(path.join(app, "Contents/Resources/version.json"), "utf8"),
);
if (
  identifier !== SONA_PRODUCTION_BUNDLE_ID ||
  channel !== "stable" ||
  baseUrl !== updateBaseUrl ||
  typeof hash !== "string" ||
  !hash
) {
  throw new Error("Electrobun bundle does not match the Sona update feed.");
}
await writeFile(
  path.join(output, `${updatePrefix}-update-v2.json`),
  JSON.stringify(
    {
      schemaVersion: 1,
      identifier,
      channel,
      version,
      hash,
      platform: "macos",
      arch: "arm64",
      artifact: { file: artifact, tarSha256, tarSize },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(`${dmg}.sha256`, `${await sha256(dmg)}  ${path.basename(dmg)}\n`);
console.log(`Installer: ${dmg}\nApp: ${path.join(output, "Sona.app")}\nStaging: ${stage}`);
