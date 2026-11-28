// FILE: SidebarPanelTitle.tsx
// Purpose: Title row at the top of a sidebar panel ("Settings", "Automations"), aligned with
//          the thread surface picker's title so every panel opens on the same baseline.
// Layer: Sidebar UI primitive

import type { ReactNode } from "react";

import { useTranslation } from "~/i18n";
import { XIcon } from "~/lib/icons";

import { SidebarIconButton } from "./SidebarIconButton";
import { useIsInMobileSidebarDrawer, useSidebar } from "./ui/sidebar";

/** Panel title type: display face at the title size (titles may use a fixed size). */
export const SIDEBAR_PANEL_TITLE_CLASS_NAME =
  "font-display min-w-0 truncate text-[17px] text-foreground";

export function SidebarPanelTitle({
  title,
  as: Heading = "h2",
  children,
}: {
  title: string;
  /** "h1" where the panel title is the page's own title (a route with no other heading). */
  as?: "h1" | "h2";
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 pt-1.5 pb-1 pr-2.5 pl-1.5">
      <Heading className="flex h-8 min-w-0 items-center px-2.5">
        <span className={SIDEBAR_PANEL_TITLE_CLASS_NAME}>{title}</span>
      </Heading>
      <div className="ml-auto flex items-center gap-1.5">
        {children}
        <SidebarMobileCloseButton />
      </div>
    </div>
  );
}

/**
 * Closes the phone drawer, which covers nearly the whole screen and leaves almost no backdrop
 * to tap. Renders nothing outside the mobile drawer, so desktop sidebars are unchanged.
 */
export function SidebarMobileCloseButton() {
  const { t } = useTranslation();
  const inDrawer = useIsInMobileSidebarDrawer();
  if (!inDrawer) return null;
  return <SidebarMobileCloseButtonInner label={t("workspace:closeSidebar")} />;
}

function SidebarMobileCloseButtonInner({ label }: { label: string }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarIconButton
      icon={XIcon}
      label={label}
      glyph="leading"
      size="header"
      onClick={() => setOpenMobile(false)}
    />
  );
}
