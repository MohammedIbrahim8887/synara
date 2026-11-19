import { join } from "node:path";

import type {
  BrowserLogsInput,
  BrowserRunInput,
  BrowserScreenshotInput,
  BrowserTabId,
  BrowserToolName,
  BrowserToolNavigateInput,
  BrowserToolOpenInput,
  BrowserUploadInput,
  ThreadId,
} from "@synara/contracts";
import {
  BROWSER_TOOL_DEFINITIONS_BY_NAME,
  stableJsonStringify,
} from "@synara/shared/browserAutomationCatalogue";
import { Schema } from "effect";

import type { BrowserAutomationToolRequest } from "../browserAutomation/desktopBrowserAutomationHost";
import type { BrowserAutomationVisibleRuntime } from "../browserManager";
import { describeBetterwrightFailure } from "../browserAutomation/betterwrightFailure";
import { runBetterwright } from "../browserAutomation/betterwrightRuntime";
import { BrowserAutomationHostError, browserHostError } from "../browserAutomation/hostErrors";
import { browserEvaluationOutput } from "../browserAutomation/waitAndEvaluate";
import { uploadBrowserFiles } from "../browserAutomation/workspaceUpload";
import {
  HistoryUnavailableError,
  NavigationError,
  NavigationTimeoutError,
  type LoadMilestone,
  type OwnedBrowser,
  type OwnedTab,
} from "./ownedBrowser";

const MAX_IDEMPOTENCY_ENTRIES = 512;
const IDEMPOTENCY_TTL_MS = 15 * 60_000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_FULL_PAGE_HEIGHT = 16_384;

const bytesTruncate = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) {
    end = Math.floor(end * 0.9);
  }
  return value.slice(0, end);
};

/** Reads width/height from a PNG IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.byteLength < 24) return { width: 1, height: 1 };
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly result: Promise<unknown>;
  readonly expiresAt: number;
}

export interface OwnedBrowserAutomationHostOptions {
  /** Private Betterwright worker home, never the user's workspace. */
  readonly engineHome: string;
}

/**
 * Implements the `browser_*` tool contract on Sona's owned Chromium. Inputs and
 * outputs go through the same schemas the Electron host validates against.
 */
export class OwnedBrowserAutomationHost {
  private readonly affinity = new Map<string, string>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly tabLocks = new Map<string, Promise<unknown>>();
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly browser: OwnedBrowser,
    private readonly options: OwnedBrowserAutomationHostOptions,
  ) {}

  async waitForIdle(): Promise<void> {
    await Promise.allSettled(this.inFlight);
  }

  async dispose(): Promise<void> {
    await this.waitForIdle();
  }

  executeTool(request: BrowserAutomationToolRequest): Promise<unknown> {
    const definition = BROWSER_TOOL_DEFINITIONS_BY_NAME[request.name as BrowserToolName];
    if (!definition) browserHostError({ code: "BrowserInputUnsupported" });
    let input: Record<string, unknown>;
    try {
      input = Schema.decodeUnknownSync(definition.input as never)(request.arguments) as Record<
        string,
        unknown
      >;
    } catch {
      browserHostError({ code: "BrowserInvalidArguments" });
    }
    const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey : null;
    if (key) {
      const cacheKey = `${request.sessionId}\u0000${request.threadId}\u0000${request.name}\u0000${key}`;
      const fingerprint = stableJsonStringify({ ...input, timeoutMs: undefined });
      const now = Date.now();
      const cached = this.idempotency.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        if (cached.fingerprint !== fingerprint) {
          browserHostError({
            code: "BrowserRequestConflict",
            retryable: false,
            phase: "input",
            effectMayHaveCommitted: false,
          });
        }
        return cached.result;
      }
      const result = this.track(this.run(request, input, definition.hostOutput));
      this.idempotency.set(cacheKey, { fingerprint, result, expiresAt: now + IDEMPOTENCY_TTL_MS });
      // A failure must not be replayed to a deliberate retry.
      result.catch(() => this.idempotency.delete(cacheKey));
      while (this.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) {
        this.idempotency.delete(this.idempotency.keys().next().value as string);
      }
      return result;
    }
    return this.track(this.run(request, input, definition.hostOutput));
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.inFlight.add(operation);
    void operation.then(
      () => this.inFlight.delete(operation),
      () => this.inFlight.delete(operation),
    );
    return operation;
  }

  private async run(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
    hostOutput: Schema.Top,
  ): Promise<unknown> {
    const output = await this.dispatch(request, input);
    try {
      return Schema.decodeUnknownSync(hostOutput as never)(output);
    } catch (error) {
      console.error("[owned-browser] Tool output failed validation:", request.name, String(error));
      browserHostError({
        code: "BrowserMalformedResponse",
        retryable: false,
        phase: "runtime",
        effectMayHaveCommitted: true,
      });
    }
  }

  private affinityKey(request: BrowserAutomationToolRequest): string {
    return `${request.sessionId}\u0000${request.threadId}`;
  }

  private resolveTab(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
  ): OwnedTab {
    const requested = typeof input.tabId === "string" ? input.tabId : null;
    if (requested) {
      const tab = this.browser.tab(requested);
      if (!tab)
        browserHostError({
          code: "BrowserTabNotFound",
          retryable: false,
          phase: "routing",
          effectMayHaveCommitted: false,
        });
      if (tab.threadId !== request.threadId) {
        browserHostError({
          code: "BrowserTabScopeViolation",
          retryable: false,
          phase: "routing",
          effectMayHaveCommitted: false,
        });
      }
      return tab;
    }
    const assigned = this.affinity.get(this.affinityKey(request));
    const tab =
      (assigned ? this.browser.tab(assigned) : undefined) ??
      this.browser.activeTab(request.threadId);
    if (!tab) {
      browserHostError({
        code: "BrowserTabNotFound",
        retryable: false,
        phase: "routing",
        effectMayHaveCommitted: false,
      });
    }
    return tab;
  }

  /** Serializes tool calls per tab; the pane's human input is not blocked. */
  private withTab<T>(tab: OwnedTab, operation: () => Promise<T>): Promise<T> {
    const previous = this.tabLocks.get(tab.id) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.tabLocks.set(tab.id, settled);
    void settled.then(() => {
      if (this.tabLocks.get(tab.id) === settled) this.tabLocks.delete(tab.id);
    });
    return next;
  }

  private takeDialogs(tab: OwnedTab): { dialogs?: OwnedTab["dialogs"] } {
    if (tab.dialogs.length === 0) return {};
    const dialogs = tab.dialogs;
    tab.dialogs = [];
    return { dialogs };
  }

  private timeout(input: Record<string, unknown>, fallback = 30_000): number {
    return typeof input.timeoutMs === "number" ? input.timeoutMs : fallback;
  }

  private async dispatch(
    request: BrowserAutomationToolRequest,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const signal = request.signal;
    switch (request.name) {
      case "browser_status": {
        const assigned = this.affinity.get(this.affinityKey(request));
        return {
          available: true,
          physicalScope: "visible-shared-electron-webview",
          assignedTabId: assigned && this.browser.tab(assigned) ? assigned : null,
          authorization: "not-required",
        };
      }
      case "browser_tabs": {
        const state = this.browser.getState(request.threadId);
        const assigned = this.affinity.get(this.affinityKey(request));
        return {
          tabs: this.browser.threadTabs(request.threadId).map((tab) => ({
            tabId: tab.id,
            title: bytesTruncate(tab.title, 2_048),
            url: bytesTruncate(tab.url || "about:blank", 8_192),
            active: tab.id === state.activeTabId,
            loading: tab.loading,
            routable: true,
            state: tab.crashed ? "crashed" : "live",
          })),
          activeTabId: state.activeTabId,
          assignedTabId: assigned && this.browser.tab(assigned) ? assigned : null,
        };
      }
      case "browser_open":
        return this.open(request, input as BrowserToolOpenInput);
      case "browser_navigate": {
        const navigateInput = input as BrowserToolNavigateInput;
        if (!navigateInput.url) browserHostError({ code: "BrowserInputUnsupported" });
        const url = this.requireWebUrl(navigateInput.url);
        const tab = this.resolveTab(request, input);
        return this.withTab(tab, () =>
          this.navigation(tab, () =>
            this.browser.navigate(
              tab,
              url,
              navigateInput.waitUntil as LoadMilestone,
              this.timeout(input),
              signal,
            ),
          ),
        );
      }
      case "browser_back":
      case "browser_forward":
      case "browser_reload": {
        const tab = this.resolveTab(request, input);
        const action =
          request.name === "browser_back"
            ? "back"
            : request.name === "browser_forward"
              ? "forward"
              : "reload";
        return this.withTab(tab, () =>
          this.navigation(tab, () =>
            this.browser.navigateBy(
              tab,
              action,
              input.waitUntil as LoadMilestone,
              this.timeout(input),
              {
                ...(input.ignoreCache === true ? { ignoreCache: true } : {}),
                ...(signal ? { signal } : {}),
              },
            ),
          ),
        );
      }
      case "browser_resize": {
        const tab = this.resolveTab(request, input);
        const width = input.width as number;
        const height = input.height as number;
        return this.withTab(tab, async () => {
          const observed = await this.browser.setAgentViewport(tab, width, height);
          return {
            tabId: tab.id,
            requested: { width, height },
            observed,
            ...this.takeDialogs(tab),
          };
        });
      }
      case "browser_screenshot": {
        const tab = this.resolveTab(request, input);
        return this.withTab(tab, () => this.screenshot(tab, input as BrowserScreenshotInput));
      }
      case "browser_logs":
        return this.logs(this.resolveTab(request, input), input as BrowserLogsInput);
      case "browser_upload": {
        const tab = this.resolveTab(request, input);
        return this.withTab(tab, () =>
          uploadBrowserFiles(
            this.runtime(tab),
            input as BrowserUploadInput,
            request.workspaceRoot,
            signal,
          ),
        );
      }
      case "browser_run": {
        const tab = this.resolveTab(request, input);
        this.affinity.set(this.affinityKey(request), tab.id);
        return this.withTab(tab, async () => {
          let value: unknown;
          try {
            value = await runBetterwright({
              home: this.options.engineHome,
              contents: tab.contents as never,
              code: (input as BrowserRunInput).code,
              timeoutMs: this.timeout(input, 15_000),
              signal: signal ?? new AbortController().signal,
            });
          } catch (error) {
            if (signal?.aborted) throw error;
            if (error instanceof BrowserAutomationHostError) throw error;
            browserHostError({
              code: "BrowserEvaluationFailed",
              retryable: false,
              phase: "evaluate",
              effectMayHaveCommitted: true,
              cause: describeBetterwrightFailure(error, "runtime").cause,
            });
          }
          return { ...browserEvaluationOutput(tab.id, value), ...this.takeDialogs(tab) };
        });
      }
      case "browser_close": {
        const tab = this.resolveTab(request, input);
        return this.withTab(tab, async () => {
          const dialogs = this.takeDialogs(tab);
          await this.browser.closeTab(tab);
          const key = this.affinityKey(request);
          if (this.affinity.get(key) === tab.id) this.affinity.delete(key);
          return {
            closedTabId: tab.id,
            activeTabId: this.browser.getState(request.threadId).activeTabId,
            ...dialogs,
          };
        });
      }
      default:
        browserHostError({ code: "BrowserInputUnsupported" });
    }
  }

  private runtime(tab: OwnedTab): BrowserAutomationVisibleRuntime {
    return {
      threadId: tab.threadId,
      tabId: tab.id,
      webContents: tab.contents as never,
    };
  }

  private requireWebUrl(value: string): string {
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      // Fall through to the typed error.
    }
    browserHostError({
      code: "BrowserNavigationBlocked",
      retryable: false,
      phase: "navigation",
      effectMayHaveCommitted: false,
    });
  }

  private async open(
    request: BrowserAutomationToolRequest,
    input: BrowserToolOpenInput,
  ): Promise<unknown> {
    const url = input.url ? this.requireWebUrl(input.url) : null;
    const key = this.affinityKey(request);
    const reusable =
      input.reuse !== false
        ? ((this.affinity.get(key) ? this.browser.tab(this.affinity.get(key)!) : undefined) ??
          this.browser.activeTab(request.threadId))
        : undefined;
    const tab = reusable ?? (await this.browser.createTab(request.threadId));
    this.affinity.set(key, tab.id);
    this.browser.selectTab(request.threadId, tab.id);
    if (input.show !== false) {
      await this.browser.openThread(request.threadId);
      this.browser.requestOpenPanel(request.threadId);
    }
    const disposition = reusable ? "reused" : "created";
    if (!url) {
      return {
        tabId: tab.id,
        finalUrl: bytesTruncate(tab.url || "about:blank", 8_192),
        redirects: [],
        loadState: "load",
        disposition,
        ...this.takeDialogs(tab),
      };
    }
    const result = (await this.withTab(tab, () =>
      this.navigation(tab, () =>
        this.browser.navigate(tab, url, "domcontentloaded", this.timeout(input), request.signal),
      ),
    )) as Record<string, unknown>;
    return { ...result, disposition };
  }

  private async navigation(
    tab: OwnedTab,
    operation: () => Promise<{ finalUrl: string; redirects: string[]; loadState: LoadMilestone }>,
  ): Promise<unknown> {
    try {
      const result = await operation();
      return {
        tabId: tab.id,
        finalUrl: bytesTruncate(result.finalUrl || "about:blank", 8_192),
        redirects: result.redirects.filter(Boolean).map((url) => bytesTruncate(url, 8_192)),
        loadState: result.loadState,
        ...this.takeDialogs(tab),
      };
    } catch (error) {
      if (error instanceof NavigationTimeoutError) {
        browserHostError({
          code: "BrowserTimeout",
          retryable: true,
          phase: "navigation",
          effectMayHaveCommitted: true,
          tabId: tab.id as BrowserTabId,
        });
      }
      if (error instanceof HistoryUnavailableError) {
        browserHostError({
          code: "BrowserNavigationFailed",
          retryable: false,
          phase: "navigation",
          effectMayHaveCommitted: false,
          tabId: tab.id as BrowserTabId,
        });
      }
      if (error instanceof NavigationError) {
        browserHostError({
          code: /ERR_(BLOCKED|ACCESS_DENIED|PROXY|TUNNEL)/u.test(error.errorText)
            ? "BrowserNetworkBlocked"
            : "BrowserNavigationFailed",
          retryable: true,
          phase: "navigation",
          effectMayHaveCommitted: true,
          tabId: tab.id as BrowserTabId,
        });
      }
      throw error;
    }
  }

  private async screenshot(tab: OwnedTab, input: BrowserScreenshotInput): Promise<unknown> {
    const fullPage = input.fullPage === true;
    let clipped = false;
    const params: Record<string, unknown> = { format: "png" };
    if (fullPage) {
      const metrics = (await tab.contents.debugger.sendCommand("Page.getLayoutMetrics")) as {
        cssContentSize?: { width: number; height: number };
      };
      const width = Math.max(1, Math.min(3_840, Math.ceil(metrics.cssContentSize?.width ?? 1)));
      const fullHeight = Math.ceil(metrics.cssContentSize?.height ?? 1);
      const height = Math.max(1, Math.min(MAX_FULL_PAGE_HEIGHT, fullHeight));
      clipped = fullHeight > height;
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width, height, scale: 1 };
    }
    let data = await this.capture(tab, params);
    let png = Buffer.from(data, "base64");
    for (const scale of [0.5, 0.25]) {
      if (png.byteLength <= MAX_SCREENSHOT_BYTES) break;
      const viewport = tab.viewport;
      const clip = (params.clip as Record<string, number> | undefined) ?? {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      };
      data = await this.capture(tab, { ...params, clip: { ...clip, scale } });
      png = Buffer.from(data, "base64");
    }
    if (png.byteLength > MAX_SCREENSHOT_BYTES) {
      browserHostError({ code: "BrowserScreenshotTooLarge" });
    }
    const size = pngSize(png);
    const image = {
      mimeType: "image/png" as const,
      width: Math.max(1, Math.min(3_840, size.width)),
      height: Math.max(1, Math.min(16_384, size.height)),
      byteLength: png.byteLength,
    };
    return {
      structuredContent: {
        tabId: tab.id,
        url: bytesTruncate(tab.url || "about:blank", 8_192),
        capturedAt: new Date().toISOString(),
        mode: fullPage ? "fullPage" : "viewport",
        clipped,
        image,
        ...this.takeDialogs(tab),
      },
      image: { ...image, data },
    };
  }

  private async capture(tab: OwnedTab, params: Record<string, unknown>): Promise<string> {
    const result = (await tab.contents.debugger.sendCommand("Page.captureScreenshot", params)) as {
      data?: string;
    };
    if (!result.data) {
      browserHostError({
        code: "BrowserMalformedResponse",
        retryable: true,
        phase: "snapshot",
        effectMayHaveCommitted: false,
      });
    }
    return result.data;
  }

  private logs(tab: OwnedTab, input: BrowserLogsInput): unknown {
    const entries = [
      ...(input.includeConsole !== false ? tab.consoleLogs : []),
      ...(input.includeNetwork !== false ? tab.networkLogs.filter((entry) => entry.url) : []),
    ].toSorted((left, right) => left.timestamp - right.timestamp);
    const limit = (input.limit as number | undefined) ?? 100;
    const selected = entries.slice(-limit);
    return {
      tabId: tab.id,
      startedAt: new Date(tab.attachedAt).toISOString(),
      capturedAt: new Date().toISOString(),
      entries: selected.map((entry) => {
        const timestamp = new Date(entry.timestamp).toISOString();
        if (entry.kind === "console") {
          return {
            kind: "console",
            timestamp,
            level: entry.level,
            text: bytesTruncate(entry.text, 4_096),
            ...(entry.url ? { url: bytesTruncate(entry.url, 8_192) } : {}),
            ...(entry.lineNumber !== undefined
              ? { lineNumber: Math.min(10_000_000, Math.max(0, entry.lineNumber)) }
              : {}),
            ...(entry.columnNumber !== undefined
              ? { columnNumber: Math.min(10_000_000, Math.max(0, entry.columnNumber)) }
              : {}),
          };
        }
        return {
          kind: "network",
          timestamp,
          phase: entry.phase,
          requestId: bytesTruncate(entry.requestId || "unknown", 256),
          url: bytesTruncate(entry.url, 8_192),
          method: bytesTruncate(entry.method || "GET", 32),
          ...(entry.status !== undefined && entry.status >= 100 && entry.status <= 599
            ? { status: entry.status }
            : {}),
          ...(entry.mimeType ? { mimeType: bytesTruncate(entry.mimeType, 256) } : {}),
          ...(entry.errorText ? { errorText: bytesTruncate(entry.errorText, 1_024) } : {}),
          ...(entry.durationMs !== undefined
            ? { durationMs: Math.min(3_600_000, Math.max(0, entry.durationMs)) }
            : {}),
        };
      }),
      droppedCount: Math.min(1_000_000_000, tab.droppedLogs),
      truncated: entries.length > selected.length,
      ...this.takeDialogs(tab),
    };
  }
}

export const ownedBrowserEngineHome = (home: string) => join(home, "browser-engine");
export type { ThreadId };
