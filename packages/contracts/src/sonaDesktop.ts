/** Narrow capabilities exposed only to Sona's bundled, sandboxed desktop view. */
export interface SonaDesktop {
  /** Which notch island surface this view is, or false for the main window. */
  readonly island: false | "compact" | "expanded";
  notify(input: { title: string; body: string }): Promise<void>;
  /**
   * From the pill: "compact"/"hidden" report live work, "expanded" opens the panel.
   * From the panel: "compact" collapses back to the pill.
   */
  setIsland(mode: "hidden" | "compact" | "expanded"): Promise<void>;
}
