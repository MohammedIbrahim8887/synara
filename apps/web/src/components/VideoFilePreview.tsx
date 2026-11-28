import { useEffect, useRef, useState } from "react";
import { useTranslation } from "~/i18n";
import { fetchExecutionResourceUrl, isDesktopFrameResourceUrl } from "~/lib/wsHttpUrl";
import { PanelStateMessage } from "./chat/PanelStateMessage";

export function VideoFilePreview(props: {
  url: string;
  /** Same file as `url`, served as the server's cached WebM conversion. */
  playableUrl: string;
  fileName: string;
  isVisible: boolean;
  onReady: () => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const { onError } = props;
  // File/reload changes remount this component. A background grant renewal
  // should only replace the source if a subsequent range request fails.
  const [urls, setUrls] = useState({ original: props.url, playable: props.playableUrl });
  // Sona's Chromium has no H.264/HEVC decoder. When the original is rejected
  // as unsupported, retry once with the WebM conversion of the same file.
  const [converted, setConverted] = useState(false);
  const url = converted ? urls.playable : urls.original;
  const resume = useRef<{ time: number; playing: boolean } | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!props.isVisible) player.current?.pause();
  }, [props.isVisible]);
  const proxied = isDesktopFrameResourceUrl(url);
  const [objectUrl, setObjectUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  // Native media requests stream directly except in desktop child frames,
  // where only the owning controller can fetch a workspace resource.
  useEffect(() => {
    if (!proxied) return;
    const controller = new AbortController();
    let ownedUrl: string | undefined;
    void fetchExecutionResourceUrl(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("video/")) {
          await response.body?.cancel();
          throw new Error("Video preview unavailable");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        ownedUrl = URL.createObjectURL(blob);
        setObjectUrl(ownedUrl);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailed(true);
        onError();
      });
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [proxied, url, onError]);

  if (failed) {
    return (
      <PanelStateMessage density="compact" fill="flex">
        <p role="status">{t("workspace:filePreview_videoPlaybackFailed")}</p>
      </PanelStateMessage>
    );
  }
  return (
    <video
      className="min-h-0 w-full flex-1 bg-black object-contain"
      ref={player}
      aria-label={props.fileName}
      src={proxied ? objectUrl : url}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (resume.current) {
          video.currentTime = resume.current.time;
          if (resume.current.playing && props.isVisible) void video.play().catch(() => undefined);
          resume.current = null;
        }
        props.onReady();
      }}
      onError={(event) => {
        const video = event.currentTarget;
        if (!proxied && urls.original !== props.url) {
          resume.current = { time: video.currentTime, playing: !video.paused };
          setUrls({ original: props.url, playable: props.playableUrl });
          return;
        }
        if (!converted && video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          setConverted(true);
          return;
        }
        setFailed(true);
        onError();
      }}
    />
  );
}
