// FILE: localPreviewFiles.ts
// Purpose: Single source of truth for the /api/local-image route shape consumed by
//          both the server (HTTP route + filesystem allowlist) and the web client
//          (URL builder + markdown image source detection). The route serves every
//          allowlisted image, PDF, and video files.
// Layer: Shared utility (no runtime dependencies)
// Exports: route path, preview-file extension allowlists, and helper predicates
//          derived from them.

export const LOCAL_IMAGE_ROUTE_PATH = "/api/local-image" as const;

// Lower-case extensions (with leading dot) that the server is willing to serve and
// the web client is willing to treat as local-image markdown sources. Keep these in
// sync with the MIME allowlist used elsewhere; this list is the canonical answer.
export const SUPPORTED_LOCAL_IMAGE_EXTENSIONS = [
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tiff",
  ".webp",
] as const;

const SUPPORTED_LOCAL_IMAGE_EXTENSIONS_SET: ReadonlySet<string> = new Set(
  SUPPORTED_LOCAL_IMAGE_EXTENSIONS,
);

/** Lower-cased extension (with leading dot) of a path, or null when there is none. */
export function lowerCaseExtensionOf(filePath: string): string | null {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return null;
  return filePath.slice(dot).toLowerCase();
}

export function isSupportedLocalImagePath(filePath: string): boolean {
  const extension = lowerCaseExtensionOf(filePath);
  return extension !== null && SUPPORTED_LOCAL_IMAGE_EXTENSIONS_SET.has(extension);
}

export const SUPPORTED_LOCAL_PDF_EXTENSION = ".pdf" as const;

export function isSupportedLocalPdfPath(filePath: string): boolean {
  return lowerCaseExtensionOf(filePath) === SUPPORTED_LOCAL_PDF_EXTENSION;
}

const localVideoExtensions: ReadonlySet<string> = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
  ".ogv",
]);

export function isSupportedLocalVideoPath(filePath: string): boolean {
  const extension = lowerCaseExtensionOf(filePath);
  return extension !== null && localVideoExtensions.has(extension);
}

/**
 * Query parameter asking the route for a browser-playable WebM copy of a video.
 * Sona's bundled Chromium has no H.264/HEVC decoder, so the player requests the
 * converted copy only after native playback reports an unsupported source.
 */
export const LOCAL_PREVIEW_PLAYABLE_PARAM = "playable" as const;
export const LOCAL_PREVIEW_PLAYABLE_WEBM = "webm" as const;

// Full allowlist for the /api/local-image serving route. Markdown image source
// detection (below) intentionally stays image-only: a `.pdf` link in chat
// markdown must never be inlined as an <img>.
export function isSupportedLocalPreviewFilePath(filePath: string): boolean {
  return (
    isSupportedLocalImagePath(filePath) ||
    isSupportedLocalPdfPath(filePath) ||
    isSupportedLocalVideoPath(filePath)
  );
}

// Built from the canonical extensions list so the web regex never drifts from the
// server allowlist. Anchored at end-of-string to match `.png`-style suffixes only.
export const SUPPORTED_LOCAL_IMAGE_EXTENSION_REGEX: RegExp = (() => {
  const escaped = SUPPORTED_LOCAL_IMAGE_EXTENSIONS.map((extension) =>
    extension.slice(1).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`\\.(?:${escaped.join("|")})$`, "i");
})();
