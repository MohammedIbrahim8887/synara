import { useEffect, useId, useState } from "react";
import type { Mermaid } from "mermaid";

import { useTranslation } from "~/i18n";
import { useTheme } from "~/hooks/useTheme";

let mermaidModule: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import("mermaid").then((module) => module.default);
  return mermaidModule;
}

// Mermaid keeps one global config; re-initialize only when the theme changes.
let initializedTheme: string | null = null;
function configure(mermaid: Mermaid, theme: "dark" | "light") {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    // Diagrams come from agent output: strict sanitizes labels and disables
    // click handlers and embedded scripts.
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: "var(--font-ui-family)",
  });
  initializedTheme = theme;
}

// While a reply streams the fence is often incomplete; wait for a pause before parsing.
const STREAMING_RENDER_DELAY_MS = 400;

type RenderState =
  | { status: "pending" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export default function MermaidDiagram({
  code,
  isStreaming,
  expanded = false,
}: {
  code: string;
  isStreaming: boolean;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const renderId = `sona-mermaid-${useId().replaceAll(":", "")}`;
  const [state, setState] = useState<RenderState>({ status: "pending" });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void loadMermaid()
          .then(async (mermaid) => {
            configure(mermaid, theme);
            const { svg } = await mermaid.render(renderId, code);
            if (!cancelled) setState({ status: "ready", svg });
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            // Keep the last good diagram while the fence is still being written.
            setState((previous) =>
              isStreaming && previous.status === "ready"
                ? previous
                : {
                    status: "error",
                    message: error instanceof Error ? error.message : String(error),
                  },
            );
          });
      },
      isStreaming ? STREAMING_RENDER_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, isStreaming, renderId, theme]);

  if (state.status === "error" && !isStreaming) {
    return (
      <div className="chat-visual-fence__error" role="alert">
        <p className="text-ui-sm font-medium">{t("chat:visualDiagramError")}</p>
        <p className="text-ui-xs text-muted-foreground">{state.message.split("\n")[0]}</p>
        <pre className="chat-visual-fence__error-source text-ui-xs">{code}</pre>
      </div>
    );
  }
  if (state.status !== "ready") {
    return (
      <p className="chat-visual-fence__pending text-ui-sm text-muted-foreground">
        {t("chat:visualDiagramPending")}
      </p>
    );
  }
  return (
    <div
      className="chat-mermaid"
      data-expanded={expanded ? "true" : "false"}
      // Mermaid's strict security level sanitizes the SVG with DOMPurify.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
