// Builds the decode-and-convert ffmpeg that Sona bundles for video previews.
// The bundled Chromium has no H.264/HEVC decoder, so the backend converts those
// recordings to VP9 WebM. This build is LGPL (no --enable-gpl, no x264) and
// only enables the demuxers, decoders, and encoders that conversion needs.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnProcessSync } from "@synara/shared/processRuntime";

const FFMPEG_VERSION = "7.1.1";
const LIBVPX_VERSION = "1.15.0";
const SOURCES = [
  {
    name: `ffmpeg-${FFMPEG_VERSION}.tar.xz`,
    url: `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`,
    sha256: "733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1",
  },
  {
    name: `libvpx-${LIBVPX_VERSION}.tar.gz`,
    url: `https://github.com/webmproject/libvpx/archive/refs/tags/v${LIBVPX_VERSION}.tar.gz`,
    sha256: "e935eded7d81631a538bfae703fd1e293aad1c7fd3407ba00440c95105d2011e",
  },
] as const;
const MACOS_MIN = "12.0";
const BUILD_ID = `ffmpeg-${FFMPEG_VERSION}-libvpx-${LIBVPX_VERSION}-sona2`;

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command: string, args: string[], cwd: string, env = process.env) {
  const result = spawnProcessSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

/** Returns the directory holding `ffmpeg` and its license files, building it once per BUILD_ID. */
export async function buildSonaFfmpeg(): Promise<string> {
  const cache = path.join(
    process.env.SONA_FFMPEG_CACHE ?? path.join(homedir(), ".cache", "sona-ffmpeg"),
    BUILD_ID,
  );
  const output = path.join(cache, "dist");
  if (existsSync(path.join(output, "ffmpeg"))) return output;

  const work = path.join(cache, "work");
  const prefix = path.join(work, "prefix");
  await rm(work, { recursive: true, force: true });
  await mkdir(prefix, { recursive: true });
  for (const source of SOURCES) {
    const archive = path.join(cache, source.name);
    if (!existsSync(archive) || (await sha256(archive)) !== source.sha256) {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`Download failed: ${source.url} (${response.status})`);
      await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
    }
    if ((await sha256(archive)) !== source.sha256) {
      throw new Error(`Checksum mismatch for ${source.name}`);
    }
    run("tar", ["-xf", archive, "-C", work], work);
  }

  const flags = `-arch arm64 -mmacosx-version-min=${MACOS_MIN}`;
  const env = { ...process.env, CFLAGS: flags, CXXFLAGS: flags, LDFLAGS: flags };
  const jobs = String(Math.max(2, (await import("node:os")).availableParallelism()));
  const vpx = path.join(work, `libvpx-${LIBVPX_VERSION}`);
  run(
    "./configure",
    [
      `--prefix=${prefix}`,
      "--target=arm64-darwin20-gcc",
      "--enable-static",
      "--disable-shared",
      "--disable-examples",
      "--disable-tools",
      "--disable-docs",
      "--disable-unit-tests",
      "--disable-vp8",
      "--disable-vp9-decoder",
      "--enable-vp9-encoder",
    ],
    vpx,
    env,
  );
  run("make", [`-j${jobs}`], vpx, env);
  run("make", ["install"], vpx, env);

  const ffmpeg = path.join(work, `ffmpeg-${FFMPEG_VERSION}`);
  run(
    "./configure",
    [
      `--prefix=${prefix}`,
      "--arch=arm64",
      "--cc=clang",
      `--extra-cflags=${flags} -I${prefix}/include`,
      `--extra-ldflags=${flags} -L${prefix}/lib`,
      `--pkg-config-flags=--static`,
      "--enable-static",
      "--disable-shared",
      "--disable-autodetect",
      "--disable-everything",
      "--disable-network",
      "--disable-doc",
      "--disable-debug",
      "--disable-ffplay",
      "--disable-ffprobe",
      "--enable-libvpx",
      "--enable-protocol=file,pipe",
      "--enable-demuxer=mov,matroska",
      "--enable-muxer=webm",
      "--enable-parser=h264,hevc,aac,mpeg4video",
      "--enable-decoder=h264,hevc,mpeg4,prores,aac,alac,mp3,pcm_s16le,pcm_s24le,pcm_f32le",
      "--enable-encoder=libvpx_vp9,opus",
      "--enable-filter=scale,format,aresample,aformat,null,anull",
      "--enable-bsf=vp9_superframe",
    ],
    ffmpeg,
    { ...env, PKG_CONFIG_PATH: path.join(prefix, "lib/pkgconfig"), PKG_CONFIG_LIBDIR: "" },
  );
  run("make", [`-j${jobs}`], ffmpeg, env);

  const staging = path.join(cache, "dist.partial");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging);
  await cp(path.join(ffmpeg, "ffmpeg"), path.join(staging, "ffmpeg"));
  run("strip", ["-x", path.join(staging, "ffmpeg")], staging);
  await cp(path.join(ffmpeg, "COPYING.LGPLv2.1"), path.join(staging, "FFMPEG-LICENSE.txt"));
  await cp(path.join(vpx, "LICENSE"), path.join(staging, "LIBVPX-LICENSE.txt"));
  await writeFile(
    path.join(staging, "SOURCES.txt"),
    SOURCES.map((source) => `${source.url}\nsha256 ${source.sha256}\n`).join("\n"),
  );
  // The binary must not link anything outside macOS system libraries.
  const linked = spawnProcessSync("otool", ["-L", path.join(staging, "ffmpeg")], {
    encoding: "utf8",
  });
  const foreign = String(linked.stdout)
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter((lib) => lib && !lib.startsWith("/usr/lib/") && !lib.startsWith("/System/"));
  if (foreign.length > 0) throw new Error(`ffmpeg links non-system libraries: ${foreign}`);
  await rm(output, { recursive: true, force: true });
  await cp(staging, output, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  return output;
}

if (import.meta.main) {
  console.log(await buildSonaFfmpeg());
}
