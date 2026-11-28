import { lazy, Suspense, useState, type ReactNode } from "react";

import { useTranslation } from "~/i18n";
import { CodeIcon, EyeIcon, Maximize2 } from "~/lib/icons";
import type { CodeFenceInfo } from "~/lib/codeFence";

import { MarkdownCodeBlock } from "../ChatMarkdown";
import { IconButton } from "../ui/icon-button";
import { Dialog, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";

export type VisualFenceKind = "mermaid" | "json-render";

/** Fence languages that render as a visual instead of highlighted source. */
export function visualFenceKind(rawFenceInfo: string): VisualFenceKind | null {
  // The raw info string: Shiki has no "json-render" grammar, so the parsed language
  // would already have fallen back to "text".
  const normalized = rawFenceInfo.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (normalized === "mermaid") return "mermaid";
  if (normalized === "json-render" || normalized === "jsonrender") return "json-render";
  return null;
}

// Both renderers are heavy (mermaid alone is several MB); load them only when a
// reply actually contains a visual fence.
const MermaidDiagram = lazy(() => import("./MermaidDiagram"));
const GenerativeUiPreview = lazy(() => import("./generativeUi/GenerativeUiPreview"));

function VisualBody({
  kind,
  code,
  isStreaming,
  expanded = false,
}: {
  kind: VisualFenceKind;
  code: string;
  isStreaming: boolean;
  expanded?: boolean;
}) {
  return kind === "mermaid" ? (
    <MermaidDiagram code={code} isStreaming={isStreaming} expanded={expanded} />
  ) : (
    <GenerativeUiPreview code={code} isStreaming={isStreaming} />
  );
}

/**
 * Code block chrome (title, copy) around a rendered diagram or UI preview, with a
 * toggle back to the source and an expanded view for large diagrams.
 */
export function VisualFenceBlock({
  kind,
  code,
  fence,
  isStreaming,
  source,
}: {
  kind: VisualFenceKind;
  code: string;
  fence: CodeFenceInfo;
  isStreaming: boolean;
  /** Highlighted source shown by the toggle and while the renderer loads. */
  source: ReactNode;
}) {
  const { t } = useTranslation();
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sourceLabel = showSource ? t("chat:visualShowRendered") : t("chat:visualShowSource");
  const actions = (
    <>
      <IconButton
        className="chat-markdown-codeblock__action"
        onClick={() => setShowSource((value) => !value)}
        title={sourceLabel}
        label={sourceLabel}
        aria-pressed={showSource}
        data-active={showSource ? "true" : "false"}
        size="icon-xs"
        variant="ghost"
      >
        {showSource ? <EyeIcon className="size-3" /> : <CodeIcon className="size-3" />}
      </IconButton>
      <IconButton
        className="chat-markdown-codeblock__action"
        onClick={() => setExpanded(true)}
        title={t("chat:visualExpand")}
        label={t("chat:visualExpand")}
        size="icon-xs"
        variant="ghost"
      >
        <Maximize2 className="size-3" />
      </IconButton>
    </>
  );
  return (
    <>
      <MarkdownCodeBlock code={code} fence={fence} actions={actions} hideWrapToggle={!showSource}>
        {showSource ? (
          source
        ) : (
          <div className="chat-visual-fence" data-kind={kind}>
            <Suspense fallback={source}>
              <VisualBody kind={kind} code={code} isStreaming={isStreaming} />
            </Suspense>
          </div>
        )}
      </MarkdownCodeBlock>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogPopup className="max-w-[min(1200px,calc(100vw-2rem))]">
          <DialogPanel>
            <DialogTitle className="sr-only">{t("chat:visualExpand")}</DialogTitle>
            <div className="chat-visual-fence chat-visual-fence--expanded" data-kind={kind}>
              <Suspense fallback={source}>
                <VisualBody kind={kind} code={code} isStreaming={isStreaming} expanded />
              </Suspense>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
