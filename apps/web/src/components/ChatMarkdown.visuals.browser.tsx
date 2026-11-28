// FILE: ChatMarkdown.visuals.browser.tsx
// Purpose: Verifies ```mermaid and ```json-render fences render as diagrams and previews.
// Layer: Web chat browser tests

import "../index.css";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

import ChatMarkdown from "./ChatMarkdown";

const ARCHITECTURE = [
  "Here is the system:",
  "",
  "```mermaid",
  "flowchart LR",
  '  UI["Web UI"] -->|REST| API["HTTP API"]',
  '  API --> DB[("Postgres")]',
  "  click API callback",
  "```",
].join("\n");

const DASHBOARD = [
  "```json-render",
  JSON.stringify({
    root: "page",
    elements: {
      page: { type: "Grid", props: { columns: 2 }, children: ["latency", "ok"] },
      latency: {
        type: "Metric",
        props: { label: "p95 latency", value: "182 ms", change: "-14%", trend: "down" },
      },
      ok: { type: "Badge", props: { label: "Healthy", tone: "success" } },
    },
  }),
  "```",
].join("\n");

describe("visual fences", () => {
  it("draws mermaid diagrams strictly and toggles to the source", async () => {
    await page.viewport(900, 700);
    const screen = await render(
      <ChatMarkdown text={ARCHITECTURE} cwd={undefined} isStreaming={false} />,
    );
    try {
      // The source shows while mermaid loads; wait for the drawn SVG.
      await expect
        .poll(() => document.querySelector(".chat-mermaid svg")?.textContent ?? "", {
          timeout: 15_000,
        })
        .toContain("HTTP API");
      // Strict security: no script elements or inline handlers survive.
      expect(document.querySelector(".chat-mermaid script")).toBeNull();
      expect(document.querySelector(".chat-mermaid [onclick]")).toBeNull();
      await page.getByRole("button", { name: "Show source" }).click();
      await expect.element(page.getByText("flowchart LR")).toBeVisible();
      expect(document.querySelector(".chat-mermaid")).toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("renders json-render specs with Sona components and rejects unknown ones", async () => {
    const screen = await render(
      <ChatMarkdown text={DASHBOARD} cwd={undefined} isStreaming={false} />,
    );
    try {
      // The JSON source also contains these strings; assert inside the rendered preview.
      await expect
        .poll(() => document.querySelector(".chat-generative-ui")?.textContent ?? "", {
          timeout: 15_000,
        })
        .toContain("182 ms");
      expect(document.querySelector(".chat-generative-ui")?.textContent).toContain("Healthy");
      await screen.rerender(
        <ChatMarkdown
          text={DASHBOARD.replace('"Badge"', '"Script"')}
          cwd={undefined}
          isStreaming={false}
        />,
      );
      await expect.element(page.getByText("Couldn't render this preview")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("shows a pending state for an unfinished fence while streaming", async () => {
    const screen = await render(
      <ChatMarkdown text={'```json-render\n{"root": "page", "elem'} cwd={undefined} isStreaming />,
    );
    try {
      await expect.element(page.getByText("Building preview…")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });
});
