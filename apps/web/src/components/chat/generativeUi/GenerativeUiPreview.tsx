import { Component, useMemo, useRef, type ReactNode } from "react";
import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";

import { useTranslation } from "~/i18n";

import { generativeUiCatalog } from "./catalog";
import { generativeUiRegistry } from "./registry";

export type ParsedPreview =
  | { status: "ready"; spec: Spec }
  | { status: "incomplete" }
  | { status: "invalid"; message: string };

/** Leaf components rarely list `children`; the spec schema requires the array. */
function withDefaultChildren(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return json;
  const elements = (json as { elements?: unknown }).elements;
  if (typeof elements !== "object" || elements === null) return json;
  return {
    ...json,
    elements: Object.fromEntries(
      Object.entries(elements).map(([id, element]) => [
        id,
        typeof element === "object" && element !== null && !("children" in element)
          ? { ...element, children: [] }
          : element,
      ]),
    ),
  };
}

/** Parses and validates an agent-written spec against the display-only catalog. */
export function parseGenerativeUiSpec(code: string): ParsedPreview {
  let json: unknown;
  try {
    json = JSON.parse(code);
  } catch {
    return { status: "incomplete" };
  }
  const result = generativeUiCatalog.validate(withDefaultChildren(json));
  if (!result.success || !result.data) {
    const message =
      result.error?.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`)
        .join("\n") ?? "Invalid spec";
    return { status: "invalid", message };
  }
  return { status: "ready", spec: result.data as Spec };
}

/** Keyed by the spec source, so a corrected spec renders again. */
class PreviewErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function GenerativeUiPreview({
  code,
  isStreaming,
}: {
  code: string;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseGenerativeUiSpec(code), [code]);
  // While the fence streams, keep showing the last complete spec instead of flickering.
  const lastReady = useRef<Spec | null>(null);
  if (parsed.status === "ready") lastReady.current = parsed.spec;
  const spec = parsed.status === "ready" ? parsed.spec : isStreaming ? lastReady.current : null;

  if (spec === null) {
    if (isStreaming) {
      return (
        <p className="chat-visual-fence__pending text-ui-sm text-muted-foreground">
          {t("chat:visualPreviewPending")}
        </p>
      );
    }
    return (
      <div className="chat-visual-fence__error" role="alert">
        <p className="text-ui-sm font-medium">{t("chat:visualPreviewError")}</p>
        <p className="text-ui-xs whitespace-pre-wrap text-muted-foreground">
          {parsed.status === "invalid" ? parsed.message : t("chat:visualPreviewInvalidJson")}
        </p>
      </div>
    );
  }
  return (
    <PreviewErrorBoundary
      key={code}
      fallback={
        <p className="chat-visual-fence__error text-ui-sm" role="alert">
          {t("chat:visualPreviewError")}
        </p>
      }
    >
      <div className="chat-generative-ui">
        <JSONUIProvider registry={generativeUiRegistry}>
          <Renderer spec={spec} registry={generativeUiRegistry} loading={isStreaming} />
        </JSONUIProvider>
      </div>
    </PreviewErrorBoundary>
  );
}
