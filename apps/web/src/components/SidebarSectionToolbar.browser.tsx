import "../index.css";

import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { SidebarSectionToolbar } from "./SidebarSectionToolbar";
import { SidebarIconButton } from "./SidebarIconButton";

// The toolbar overlays a separate project disclosure button, just as in Sidebar.
// Hit-testing must reach New Chat rather than falling through to the disclosure.
describe("project toolbar on mobile", () => {
  it("keeps the project expanded when New Chat is tapped", async () => {
    await page.viewport(390, 844);
    const toggleProject = vi.fn();
    const newChat = vi.fn();
    const screen = await render(
      <div className="group/project-header relative w-64">
        <button type="button" className="h-9 w-full" onClick={toggleProject}>
          Project
        </button>
        <SidebarSectionToolbar placement="overlay" revealOnHover>
          <SidebarIconButton icon={() => <span>+</span>} label="New Chat" onClick={newChat} />
        </SidebarSectionToolbar>
      </div>,
    );
    const button = screen.getByRole("button", { name: "New Chat" }).element();
    const bounds = button.getBoundingClientRect();
    const target = document.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    expect(target && button.contains(target)).toBe(true);
    await screen.getByRole("button", { name: "New Chat" }).click();
    expect(newChat).toHaveBeenCalledOnce();
    expect(toggleProject).not.toHaveBeenCalled();
  });
});
