/**
 * Stands in for `electron` when the shared browser-automation modules run in
 * Sona's owned-browser host (plain Node). Only the members those modules touch
 * at runtime exist; anything else fails loudly at bundle time.
 */
export const app = {
  getPath(_name: string): string {
    const home = process.env.SONA_OWNED_BROWSER_HOME;
    if (!home) throw new Error("Owned browser home is not configured.");
    return home;
  },
};

export const webContents = {
  // No Electron window owns focus here; there is nothing to restore.
  getFocusedWebContents: (): null => null,
};
