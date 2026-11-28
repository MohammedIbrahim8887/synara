import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { convertVideoForPreview, resolveVideoPreviewFfmpeg } from "./videoPreviewConversion.ts";

const fixture = path.join(import.meta.dirname, "__fixtures__", "h264-preview.mp4");
const ffmpeg = resolveVideoPreviewFfmpeg();
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sona-video-preview-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("convertVideoForPreview", () => {
  it("reports a missing ffmpeg instead of serving the undecodable original", async () => {
    await expect(
      convertVideoForPreview({ sourcePath: fixture, cacheDir: tempDir(), ffmpegPath: null }),
    ).rejects.toThrow("ffmpeg is not available");
  });

  // Set SONA_FFMPEG_PATH to the bundled build to qualify it; CI without ffmpeg skips.
  it.skipIf(ffmpeg === null)(
    "converts H.264 to a cached WebM copy and reconverts after the source changes",
    async () => {
      const workspace = tempDir();
      const source = path.join(workspace, "walkthrough.mp4");
      copyFileSync(fixture, source);
      const cacheDir = path.join(tempDir(), "video-previews");

      const [first, concurrent] = await Promise.all([
        convertVideoForPreview({ sourcePath: source, cacheDir, ffmpegPath: ffmpeg }),
        convertVideoForPreview({ sourcePath: source, cacheDir, ffmpegPath: ffmpeg }),
      ]);
      expect(concurrent).toEqual(first);
      expect(path.dirname(first.path)).toBe(cacheDir);
      expect(readFileSync(first.path).subarray(0, 4)).toEqual(EBML_MAGIC);
      expect(first.sizeBytes).toBe(statSync(first.path).size);

      // A cache hit never needs ffmpeg.
      await expect(
        convertVideoForPreview({ sourcePath: source, cacheDir, ffmpegPath: null }),
      ).resolves.toEqual(first);

      copyFileSync(fixture, source);
      const later = new Date(Date.now() + 5_000);
      utimesSync(source, later, later);
      const changed = await convertVideoForPreview({
        sourcePath: source,
        cacheDir,
        ffmpegPath: ffmpeg,
      });
      expect(changed.path).not.toBe(first.path);
    },
    60_000,
  );
});
