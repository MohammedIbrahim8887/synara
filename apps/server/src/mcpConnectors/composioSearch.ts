import type { ComposioSearchInput, ComposioSearchResult } from "@synara/contracts";
import { MCP_CONNECTOR_PROTOCOL_VERSION } from "./proxy.ts";
import { McpConnectorFailure, type McpConnectorRuntime } from "./runtime.ts";

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Meta-tool responses evolve independently of Sona. Keep only display fields. */
export function parseComposioSearch(result: unknown): ComposioSearchResult {
  const envelope = record(result);
  if (!envelope || envelope.isError === true)
    throw new McpConnectorFailure("Composio search failed. Try again or reconnect.");
  const payloads: unknown[] = [];
  if (envelope.structuredContent) payloads.push(envelope.structuredContent);
  if (Array.isArray(envelope.content)) {
    for (const block of envelope.content) {
      const item = record(block);
      if (item?.type === "text" && typeof item.text === "string") {
        try {
          payloads.push(JSON.parse(item.text));
        } catch {
          /* Unsupported prose is not a tool list. */
        }
      }
    }
  }
  const tools = new Map<string, ComposioSearchResult["tools"][number]>();
  let recognized = false;
  let visited = 0;
  const add = (slug: unknown, info?: Record<string, unknown>) => {
    if (typeof slug !== "string" || !/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(slug) || slug.length > 200)
      return;
    if (tools.size >= 100 && !tools.has(slug)) return;
    const previous = tools.get(slug);
    tools.set(slug, {
      slug,
      name:
        typeof info?.name === "string"
          ? info.name.slice(0, 200)
          : (previous?.name ?? slug.replaceAll("_", " ")),
      description:
        typeof info?.description === "string"
          ? info.description.slice(0, 2000)
          : (previous?.description ?? ""),
    });
  };
  const visit = (value: unknown, depth: number) => {
    if (depth > 10 || ++visited > 10000) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const item = record(value);
    if (!item) return;
    if (item.successful === false || (typeof item.error === "string" && item.error)) {
      throw new McpConnectorFailure(
        "Composio could not complete this search. Try a more specific query.",
      );
    }
    add(item.tool_slug ?? item.slug, item);
    for (const [key, child] of Object.entries(item)) {
      if (["primary_tool_slugs", "related_tool_slugs"].includes(key) && Array.isArray(child)) {
        recognized = true;
        child.forEach((slug) => add(slug));
      }
      if (
        (["tools", "results"].includes(key) && Array.isArray(child)) ||
        (key === "tool_schemas" && record(child))
      )
        recognized = true;
      if (key === "tool_schemas") {
        for (const [slug, schema] of Object.entries(record(child) ?? {})) add(slug, record(schema));
      }
      visit(child, depth + 1);
    }
  };
  for (const payload of payloads) visit(payload, 0);
  if (!recognized && tools.size === 0)
    throw new McpConnectorFailure(
      "Composio returned an unsupported search response. Please try again later.",
    );
  return { tools: [...tools.values()] };
}

/** Owner RPC only. No client-supplied upstream URL, tool name or arbitrary arguments. */
export async function searchComposioTools(
  runtime: Pick<McpConnectorRuntime, "list" | "forward">,
  input: ComposioSearchInput,
  signal: AbortSignal,
): Promise<ComposioSearchResult> {
  const connector = runtime.list().find((entry) => entry.connectorId === input.connectorId);
  if (
    !connector ||
    connector.transport === "stdio" ||
    connector.url !== "https://connect.composio.dev/mcp" ||
    connector.status !== "connected"
  ) {
    throw new McpConnectorFailure("Connect Composio before searching its tools.");
  }
  const query = input.query.trim();
  if (!query || query.length > 1000)
    throw new McpConnectorFailure("Enter a search of up to 1000 characters.");
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  let sessionId: string | undefined;
  let protocolVersion = MCP_CONNECTOR_PROTOCOL_VERSION;
  const post = async (body: unknown) => {
    const response = await runtime.forward(connector.connectorId, {
      method: "POST",
      body,
      sessionId,
      protocolVersion,
      signal: requestSignal,
    });
    if (response.sessionId) sessionId = response.sessionId;
    const message = response.body.kind === "json" ? record(response.body.value) : undefined;
    if (response.status >= 400 || message?.error)
      throw new McpConnectorFailure(
        "Composio search is unavailable. Reconnect if your sign-in has expired.",
      );
    return message?.result;
  };
  try {
    const initialized = record(
      await post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "Sona catalog", version: "1.0.0" },
        },
      }),
    );
    if (!initialized || typeof initialized.protocolVersion !== "string")
      throw new McpConnectorFailure("Could not initialize Composio search.");
    protocolVersion = initialized.protocolVersion;
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return parseComposioSearch(
      await post({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "COMPOSIO_SEARCH_TOOLS",
          arguments: {
            queries: [{ use_case: query }],
            session: { generate_id: true },
            search_strategy: "tool_search",
          },
        },
      }),
    );
  } finally {
    if (sessionId) {
      // Only close this catalog request's own MCP session, even when the caller cancels.
      await runtime
        .forward(connector.connectorId, {
          method: "DELETE",
          sessionId,
          protocolVersion,
          signal: AbortSignal.timeout(2_000),
        })
        .catch(() => {});
    }
  }
}
