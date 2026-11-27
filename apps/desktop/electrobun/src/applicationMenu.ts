import { ApplicationMenu } from "electrobun/main";

/** CEF relies on AppKit's responder-chain menu actions for macOS edit shortcuts. */
export function installApplicationMenu(checkForUpdates?: () => void): void {
  if (process.platform !== "darwin") return;
  const updateAction = "sona-check-for-updates";
  if (checkForUpdates) {
    ApplicationMenu.on("application-menu-clicked", (event) => {
      if ((event as { data?: { action?: string } }).data?.action === updateAction)
        checkForUpdates();
    });
  }
  ApplicationMenu.setApplicationMenu([
    {
      label: "Sona",
      submenu: [
        ...(checkForUpdates
          ? [{ label: "Check for Updates…", action: updateAction }, { type: "separator" as const }]
          : []),
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ]);
}
