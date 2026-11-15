import { getSafeExternalUrl } from "./externalUrl";

interface Events {
  on(name: string, listener: (event: unknown) => void): unknown;
  off(name: string, listener: (event: unknown) => void): unknown;
}

/** Only the trusted app view may hand HTTP(S) popups to the system browser. */
export function registerElectrobunExternalLinks(
  events: Events,
  appViewId: number,
  openExternal: (url: string) => boolean,
  onFailure: () => void,
): () => void {
  const name = `new-window-open-${appViewId}`;
  const listener = (event: unknown) => {
    const detail = (event as { data?: { detail?: unknown } } | null)?.data?.detail;
    const rawUrl = typeof detail === "string" ? detail : (detail as { url?: unknown } | null)?.url;
    const url = getSafeExternalUrl(rawUrl);
    if (!url) return;
    try {
      if (!openExternal(url)) onFailure();
    } catch {
      // Never log the authorization URL: it can contain OAuth state and codes.
      onFailure();
    }
  };
  events.on(name, listener);
  return () => events.off(name, listener);
}
