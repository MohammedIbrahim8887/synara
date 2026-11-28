import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type { BrowserTabState, ThreadBrowserState, ThreadId } from "@synara/contracts";

import type { CdpEvent, CdpParams, CdpPipe } from "./cdpPipe";

export type LoadMilestone = "commit" | "domcontentloaded" | "load" | "networkidle";
const MILESTONE_ORDER: Record<LoadMilestone, number> = {
  commit: 0,
  domcontentloaded: 1,
  load: 2,
  networkidle: 3,
};
const LIFECYCLE_TO_MILESTONE: Record<string, LoadMilestone> = {
  commit: "commit",
  DOMContentLoaded: "domcontentloaded",
  load: "load",
  networkIdle: "networkidle",
};

const MAX_TABS_PER_THREAD = 24;
const MAX_LOG_ENTRIES = 500;
const MAX_DIALOGS = 20;
const DEFAULT_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface ConsoleLog {
  readonly kind: "console";
  readonly timestamp: number;
  readonly level: "debug" | "info" | "log" | "warn" | "error" | "exception";
  readonly text: string;
  readonly url?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
}

export interface NetworkLog {
  readonly kind: "network";
  readonly timestamp: number;
  readonly phase: "request" | "response" | "failure";
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  readonly mimeType?: string;
  readonly errorText?: string;
  readonly durationMs?: number;
}

export interface HandledDialog {
  readonly kind: "alert" | "confirm" | "prompt" | "beforeunload";
  readonly message: string;
  readonly defaultPrompt?: string;
  readonly action: "accepted" | "dismissed";
  readonly openedAt: string;
}

export interface ScreencastFrame {
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The subset of Electron's `Session` the Betterwright network guard drives.
 * The guard's proxy is fixed at Chromium launch, so these are bookkeeping only.
 */
export class OwnedBrowserSession {
  proxyRules: string | null = null;
  async setProxy(config: { proxyRules?: string }): Promise<void> {
    this.proxyRules = config.proxyRules ?? null;
  }
  async closeAllConnections(): Promise<void> {}
}

type DebuggerListener = (...args: unknown[]) => void;

/**
 * A `WebContents`-shaped view of one owned tab: exactly the surface the shared
 * Betterwright bridge and workspace-upload code use. Commands without a session
 * address the tab's page session, as Electron's debugger does.
 */
export class OwnedTabContents extends EventEmitter {
  private static nextId = 1;
  readonly id = OwnedTabContents.nextId++;
  private readonly debuggerEvents = new EventEmitter();
  private readonly childSessions = new Set<string>();

  readonly debugger = {
    attach: () => {},
    isAttached: () => !this.tab.destroyed && !this.browser.cdp.closed,
    sendCommand: (method: string, params: CdpParams = {}, sessionId?: string) => {
      if (this.tab.destroyed) return Promise.reject(new Error("Browser target is unavailable."));
      const route = sessionId ?? this.tab.sessionId;
      return new Promise<unknown>((resolve, reject) => {
        this.browser.cdp.sendOrdered(method, params, route, (error, result) => {
          // Register the new session before any of its events are routed.
          if (
            !error &&
            method === "Target.attachToTarget" &&
            result &&
            typeof (result as { sessionId?: unknown }).sessionId === "string"
          ) {
            this.childSessions.add((result as { sessionId: string }).sessionId);
          }
          this.enqueue(() => (error ? reject(error) : resolve(result)));
        });
      });
    },
    on: (event: string, listener: DebuggerListener) => {
      this.debuggerEvents.on(event, listener);
    },
    removeListener: (event: string, listener: DebuggerListener) => {
      this.debuggerEvents.removeListener(event, listener);
    },
  };

  constructor(
    private readonly browser: OwnedBrowser,
    private readonly tab: OwnedTab,
  ) {
    super();
    this.setMaxListeners(64);
    this.debuggerEvents.setMaxListeners(64);
  }

  /**
   * Replies and events reach debugger consumers in Chromium's wire order, one
   * per macrotask. Electron's debugger guarantees this; Playwright depends on
   * it (an execution context announced before its frame tree is dropped, and
   * every evaluate in that world then waits forever).
   */
  private readonly ordered: Array<() => void> = [];
  private draining = false;

  private enqueue(deliver: () => void): void {
    this.ordered.push(deliver);
    if (this.draining) return;
    this.draining = true;
    setImmediate(this.drainOne);
  }

  private readonly drainOne = (): void => {
    this.ordered.shift()?.();
    if (this.ordered.length > 0) setImmediate(this.drainOne);
    else this.draining = false;
  };

  get session(): OwnedBrowserSession {
    return this.browser.session;
  }

  /** Routes one pipe event to debugger listeners if it belongs to this tab. */
  deliver(event: CdpEvent): void {
    if (event.sessionId === this.tab.sessionId) {
      if (event.method === "Target.attachedToTarget") {
        const child = (event.params as { sessionId?: unknown }).sessionId;
        if (typeof child === "string") this.childSessions.add(child);
      }
      this.enqueue(() =>
        this.debuggerEvents.emit("message", {}, event.method, event.params, undefined),
      );
      return;
    }
    if (event.sessionId && this.childSessions.has(event.sessionId)) {
      if (event.method === "Target.attachedToTarget") {
        const child = (event.params as { sessionId?: unknown }).sessionId;
        if (typeof child === "string") this.childSessions.add(child);
      }
      const childSession = event.sessionId;
      this.enqueue(() =>
        this.debuggerEvents.emit("message", {}, event.method, event.params, childSession),
      );
    }
  }

  ownsSession(sessionId: string): boolean {
    return sessionId === this.tab.sessionId || this.childSessions.has(sessionId);
  }

  forgetSession(sessionId: string): void {
    this.childSessions.delete(sessionId);
  }

  markDestroyed(): void {
    this.debuggerEvents.emit("detach", {}, "target closed");
    this.emit("destroyed");
  }

  isDestroyed(): boolean {
    return this.tab.destroyed;
  }
  getURL(): string {
    return this.tab.url;
  }
  getTitle(): string {
    return this.tab.title;
  }
  getType(): string {
    return "window";
  }
  getZoomFactor(): number {
    return 1;
  }
  getBackgroundThrottling(): boolean {
    return false;
  }
  setBackgroundThrottling(): void {}
  focus(): void {}
  sendInputEvent(input: { type: string; x: number; y: number; modifiers?: string[] }): void {
    if (input.type !== "mouseMove") return;
    const bits = { alt: 1, control: 2, meta: 4, shift: 8 } as const;
    const modifiers = (input.modifiers ?? []).reduce(
      (sum, name) => sum | (bits[name as keyof typeof bits] ?? 0),
      0,
    );
    void this.debugger
      .sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: input.x,
        y: input.y,
        modifiers,
      })
      .catch(() => {});
  }
}

export interface OwnedTab {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly targetId: string;
  sessionId: string;
  url: string;
  title: string;
  loading: boolean;
  lastError: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  openerTabId?: string;
  destroyed: boolean;
  crashed: boolean;
  viewport: Viewport;
  /** Set by browser_resize; the pane stops resizing the page until it is cleared. */
  agentViewport: boolean;
  mainFrameId: string | null;
  loaderId: string | null;
  reached: Set<LoadMilestone>;
  /** Increments for each new main-frame document or same-document navigation. */
  navigationSeq: number;
  sameDocument: boolean;
  redirects: string[];
  readonly attachedAt: number;
  readonly consoleLogs: ConsoleLog[];
  readonly networkLogs: NetworkLog[];
  droppedLogs: number;
  readonly requestStarts: Map<string, { at: number; url: string; method: string }>;
  dialogs: HandledDialog[];
  readonly contents: OwnedTabContents;
  readonly changed: EventEmitter;
  screencasting: boolean;
}

interface ThreadRecord {
  open: boolean;
  activeTabId: string | null;
  tabOrder: string[];
  version: number;
  lastError: string | null;
  /** Pane bounds, used for tabs the agent has not explicitly resized. */
  paneViewport: Viewport | null;
}

const truncate = (value: string, maxChars: number) =>
  value.length > maxChars ? value.slice(0, maxChars) : value;

const isMainFrame = (frame: { parentId?: unknown } | undefined) => !frame?.parentId;

export class OwnedBrowser {
  private readonly tabs = new Map<string, OwnedTab>();
  private readonly tabsByTarget = new Map<string, OwnedTab>();
  private readonly tabsBySession = new Map<string, OwnedTab>();
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly stateListeners = new Set<(state: ThreadBrowserState) => void>();
  private readonly frameListeners = new Map<string, Set<(frame: ScreencastFrame) => void>>();
  private readonly openPanelListeners = new Set<(threadId: ThreadId) => void>();
  private userAgent: string | null = null;

  constructor(
    readonly cdp: CdpPipe,
    readonly session: OwnedBrowserSession = new OwnedBrowserSession(),
  ) {
    cdp.on((event) => this.onEvent(event));
  }

  async initialize(): Promise<void> {
    await this.cdp.send("Target.setDiscoverTargets", { discover: true });
    await this.cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
    const version = await this.cdp.send<{ userAgent?: string }>("Browser.getVersion");
    // Many sites refuse a "HeadlessChrome" user agent; present the regular one.
    this.userAgent = version.userAgent?.replace(/HeadlessChrome/gu, "Chrome") ?? null;
  }

  // ── State ───────────────────────────────────────────────────────────

  onState(listener: (state: ThreadBrowserState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onOpenPanel(listener: (threadId: ThreadId) => void): () => void {
    this.openPanelListeners.add(listener);
    return () => this.openPanelListeners.delete(listener);
  }

  requestOpenPanel(threadId: ThreadId): void {
    for (const listener of this.openPanelListeners) listener(threadId);
  }

  private thread(threadId: ThreadId): ThreadRecord {
    let record = this.threads.get(threadId);
    if (!record) {
      record = {
        open: false,
        activeTabId: null,
        tabOrder: [],
        version: 0,
        lastError: null,
        paneViewport: null,
      };
      this.threads.set(threadId, record);
    }
    return record;
  }

  getState(threadId: ThreadId): ThreadBrowserState {
    const record = this.thread(threadId);
    const tabs: BrowserTabState[] = record.tabOrder.flatMap((tabId) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return [];
      return [
        {
          id: tab.id,
          url: tab.url,
          title: tab.title || tab.url,
          runtimeSurface: "native",
          status: "live",
          isLoading: tab.loading,
          canGoBack: tab.canGoBack,
          canGoForward: tab.canGoForward,
          faviconUrl: null,
          lastCommittedUrl: tab.url,
          lastError: tab.crashed ? "This page crashed. Reload to try again." : tab.lastError,
          ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
        },
      ];
    });
    return {
      threadId,
      version: record.version,
      open: record.open,
      activeTabId: record.activeTabId,
      tabs,
      lastError: record.lastError,
    };
  }

  private emitState(threadId: ThreadId): void {
    const record = this.thread(threadId);
    record.version += 1;
    const state = this.getState(threadId);
    for (const listener of this.stateListeners) listener(state);
  }

  tab(tabId: string): OwnedTab | undefined {
    return this.tabs.get(tabId);
  }

  threadTabs(threadId: ThreadId): OwnedTab[] {
    return this.thread(threadId).tabOrder.flatMap((id) => this.tabs.get(id) ?? []);
  }

  activeTab(threadId: ThreadId): OwnedTab | undefined {
    const record = this.thread(threadId);
    return record.activeTabId ? this.tabs.get(record.activeTabId) : undefined;
  }

  // ── Tabs ────────────────────────────────────────────────────────────

  async createTab(
    threadId: ThreadId,
    options: { activate?: boolean; openerTabId?: string } = {},
  ): Promise<OwnedTab> {
    const record = this.thread(threadId);
    if (record.tabOrder.length >= MAX_TABS_PER_THREAD) {
      throw new Error("This chat already has the maximum number of browser tabs.");
    }
    const { targetId } = await this.cdp.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
      // Each tab gets its own headless window so none is a hidden background
      // page; Chromium throttles animation frames there and stalls locators.
      newWindow: true,
    });
    return this.adoptTarget(threadId, targetId, "about:blank", options);
  }

  private async adoptTarget(
    threadId: ThreadId,
    targetId: string,
    url: string,
    options: { activate?: boolean; openerTabId?: string },
  ): Promise<OwnedTab> {
    const { sessionId } = await this.cdp.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const record = this.thread(threadId);
    const tab: OwnedTab = {
      id: randomUUID(),
      threadId,
      targetId,
      sessionId,
      url,
      title: "",
      loading: false,
      lastError: null,
      canGoBack: false,
      canGoForward: false,
      ...(options.openerTabId ? { openerTabId: options.openerTabId } : {}),
      destroyed: false,
      crashed: false,
      viewport: { ...(record.paneViewport ?? DEFAULT_VIEWPORT) },
      agentViewport: false,
      mainFrameId: null,
      loaderId: null,
      reached: new Set(["commit", "domcontentloaded", "load", "networkidle"]),
      navigationSeq: 0,
      sameDocument: false,
      redirects: [],
      attachedAt: Date.now(),
      consoleLogs: [],
      networkLogs: [],
      droppedLogs: 0,
      requestStarts: new Map(),
      dialogs: [],
      contents: undefined as unknown as OwnedTabContents,
      changed: new EventEmitter(),
      screencasting: false,
    };
    tab.changed.setMaxListeners(64);
    (tab as { contents: OwnedTabContents }).contents = new OwnedTabContents(this, tab);
    this.tabs.set(tab.id, tab);
    this.tabsByTarget.set(targetId, tab);
    this.tabsBySession.set(sessionId, tab);

    const send = (method: string, params: CdpParams = {}) =>
      this.cdp.send(method, params, sessionId);
    await Promise.all([
      send("Page.enable"),
      send("Page.setLifecycleEventsEnabled", { enabled: true }),
      send("Runtime.enable"),
      send("Network.enable"),
      send("Log.enable"),
      // Headless pages otherwise report as unfocused, which breaks some inputs.
      send("Emulation.setFocusEmulationEnabled", { enabled: true }),
      send("Page.setWebLifecycleState", { state: "active" }).catch(() => {}),
      ...(this.userAgent
        ? [send("Network.setUserAgentOverride", { userAgent: this.userAgent })]
        : []),
      this.applyViewport(tab),
    ]);
    const { frameTree } = await send("Page.getFrameTree").then(
      (value) => value as { frameTree?: { frame?: { id?: string } } },
    );
    tab.mainFrameId = frameTree?.frame?.id ?? null;

    record.tabOrder.push(tab.id);
    if (options.activate !== false || !record.activeTabId) record.activeTabId = tab.id;
    this.emitState(threadId);
    return tab;
  }

  async closeTab(tab: OwnedTab): Promise<void> {
    if (!tab.destroyed) {
      await this.cdp.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => {});
    }
    this.forgetTab(tab);
  }

  private forgetTab(tab: OwnedTab): void {
    if (!this.tabs.has(tab.id)) return;
    tab.destroyed = true;
    this.tabs.delete(tab.id);
    this.tabsByTarget.delete(tab.targetId);
    this.tabsBySession.delete(tab.sessionId);
    this.frameListeners.delete(tab.id);
    tab.contents.markDestroyed();
    tab.changed.emit("change");
    const record = this.thread(tab.threadId);
    const index = record.tabOrder.indexOf(tab.id);
    record.tabOrder = record.tabOrder.filter((id) => id !== tab.id);
    if (record.activeTabId === tab.id) {
      record.activeTabId =
        record.tabOrder[Math.min(Math.max(index - 1, 0), record.tabOrder.length - 1)] ?? null;
    }
    this.emitState(tab.threadId);
  }

  selectTab(threadId: ThreadId, tabId: string): void {
    const record = this.thread(threadId);
    if (!record.tabOrder.includes(tabId)) throw new Error("Unknown browser tab.");
    record.activeTabId = tabId;
    this.emitState(threadId);
    const tab = this.tabs.get(tabId);
    if (tab && !tab.agentViewport) void this.fitToPane(tab).catch(() => {});
  }

  /** The user took the page back from an agent resize: follow the pane again. */
  async releaseAgentViewport(tab: OwnedTab): Promise<void> {
    if (!tab.agentViewport) return;
    tab.agentViewport = false;
    await this.fitToPane(tab);
  }

  private async fitToPane(tab: OwnedTab): Promise<void> {
    const pane = this.thread(tab.threadId).paneViewport;
    if (
      !pane ||
      (tab.viewport.width === pane.width &&
        tab.viewport.height === pane.height &&
        tab.viewport.deviceScaleFactor === pane.deviceScaleFactor)
    ) {
      return;
    }
    tab.viewport = { ...pane };
    await this.applyViewport(tab);
    if (tab.screencasting) await this.restartScreencast(tab);
  }

  async openThread(threadId: ThreadId, initialUrl?: string): Promise<ThreadBrowserState> {
    const record = this.thread(threadId);
    record.open = true;
    let tab = this.activeTab(threadId);
    if (!tab) tab = await this.createTab(threadId);
    if (initialUrl) await this.navigate(tab, initialUrl, "commit", 15_000);
    this.emitState(threadId);
    return this.getState(threadId);
  }

  async closeThread(threadId: ThreadId): Promise<ThreadBrowserState> {
    for (const tab of this.threadTabs(threadId)) await this.closeTab(tab);
    const record = this.thread(threadId);
    record.open = false;
    record.activeTabId = null;
    this.emitState(threadId);
    return this.getState(threadId);
  }

  async dispose(): Promise<void> {
    // Deleting the visited entry during Map iteration is safe.
    for (const tab of this.tabs.values()) await this.closeTab(tab);
    await this.cdp.send("Browser.close").catch(() => {});
    this.cdp.close();
  }

  // ── Viewport ────────────────────────────────────────────────────────

  async setPaneViewport(threadId: ThreadId, viewport: Viewport | null): Promise<void> {
    if (!viewport) return;
    const next = {
      width: Math.max(200, Math.min(3_840, Math.round(viewport.width))),
      height: Math.max(150, Math.min(2_160, Math.round(viewport.height))),
      deviceScaleFactor: Math.max(1, Math.min(3, viewport.deviceScaleFactor)),
    };
    const record = this.thread(threadId);
    record.paneViewport = next;
    const tab = this.activeTab(threadId);
    if (!tab || tab.agentViewport) return;
    if (
      tab.viewport.width === next.width &&
      tab.viewport.height === next.height &&
      tab.viewport.deviceScaleFactor === next.deviceScaleFactor
    ) {
      return;
    }
    tab.viewport = next;
    await this.applyViewport(tab);
    if (tab.screencasting) await this.restartScreencast(tab);
  }

  async setAgentViewport(tab: OwnedTab, width: number, height: number): Promise<Viewport> {
    tab.agentViewport = true;
    tab.viewport = { width, height, deviceScaleFactor: tab.viewport.deviceScaleFactor };
    await this.applyViewport(tab);
    if (tab.screencasting) await this.restartScreencast(tab);
    return this.observeViewport(tab);
  }

  async observeViewport(tab: OwnedTab): Promise<Viewport> {
    const metrics = await this.cdp
      .send<{ cssVisualViewport?: { clientWidth?: number; clientHeight?: number } }>(
        "Page.getLayoutMetrics",
        {},
        tab.sessionId,
      )
      .catch(() => ({}) as { cssVisualViewport?: { clientWidth?: number; clientHeight?: number } });
    return {
      width: Math.max(1, Math.round(metrics.cssVisualViewport?.clientWidth ?? tab.viewport.width)),
      height: Math.max(
        1,
        Math.round(metrics.cssVisualViewport?.clientHeight ?? tab.viewport.height),
      ),
      deviceScaleFactor: tab.viewport.deviceScaleFactor,
    };
  }

  private applyViewport(tab: OwnedTab): Promise<unknown> {
    return this.cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: tab.viewport.width,
        height: tab.viewport.height,
        deviceScaleFactor: tab.viewport.deviceScaleFactor,
        mobile: false,
      },
      tab.sessionId,
    );
  }

  // ── Navigation ──────────────────────────────────────────────────────

  async navigate(
    tab: OwnedTab,
    url: string,
    waitUntil: LoadMilestone,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ finalUrl: string; redirects: string[]; loadState: LoadMilestone }> {
    tab.redirects = [];
    const sequence = tab.navigationSeq;
    const result = await this.cdp.send<{ loaderId?: string; errorText?: string }>(
      "Page.navigate",
      { url },
      tab.sessionId,
    );
    if (result.errorText) {
      tab.lastError = result.errorText;
      this.emitState(tab.threadId);
      throw new NavigationError(result.errorText);
    }
    tab.lastError = null;
    await this.waitForNavigation(tab, sequence, waitUntil, timeoutMs, signal);
    return { finalUrl: tab.url, redirects: [...tab.redirects], loadState: waitUntil };
  }

  /** Runs a history/reload command and waits for the document it produces. */
  async navigateBy(
    tab: OwnedTab,
    action: "back" | "forward" | "reload",
    waitUntil: LoadMilestone,
    timeoutMs: number,
    options: { ignoreCache?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ finalUrl: string; redirects: string[]; loadState: LoadMilestone }> {
    tab.redirects = [];
    const sequence = tab.navigationSeq;
    if (action === "reload") {
      await this.cdp.send(
        "Page.reload",
        { ignoreCache: options.ignoreCache ?? false },
        tab.sessionId,
      );
    } else {
      const history = await this.cdp.send<{
        currentIndex: number;
        entries: Array<{ id: number }>;
      }>("Page.getNavigationHistory", {}, tab.sessionId);
      const entry = history.entries[history.currentIndex + (action === "back" ? -1 : 1)];
      if (!entry) throw new HistoryUnavailableError(action);
      await this.cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, tab.sessionId);
    }
    await this.waitForNavigation(tab, sequence, waitUntil, timeoutMs, options.signal);
    return { finalUrl: tab.url, redirects: [...tab.redirects], loadState: waitUntil };
  }

  private waitForNavigation(
    tab: OwnedTab,
    sequence: number,
    waitUntil: LoadMilestone,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const satisfied = () =>
      tab.navigationSeq > sequence &&
      (tab.sameDocument ||
        [...tab.reached].some((reached) => MILESTONE_ORDER[reached] >= MILESTONE_ORDER[waitUntil]));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        tab.changed.removeListener("change", check);
        signal?.removeEventListener("abort", onAbort);
      };
      const check = () => {
        if (tab.destroyed) {
          cleanup();
          reject(new Error("Browser tab closed during navigation."));
        } else if (tab.lastError && tab.navigationSeq > sequence) {
          cleanup();
          reject(new NavigationError(tab.lastError));
        } else if (satisfied()) {
          cleanup();
          resolve();
        }
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Cancelled."));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new NavigationTimeoutError());
      }, timeoutMs);
      tab.changed.on("change", check);
      signal?.addEventListener("abort", onAbort, { once: true });
      check();
    });
  }

  private async refreshHistory(tab: OwnedTab): Promise<void> {
    const history = await this.cdp
      .send<{ currentIndex: number; entries: unknown[] }>(
        "Page.getNavigationHistory",
        {},
        tab.sessionId,
      )
      .catch(() => null);
    if (!history || tab.destroyed) return;
    const canGoBack = history.currentIndex > 0;
    const canGoForward = history.currentIndex < history.entries.length - 1;
    if (canGoBack !== tab.canGoBack || canGoForward !== tab.canGoForward) {
      tab.canGoBack = canGoBack;
      tab.canGoForward = canGoForward;
      this.emitState(tab.threadId);
    }
  }

  // ── Screencast and input ────────────────────────────────────────────

  subscribeFrames(tab: OwnedTab, listener: (frame: ScreencastFrame) => void): () => void {
    let listeners = this.frameListeners.get(tab.id);
    if (!listeners) {
      listeners = new Set();
      this.frameListeners.set(tab.id, listeners);
    }
    listeners.add(listener);
    if (!tab.screencasting) void this.startScreencast(tab);
    return () => {
      const current = this.frameListeners.get(tab.id);
      current?.delete(listener);
      if (current && current.size === 0) {
        this.frameListeners.delete(tab.id);
        void this.stopScreencast(tab);
      }
    };
  }

  private async startScreencast(tab: OwnedTab): Promise<void> {
    if (tab.destroyed) return;
    tab.screencasting = true;
    await this.cdp
      .send(
        "Page.startScreencast",
        {
          format: "jpeg",
          quality: 80,
          maxWidth: Math.round(tab.viewport.width * tab.viewport.deviceScaleFactor),
          maxHeight: Math.round(tab.viewport.height * tab.viewport.deviceScaleFactor),
          everyNthFrame: 1,
        },
        tab.sessionId,
      )
      .catch(() => {
        tab.screencasting = false;
      });
  }

  private async stopScreencast(tab: OwnedTab): Promise<void> {
    if (!tab.screencasting) return;
    tab.screencasting = false;
    if (!tab.destroyed) {
      await this.cdp.send("Page.stopScreencast", {}, tab.sessionId).catch(() => {});
    }
  }

  private async restartScreencast(tab: OwnedTab): Promise<void> {
    await this.stopScreencast(tab);
    if (this.frameListeners.get(tab.id)?.size) await this.startScreencast(tab);
  }

  async dispatchInput(tab: OwnedTab, input: PaneInput): Promise<void> {
    const send = (method: string, params: CdpParams) =>
      this.cdp.send(method, params, tab.sessionId);
    switch (input.kind) {
      case "mouse":
        await send("Input.dispatchMouseEvent", {
          type: input.type,
          x: input.x,
          y: input.y,
          button: input.button,
          buttons: input.buttons,
          clickCount: input.clickCount,
          modifiers: input.modifiers,
        });
        return;
      case "wheel":
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: input.x,
          y: input.y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
          modifiers: input.modifiers,
        });
        return;
      case "key":
        await send("Input.dispatchKeyEvent", {
          type: input.type,
          key: input.key,
          code: input.code,
          modifiers: input.modifiers,
          windowsVirtualKeyCode: input.keyCode,
          ...(input.text ? { text: input.text, unmodifiedText: input.text } : {}),
          ...(input.commands?.length ? { commands: input.commands } : {}),
          ...(input.location ? { location: input.location } : {}),
          autoRepeat: input.repeat ?? false,
        });
        return;
      case "text":
        await send("Input.insertText", { text: input.text });
        return;
    }
  }

  async captureJpeg(tab: OwnedTab): Promise<string | null> {
    const result = await this.cdp
      .send<{ data?: string }>(
        "Page.captureScreenshot",
        { format: "jpeg", quality: 70 },
        tab.sessionId,
      )
      .catch(() => null);
    return result?.data ? `data:image/jpeg;base64,${result.data}` : null;
  }

  // ── Event routing ───────────────────────────────────────────────────

  private onEvent(event: CdpEvent): void {
    if (!event.sessionId) {
      this.onBrowserEvent(event);
      return;
    }
    const tab = this.tabsBySession.get(event.sessionId);
    if (tab) {
      this.onTabEvent(tab, event);
      tab.contents.deliver(event);
      return;
    }
    for (const owner of this.tabs.values()) {
      if (owner.contents.ownsSession(event.sessionId)) {
        if (event.method === "Target.detachedFromTarget") {
          owner.contents.forgetSession(event.sessionId);
        }
        owner.contents.deliver(event);
        return;
      }
    }
  }

  private onBrowserEvent(event: CdpEvent): void {
    const params = event.params as {
      targetInfo?: {
        targetId: string;
        type: string;
        url: string;
        title: string;
        openerId?: string;
      };
      targetId?: string;
      sessionId?: string;
    };
    switch (event.method) {
      case "Target.targetCreated": {
        const info = params.targetInfo;
        if (!info || info.type !== "page" || !info.openerId) return;
        const opener = this.tabsByTarget.get(info.openerId);
        if (!opener || this.tabsByTarget.has(info.targetId)) return;
        // A popup (window.open / target=_blank) joins its opener's chat as a new tab.
        void this.adoptTarget(opener.threadId, info.targetId, info.url || "about:blank", {
          activate: true,
          openerTabId: opener.id,
        }).catch((error: unknown) => {
          console.warn("[owned-browser] Popup could not be attached:", String(error));
        });
        return;
      }
      case "Target.targetInfoChanged": {
        const info = params.targetInfo;
        const tab = info ? this.tabsByTarget.get(info.targetId) : undefined;
        if (!info || !tab) return;
        if (tab.title !== info.title || tab.url !== info.url) {
          tab.title = info.title;
          if (info.url) tab.url = info.url;
          this.emitState(tab.threadId);
        }
        return;
      }
      case "Target.targetDestroyed":
      case "Target.targetCrashed": {
        const tab = params.targetId ? this.tabsByTarget.get(params.targetId) : undefined;
        if (!tab) return;
        if (event.method === "Target.targetCrashed") {
          tab.crashed = true;
          this.emitState(tab.threadId);
        } else {
          this.forgetTab(tab);
        }
        return;
      }
      case "Target.detachedFromTarget": {
        const tab = params.sessionId ? this.tabsBySession.get(params.sessionId) : undefined;
        if (tab) this.forgetTab(tab);
        return;
      }
    }
  }

  private onTabEvent(tab: OwnedTab, event: CdpEvent): void {
    const params = event.params as Record<string, any>;
    switch (event.method) {
      case "Page.lifecycleEvent": {
        if (tab.mainFrameId && params.frameId !== tab.mainFrameId) return;
        if (params.name === "init") {
          tab.loaderId = params.loaderId;
          tab.reached = new Set();
          tab.sameDocument = false;
          tab.navigationSeq += 1;
          tab.loading = true;
          tab.crashed = false;
          this.emitState(tab.threadId);
        } else if (params.loaderId === tab.loaderId) {
          const milestone = LIFECYCLE_TO_MILESTONE[params.name as string];
          if (milestone) tab.reached.add(milestone);
          if (milestone === "load") {
            tab.loading = false;
            this.emitState(tab.threadId);
            void this.refreshHistory(tab);
          }
        }
        tab.changed.emit("change");
        return;
      }
      case "Page.frameNavigated": {
        if (!isMainFrame(params.frame)) return;
        tab.mainFrameId = params.frame.id;
        if (params.frame.loaderId && params.frame.loaderId !== tab.loaderId) {
          // A document committed without an "init" lifecycle event (e.g. a restore).
          tab.loaderId = params.frame.loaderId;
          tab.reached = new Set();
          tab.sameDocument = false;
          tab.navigationSeq += 1;
        }
        tab.url = params.frame.url + (params.frame.urlFragment ?? "");
        tab.reached.add("commit");
        tab.lastError = null;
        tab.consoleLogs.length = 0;
        tab.contents.emit("did-navigate");
        this.emitState(tab.threadId);
        void this.refreshHistory(tab);
        tab.changed.emit("change");
        return;
      }
      case "Page.navigatedWithinDocument": {
        if (tab.mainFrameId && params.frameId !== tab.mainFrameId) return;
        tab.url = params.url;
        tab.sameDocument = true;
        tab.navigationSeq += 1;
        this.emitState(tab.threadId);
        void this.refreshHistory(tab);
        tab.changed.emit("change");
        return;
      }
      case "Page.frameStoppedLoading": {
        if (tab.mainFrameId && params.frameId !== tab.mainFrameId) return;
        if (tab.loading) {
          tab.loading = false;
          this.emitState(tab.threadId);
        }
        return;
      }
      case "Page.screencastFrame": {
        void this.cdp
          .send("Page.screencastFrameAck", { sessionId: params.sessionId }, tab.sessionId)
          .catch(() => {});
        const listeners = this.frameListeners.get(tab.id);
        if (!listeners) return;
        const frame: ScreencastFrame = {
          threadId: tab.threadId,
          tabId: tab.id,
          data: params.data,
          width: params.metadata?.deviceWidth ?? tab.viewport.width,
          height: params.metadata?.deviceHeight ?? tab.viewport.height,
        };
        for (const listener of listeners) listener(frame);
        return;
      }
      case "Page.javascriptDialogOpening": {
        const kind = (["alert", "confirm", "prompt", "beforeunload"] as const).includes(params.type)
          ? (params.type as HandledDialog["kind"])
          : "alert";
        // No native dialog exists in a streamed page; accept so the page never stalls.
        void this.cdp
          .send(
            "Page.handleJavaScriptDialog",
            {
              accept: true,
              ...(kind === "prompt" ? { promptText: params.defaultPrompt ?? "" } : {}),
            },
            tab.sessionId,
          )
          .catch(() => {});
        tab.dialogs.push({
          kind,
          message: truncate(String(params.message ?? ""), 1_024),
          ...(kind === "prompt" && params.defaultPrompt
            ? { defaultPrompt: truncate(String(params.defaultPrompt), 1_024) }
            : {}),
          action: "accepted",
          openedAt: new Date().toISOString(),
        });
        if (tab.dialogs.length > MAX_DIALOGS)
          tab.dialogs.splice(0, tab.dialogs.length - MAX_DIALOGS);
        return;
      }
      case "Network.requestWillBeSent": {
        if (
          params.redirectResponse &&
          params.type === "Document" &&
          params.frameId === tab.mainFrameId
        ) {
          tab.redirects.push(String(params.redirectResponse.url ?? params.request?.url ?? ""));
          if (tab.redirects.length > 20) tab.redirects.shift();
        }
        tab.requestStarts.set(params.requestId, {
          at: Date.now(),
          url: String(params.request?.url ?? ""),
          method: String(params.request?.method ?? "GET"),
        });
        if (tab.requestStarts.size > 2_000) {
          const oldest = tab.requestStarts.keys().next().value;
          if (oldest !== undefined) tab.requestStarts.delete(oldest);
        }
        this.pushNetwork(tab, {
          kind: "network",
          timestamp: Date.now(),
          phase: "request",
          requestId: String(params.requestId),
          url: String(params.request?.url ?? ""),
          method: String(params.request?.method ?? "GET"),
        });
        return;
      }
      case "Network.responseReceived": {
        const started = tab.requestStarts.get(params.requestId);
        this.pushNetwork(tab, {
          kind: "network",
          timestamp: Date.now(),
          phase: "response",
          requestId: String(params.requestId),
          url: String(params.response?.url ?? started?.url ?? ""),
          method: started?.method ?? "GET",
          ...(typeof params.response?.status === "number"
            ? { status: params.response.status }
            : {}),
          ...(params.response?.mimeType ? { mimeType: String(params.response.mimeType) } : {}),
          ...(started ? { durationMs: Date.now() - started.at } : {}),
        });
        return;
      }
      case "Network.loadingFailed": {
        const started = tab.requestStarts.get(params.requestId);
        this.pushNetwork(tab, {
          kind: "network",
          timestamp: Date.now(),
          phase: "failure",
          requestId: String(params.requestId),
          url: started?.url ?? "",
          method: started?.method ?? "GET",
          errorText: String(params.errorText ?? "failed"),
        });
        return;
      }
      case "Runtime.consoleAPICalled": {
        const level = (["debug", "info", "log", "warn", "error"] as const).find(
          (candidate) => candidate === params.type,
        );
        const text = (params.args as Array<{ value?: unknown; description?: string }> | undefined)
          ?.map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? "")))
          .join(" ");
        const frame = params.stackTrace?.callFrames?.[0];
        this.pushConsole(tab, {
          kind: "console",
          timestamp: Date.now(),
          level: level ?? (params.type === "warning" ? "warn" : "log"),
          text: text ?? "",
          ...(frame?.url ? { url: frame.url } : {}),
          ...(typeof frame?.lineNumber === "number" ? { lineNumber: frame.lineNumber } : {}),
          ...(typeof frame?.columnNumber === "number" ? { columnNumber: frame.columnNumber } : {}),
        });
        return;
      }
      case "Runtime.exceptionThrown": {
        const details = params.exceptionDetails ?? {};
        this.pushConsole(tab, {
          kind: "console",
          timestamp: Date.now(),
          level: "exception",
          text: String(details.exception?.description ?? details.text ?? "Uncaught exception"),
          ...(details.url ? { url: details.url } : {}),
          ...(typeof details.lineNumber === "number" ? { lineNumber: details.lineNumber } : {}),
          ...(typeof details.columnNumber === "number"
            ? { columnNumber: details.columnNumber }
            : {}),
        });
        return;
      }
      case "Log.entryAdded": {
        const entry = params.entry ?? {};
        const level =
          entry.level === "verbose"
            ? "debug"
            : entry.level === "warning"
              ? "warn"
              : entry.level === "error"
                ? "error"
                : "info";
        this.pushConsole(tab, {
          kind: "console",
          timestamp: Date.now(),
          level,
          text: String(entry.text ?? ""),
          ...(entry.url ? { url: entry.url } : {}),
          ...(typeof entry.lineNumber === "number" ? { lineNumber: entry.lineNumber } : {}),
        });
        return;
      }
      case "Inspector.targetCrashed": {
        tab.crashed = true;
        tab.loading = false;
        this.emitState(tab.threadId);
        tab.changed.emit("change");
        return;
      }
    }
  }

  private pushConsole(tab: OwnedTab, entry: ConsoleLog): void {
    tab.consoleLogs.push(entry);
    if (tab.consoleLogs.length > MAX_LOG_ENTRIES) {
      tab.consoleLogs.shift();
      tab.droppedLogs += 1;
    }
  }

  private pushNetwork(tab: OwnedTab, entry: NetworkLog): void {
    tab.networkLogs.push(entry);
    if (tab.networkLogs.length > MAX_LOG_ENTRIES) {
      tab.networkLogs.shift();
      tab.droppedLogs += 1;
    }
  }
}

export type PaneInput =
  | {
      kind: "mouse";
      type: "mousePressed" | "mouseReleased" | "mouseMoved";
      x: number;
      y: number;
      button: "none" | "left" | "middle" | "right";
      buttons: number;
      clickCount: number;
      modifiers: number;
    }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: number }
  | {
      kind: "key";
      type: "keyDown" | "rawKeyDown" | "keyUp";
      key: string;
      code: string;
      keyCode: number;
      modifiers: number;
      text?: string;
      commands?: string[];
      location?: number;
      repeat?: boolean;
    }
  | { kind: "text"; text: string };

export class NavigationError extends Error {
  constructor(readonly errorText: string) {
    super(`Navigation failed: ${errorText}`);
    this.name = "NavigationError";
  }
}

export class NavigationTimeoutError extends Error {
  constructor() {
    super("Navigation timed out.");
    this.name = "NavigationTimeoutError";
  }
}

export class HistoryUnavailableError extends Error {
  constructor(readonly direction: "back" | "forward" | "reload") {
    super(`No ${direction} history entry.`);
    this.name = "HistoryUnavailableError";
  }
}
