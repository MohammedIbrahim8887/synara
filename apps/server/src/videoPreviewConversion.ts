// FILE: videoPreviewConversion.ts
// Purpose: Converts local videos the bundled Chromium cannot decode (H.264, HEVC)
//          into cached VP9 WebM copies for the file preview player.
// Layer: Server HTTP utility
// Exports: resolveVideoPreviewFfmpeg, convertVideoForPreview
// Depends on: ffmpeg (bundled in Sona via SONA_FFMPEG_PATH, else PATH)

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { isExecutableFile, resolveExecutable } from "@synara/shared/executable";
import { spawnProcess } from "@synara/shared/processRuntime";

const CONVERSION_TIMEOUT_MS = 15 * 60 * 1000;
const CACHE_LIMIT_BYTES = 2 * 1024 ** 3;
const STDERR_TAIL_BYTES = 4096;

export interface ConvertedVideoPreview {
  readonly path: string;
  readonly sizeBytes: number;
}

const inFlight = new Map<string, Promise<ConvertedVideoPreview>>();

/** Sona sets SONA_FFMPEG_PATH to its bundled binary; development falls back to PATH. */
export function resolveVideoPreviewFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const bundled = env.SONA_FFMPEG_PATH?.trim();
  if (bundled && path.isAbsolute(bundled) && isExecutableFile(bundled)) return bundled;
  return resolveExecutable("ffmpeg", { env });
}

export function videoPreviewConversionArgs(input: string, output: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-row-mt",
    "1",
    "-b:v",
    "0",
    "-crf",
    "32",
    "-pix_fmt",
    "yuv420p",
    // ffmpeg's built-in Opus encoder keeps the bundled build free of extra libraries.
    "-c:a",
    "opus",
    "-strict",
    "-2",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-f",
    "webm",
    output,
  ];
}

async function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(ffmpeg, args, {
      stdio: ["ignore", "ignore", "pipe"],
      lowerPriority: true,
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), CONVERSION_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited (${code ?? signal}): ${stderr.trim()}`));
    });
  });
}

/** Keeps the cache under its byte budget, removing least recently served copies first. */
async function pruneCache(cacheDir: string, keep: string): Promise<void> {
  const entries = await fs.readdir(cacheDir).catch(() => []);
  const files = (
    await Promise.all(
      entries
        .filter((name) => name.endsWith(".webm"))
        .map(async (name) => {
          const filePath = path.join(cacheDir, name);
          const stat = await fs.stat(filePath).catch(() => null);
          return stat ? { filePath, size: stat.size, mtimeMs: stat.mtimeMs } : null;
        }),
    )
  ).filter((entry) => entry !== null);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= CACHE_LIMIT_BYTES) break;
    if (file.filePath === keep) continue;
    await fs.rm(file.filePath, { force: true });
    total -= file.size;
  }
}

/**
 * Returns a cached WebM copy of an allowlisted local video, converting it once.
 * The cache key covers the real path, size and mtime, so edits produce a new copy.
 */
export async function convertVideoForPreview(input: {
  readonly sourcePath: string;
  readonly cacheDir: string;
  readonly ffmpegPath?: string | null;
}): Promise<ConvertedVideoPreview> {
  const source = await fs.stat(input.sourcePath);
  const key = crypto
    .createHash("sha256")
    .update(`${input.sourcePath}\0${source.size}\0${source.mtimeMs}`)
    .digest("hex");
  const output = path.join(input.cacheDir, `${key}.webm`);
  const existing = inFlight.get(output);
  if (existing) return existing;

  const conversion = (async () => {
    const cached = await fs.stat(output).catch(() => null);
    if (cached?.isFile() && cached.size > 0) {
      const now = new Date();
      await fs.utimes(output, now, now).catch(() => undefined);
      return { path: output, sizeBytes: cached.size };
    }
    const ffmpeg = input.ffmpegPath === undefined ? resolveVideoPreviewFfmpeg() : input.ffmpegPath;
    if (!ffmpeg) throw new Error("ffmpeg is not available for video conversion.");
    await fs.mkdir(input.cacheDir, { recursive: true, mode: 0o700 });
    const partial = `${output}.${process.pid}.${crypto.randomUUID()}.partial`;
    try {
      await runFfmpeg(ffmpeg, videoPreviewConversionArgs(input.sourcePath, partial));
      await fs.rename(partial, output);
    } finally {
      await fs.rm(partial, { force: true });
    }
    const converted = await fs.stat(output);
    await pruneCache(input.cacheDir, output).catch(() => undefined);
    return { path: output, sizeBytes: converted.size };
  })().finally(() => inFlight.delete(output));
  inFlight.set(output, conversion);
  return conversion;
}
