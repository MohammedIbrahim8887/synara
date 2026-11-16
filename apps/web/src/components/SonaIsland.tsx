import { useEffect, useEffectEvent, useLayoutEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronUpIcon } from "~/lib/icons";
import { useStore } from "../store";
import { createSidebarThreadSummariesSelector } from "../storeSelectors";
import { Button } from "./ui/button";
import { SynaraLogo } from "./SonaLogo";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";

/**
 * Lives in the macOS notch: hidden while idle, a compact pill while sessions run,
 * and the live chat surface (questions, approvals, composer) when expanded.
 */
export function SonaIsland({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { threadId } = useParams({ strict: false });
  const [selector] = useState(() => createSidebarThreadSummariesSelector());
  const threads = useStore(selector);
  const active = threads.filter(
    (thread) =>
      !thread.archivedAt &&
      (thread.session?.status === "running" ||
        thread.session?.status === "connecting" ||
        thread.hasPendingApprovals ||
        thread.hasPendingUserInput),
  );
  const needsYou = active.some(
    (thread) => thread.hasPendingApprovals || thread.hasPendingUserInput,
  );
  // Each surface is its own fixed-size native window (see desktopCompanion.ts).
  const expanded = window.sonaDesktop?.island === "expanded";
  const pillMode = active.length > 0 ? "compact" : "hidden";
  // Toasts are hidden in the notch surfaces, so failures go to the console.
  const send = (mode: "hidden" | "compact" | "expanded") =>
    void window.sonaDesktop
      ?.setIsland(mode)
      .catch((error: unknown) => console.error("Sona island action failed", error));
  const sendFromEffect = useEffectEvent(send);

  useLayoutEffect(() => {
    document.documentElement.classList.add("sona-island-window");
    return () => {
      document.documentElement.classList.remove("sona-island-window");
    };
  }, []);
  useEffect(() => {
    if (!expanded) sendFromEffect(pillMode);
  }, [expanded, pillMode]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") sendFromEffect("compact");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const label = t("workspace:islandRunning", { count: active.length });
  if (!expanded) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-expanded={false}
        onClick={() => send("expanded")}
        className="fixed inset-0 z-40 flex items-center justify-between rounded-b-2xl bg-black px-3 text-white"
      >
        <SynaraLogo className="size-5" />
        <span className="flex items-center gap-1.5 text-ui-sm tabular-nums">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", needsYou ? "bg-amber-400" : "bg-emerald-400")}
          />
          {active.length}
        </span>
      </button>
    );
  }
  return (
    <section className="sona-island fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden rounded-b-[28px] bg-black text-white">
      <header className="flex h-10 shrink-0 items-center gap-2 px-4">
        <SynaraLogo className="size-5" />
        <span className="min-w-0 flex-1 truncate text-ui-sm">{label}</span>
        {threadId && (
          <Button
            size="sm"
            variant="ghost"
            className="text-white"
            onClick={() => void navigate({ to: "/" })}
          >
            {t("workspace:islandSessions")}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white"
          aria-label={t("workspace:islandCollapse")}
          aria-expanded
          onClick={() => send("compact")}
        >
          <ChevronUpIcon aria-hidden />
        </Button>
      </header>
      <div className="mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-[20px] bg-background text-foreground">
        {threadId ? (
          children
        ) : (
          <div className="h-full overflow-y-auto p-2">
            {active.length === 0 && (
              <p className="p-3 text-ui text-muted-foreground">{t("workspace:islandIdle")}</p>
            )}
            {active.map((thread) => (
              <Button
                key={thread.id}
                variant="ghost"
                className="mb-1 h-auto w-full flex-col items-start gap-1 whitespace-normal p-3 text-left"
                onClick={() => void navigate({ to: "/$threadId", params: { threadId: thread.id } })}
              >
                <span className="text-ui">{thread.title}</span>
                <span className="text-ui-sm text-muted-foreground">
                  {t(
                    thread.hasPendingApprovals || thread.hasPendingUserInput
                      ? "workspace:islandNeedsYou"
                      : "workspace:islandWorking",
                  )}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
