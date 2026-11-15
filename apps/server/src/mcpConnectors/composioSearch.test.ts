import { describe, expect, it, vi } from "vitest";
import { parseComposioSearch, searchComposioTools } from "./composioSearch";
import type { McpConnectorRuntime } from "./runtime";

const result = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        data: {
          results: [
            {
              primary_tool_slugs: ["GITHUB_LIST_PULL_REQUESTS"],
              related_tool_slugs: ["GITHUB_LIST_PULL_REQUESTS"],
            },
          ],
          tool_schemas: {
            GITHUB_LIST_PULL_REQUESTS: {
              name: "List pull requests",
              description: "Read pull requests.",
            },
          },
        },
        successful: true,
      }),
    },
  ],
};
const connector = {
  connectorId: "composio",
  presetId: "composio",
  name: "Composio",
  url: "https://connect.composio.dev/mcp",
  serverName: "composio_connector",
  authKind: "oauth",
  status: "connected",
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
} as const;
function fixture() {
  const forward = vi
    .fn<McpConnectorRuntime["forward"]>()
    .mockImplementation(async (_id, request) => ({
      status: 200,
      sessionId: "catalog-session",
      body: {
        kind: "json",
        value: {
          jsonrpc: "2.0",
          id: 1,
          result:
            (request.body as { method?: string })?.method === "initialize"
              ? { protocolVersion: "2025-06-18" }
              : result,
        },
      },
    }));
  return { list: (): ReturnType<McpConnectorRuntime["list"]> => [connector], forward };
}
describe("Composio catalog search", () => {
  it("normalizes tool metadata and deduplicates discovered slugs", () => {
    expect(parseComposioSearch(result)).toEqual({
      tools: [
        {
          slug: "GITHUB_LIST_PULL_REQUESTS",
          name: "List pull requests",
          description: "Read pull requests.",
        },
      ],
    });
  });
  it("rejects upstream failures and unknown shapes rather than reporting empty success", () => {
    expect(() => parseComposioSearch({ isError: true, content: [] })).toThrow();
    expect(() =>
      parseComposioSearch({
        structuredContent: { successful: false, error: "private upstream details" },
      }),
    ).toThrow("could not complete");
    expect(() => parseComposioSearch({ content: [{ type: "text", text: "unexpected" }] })).toThrow(
      "unsupported",
    );
    expect(parseComposioSearch({ structuredContent: { data: { results: [] } } })).toEqual({
      tools: [],
    });
  });
  it("uses only read-only search, carries the session, and closes it", async () => {
    const runtime = fixture();
    const response = await searchComposioTools(
      runtime,
      { connectorId: "composio", query: "GitHub pull requests" },
      new AbortController().signal,
    );
    expect(response.tools).toHaveLength(1);
    expect(
      runtime.forward.mock.calls.map(
        ([, request]) => (request.body as { method?: string })?.method ?? request.method,
      ),
    ).toEqual(["initialize", "notifications/initialized", "tools/call", "DELETE"]);
    expect(runtime.forward.mock.calls[2]?.[1]).toMatchObject({
      sessionId: "catalog-session",
      body: {
        params: {
          name: "COMPOSIO_SEARCH_TOOLS",
          arguments: {
            queries: [{ use_case: "GitHub pull requests" }],
            session: { generate_id: true },
            search_strategy: "tool_search",
          },
        },
      },
    });
  });
  it("refuses disconnected, lookalike and local connectors before sending a request", async () => {
    for (const change of [
      { status: "needs-auth" as const },
      { url: "https://connect.composio.dev.evil.test/mcp" },
      { url: "http://127.0.0.1/mcp" },
    ]) {
      const runtime = fixture();
      runtime.list = () => [{ ...connector, ...change }] as ReturnType<McpConnectorRuntime["list"]>;
      await expect(
        searchComposioTools(
          runtime,
          { connectorId: "composio", query: "GitHub" },
          new AbortController().signal,
        ),
      ).rejects.toThrow("Connect Composio");
      expect(runtime.forward).not.toHaveBeenCalled();
    }
  });
  it("cleans up an initialized session after search failure", async () => {
    const runtime = fixture();
    runtime.forward.mockImplementationOnce(async () => ({
      status: 200,
      sessionId: "catalog-session",
      body: { kind: "json", value: { result: { protocolVersion: "2025-06-18" } } },
    }));
    runtime.forward.mockImplementationOnce(async () => ({
      status: 202,
      sessionId: null,
      body: { kind: "empty" },
    }));
    runtime.forward.mockImplementationOnce(async () => ({
      status: 401,
      sessionId: null,
      body: { kind: "empty" },
    }));
    await expect(
      searchComposioTools(
        runtime,
        { connectorId: "composio", query: "GitHub" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("unavailable");
    expect(runtime.forward.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "DELETE",
      sessionId: "catalog-session",
    });
  });
});
