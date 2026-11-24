import type { McpConnector } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { automationToolRows } from "./AutomationToolsPicker";

function connector(
  overrides: Partial<McpConnector> & Pick<McpConnector, "name" | "serverName">,
): McpConnector {
  return {
    connectorId: overrides.serverName,
    presetId: null,
    authKind: "oauth",
    status: "connected",
    url: "https://mcp.example.com/mcp",
    createdAt: "2026-11-17T09:00:00.000Z",
    updatedAt: "2026-11-17T09:00:00.000Z",
    ...overrides,
  } as McpConnector;
}

describe("automationToolRows", () => {
  it("lists connected tools, then linked tools that are no longer connected", () => {
    const rows = automationToolRows(
      [
        connector({ name: "Linear", serverName: "linear_connector" }),
        connector({ name: "Notion", serverName: "notion_connector", status: "needs-auth" }),
        connector({ name: "GitHub", serverName: "github_connector" }),
      ],
      [
        { serverName: "github_connector", name: "GitHub" },
        { serverName: "notion_connector", name: "Notion" },
        { serverName: "clickup_connector", name: "ClickUp" },
      ],
    );

    expect(rows.map((row) => [row.serverName, row.linked, row.connected])).toEqual([
      ["linear_connector", false, true],
      ["github_connector", true, true],
      ["notion_connector", true, false],
      ["clickup_connector", true, false],
    ]);
  });

  it("skips connectors whose server name a run could not be linked to", () => {
    const rows = automationToolRows([connector({ name: "Odd", serverName: "Odd Server" })], []);

    expect(rows).toEqual([]);
  });

  it("keeps linked tool names within the contract limit", () => {
    const [row] = automationToolRows(
      [connector({ name: "x".repeat(80), serverName: "long_connector" })],
      [],
    );

    expect(row?.name).toHaveLength(60);
  });
});
