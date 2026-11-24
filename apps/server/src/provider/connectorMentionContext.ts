/**
 * `@` mentions of Connectors never reach providers as native mentions:
 * Codex would treat `connector://` as a plugin path and Droid as a local path.
 * They become one context block naming the MCP server to use instead. An
 * automation's linked tools reuse the same block, worded for a run.
 *
 * @module provider/connectorMentionContext
 */
import type { ProviderMentionReference } from "@synara/contracts";
import {
  isMcpConnectorMentionPath,
  serverNameFromMcpConnectorMentionPath,
} from "@synara/shared/mcpConnectors";

const MAX_CONNECTOR_MENTIONS = 20;
const MAX_CONNECTOR_NAME_CHARS = 60;

export interface ConnectorMentionProjection {
  /** Every mention that is not a connector, for the thread/provider projection. */
  readonly otherMentions: ReadonlyArray<ProviderMentionReference> | undefined;
  /** Zero or one `<mentioned_connectors>` (or, for automations, `<linked_connectors>`) block. */
  readonly contextBlocks: readonly string[];
}

// Display names come from the user (custom URLs); keep them on one line and
// out of the tag syntax around them.
function sanitizeConnectorName(name: string): string {
  return name
    .replace(/[\r\n<>]+/gu, " ")
    .trim()
    .slice(0, MAX_CONNECTOR_NAME_CHARS);
}

/**
 * Who referenced the connectors: the user, with `@` mentions in a message, or an
 * automation, whose linked tools every run receives as synthesized mentions.
 */
export type ConnectorContextSource = "mention" | "automation";

const CONNECTOR_CONTEXT_WORDING: Record<
  ConnectorContextSource,
  { readonly tag: string; readonly lead: string; readonly unavailable: string }
> = {
  mention: {
    tag: "mentioned_connectors",
    lead: "The user mentioned these connected services. Use the tools of the matching MCP server:",
    // Grants are fixed when the session starts, and some agents get no
    // connectors at all, so the server may be missing from this session.
    unavailable:
      "If a server is not available in this session, do not guess its results: tell the user to start a new chat, or to reconnect it in Settings → Connectors.",
  },
  automation: {
    tag: "linked_connectors",
    lead: "This automation is linked to these connected services. Use the tools of the matching MCP server for this run:",
    unavailable:
      "If a server is not available in this session, do not guess its results: say so in the automation result and tell the user to reconnect it in Settings → Connectors.",
  },
};

export function projectConnectorMentions(input: {
  readonly mentions: ReadonlyArray<ProviderMentionReference> | undefined;
  /** When connectors are disabled, their mentions are dropped without a block. */
  readonly enabled: boolean;
  /** Defaults to `mention`. */
  readonly source?: ConnectorContextSource;
}): ConnectorMentionProjection {
  const wording = CONNECTOR_CONTEXT_WORDING[input.source ?? "mention"];
  const mentions = input.mentions ?? [];
  const otherMentions = mentions.filter((mention) => !isMcpConnectorMentionPath(mention.path));
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    const serverName = serverNameFromMcpConnectorMentionPath(mention.path);
    if (!serverName || seen.has(serverName) || seen.size >= MAX_CONNECTOR_MENTIONS) continue;
    seen.add(serverName);
    lines.push(`- @${sanitizeConnectorName(mention.name)}: MCP server "${serverName}"`);
  }
  return {
    otherMentions: otherMentions.length > 0 ? otherMentions : undefined,
    contextBlocks:
      input.enabled && lines.length > 0
        ? [
            [
              `<${wording.tag}>`,
              wording.lead,
              ...lines,
              wording.unavailable,
              `</${wording.tag}>`,
            ].join("\n"),
          ]
        : [],
  };
}
