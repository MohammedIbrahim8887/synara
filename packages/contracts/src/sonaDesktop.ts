/** Narrow capabilities exposed only to Sona's bundled, sandboxed desktop view. */
export interface SonaDesktop {
  notify(input: { title: string; body: string }): Promise<void>;
  /**
   * Loopback socket for the in-app browser pane, served by Sona's owned
   * Chromium host. Null while it starts or when no Chromium browser exists.
   */
  browserPane?(): Promise<{ url: string; token: string } | null>;
}
