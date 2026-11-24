import { ApplicationMenu } from "electrobun/main";

/** CEF relies on AppKit's responder-chain menu actions for macOS edit shortcuts. */
export function installApplicationMenu(): void {
  if (process.platform !== "darwin") return;
  ApplicationMenu.setApplicationMenu([
    { label: "Sona", submenu: [{ role: "quit" }] },
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
