import "../../index.css";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { FlowDefinition, McpConnector } from "@synara/contracts";
import { FlowEditor } from "./FlowEditor";

afterEach(cleanup);

const connector = {
  connectorId: "c1",
  presetId: "linear",
  name: "Linear",
  serverName: "linear_connector",
  authKind: "oauth",
  status: "connected",
  url: "https://mcp.linear.app/mcp",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies McpConnector;

const saved = () => JSON.parse(document.querySelector("output")!.textContent!) as FlowDefinition;

async function mount(initial: FlowDefinition) {
  function Harness() {
    const [flow, setFlow] = useState(initial);
    return (
      <div style={{ width: 1400, height: 800, display: "flex", flexDirection: "column" }}>
        <FlowEditor
          flow={flow}
          flows={[flow]}
          connectors={[connector]}
          onChange={setFlow}
          onDelete={() => {}}
          onEditJson={() => {}}
          overview={<p>Overview</p>}
        />
        <output aria-label="Saved graph">{JSON.stringify(flow)}</output>
        <button onClick={() => setFlow(initial)}>Reset graph</button>
      </div>
    );
  }
  // The palette links to Settings, so the editor needs a router around it.
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory(),
  });
  await page.viewport(1440, 860);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const base: FlowDefinition = {
  id: "test",
  name: "Triage",
  kind: "workflow",
  enabled: false,
  projectId: "",
  nodes: [],
  edges: [],
};

it("chains a tool, a decision and its yes/no branches from the palette", async () => {
  const screen = await mount(base);
  const palette = screen.getByRole("complementary", { name: "Steps to add" });
  await palette.getByRole("button", { name: "Linear", exact: true }).click();
  await screen.getByLabelText("What should it do?").fill("List new issues");
  await palette.getByRole("button", { name: "Decision", exact: true }).click();
  await screen.getByLabelText("Name", { exact: true }).last().fill("Is it a bug?");
  await palette.getByRole("button", { name: "Instruction", exact: true }).click();
  await screen.getByLabelText("Instructions").fill("Fix it");
  await expect.poll(() => saved().nodes.length).toBe(3);
  const flow = saved();
  const [tool, decision, fix] = flow.nodes;
  expect(tool).toMatchObject({
    kind: "tool",
    value: "List new issues",
    tool: { serverName: "linear_connector", name: "Linear" },
  });
  expect(flow.edges).toMatchObject([
    { source: tool!.id, target: decision!.id },
    { source: decision!.id, target: fix!.id, branch: "yes" },
  ]);
  await expect.element(screen.getByText("Is it a bug?").first()).toBeVisible();
  await page.screenshot({ path: "node_modules/.cache/flows-editor.png" });

  await screen.getByRole("button", { name: "Remove step", exact: true }).click();
  await expect.poll(() => saved()).toMatchObject({ nodes: [{}, {}], edges: [{}] });
  expect(saved().edges[0]).not.toHaveProperty("branch");
  await screen.getByRole("button", { name: "Reset graph" }).click();
  await expect.element(screen.getByText("Is it a bug?")).not.toBeInTheDocument();
  await palette.getByRole("button", { name: "Instruction", exact: true }).click();
  await expect.poll(() => saved().nodes.length).toBe(1);
  expect(saved().edges).toEqual([]);
});

it("flags unfinished steps and keeps the header settings when steps change", async () => {
  const screen = await mount({ ...base, kind: "rule", nodes: [], text: "" });
  // A new rule opens on Write; its text is saved with the definition.
  await screen.getByLabelText("Write the rule in plain language").fill("Never push to main.");
  await screen.getByRole("radio", { name: "Draw" }).click();
  const palette = screen.getByRole("complementary", { name: "Steps to add" });
  await palette.getByRole("button", { name: "Require branch prefix", exact: true }).click();
  await expect.element(screen.getByText("Enter a branch prefix").first()).toBeVisible();
  await screen.getByLabelText("Branch prefix", { exact: true }).fill("feature/");
  await screen.getByRole("switch", { name: "Turned on" }).click();
  await expect
    .poll(() => saved())
    .toMatchObject({
      enabled: true,
      text: "Never push to main.",
      nodes: [{ kind: "branch-prefix", value: "feature/" }],
    });
  await expect.element(screen.getByText("Enter a branch prefix")).not.toBeInTheDocument();
  await page.screenshot({ path: "node_modules/.cache/flows-rule.png" });
});
