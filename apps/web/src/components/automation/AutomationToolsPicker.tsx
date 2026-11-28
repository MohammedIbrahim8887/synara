// FILE: AutomationToolsPicker.tsx
// Purpose: Picks the connected tools (Connectors) an automation tells every run to use.
// Layer: Web components (automation)
// Exports: AutomationToolsPicker, automationToolRows
// Used by: the new-automation dialog's chip row and the automation detail page.

import { LinkedTool, type McpConnector } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

import { MCP_CONNECTORS_ON } from "~/betaFeatures";
import { ConnectorIcon } from "~/components/ConnectorIcon";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { useTranslation } from "~/i18n";
import { CentralIcon } from "~/lib/central-icons";
import { mcpConnectorsQueryOptions } from "~/lib/mcpConnectorsReactQuery";

/** Matches the `LinkedTools` contract bound. */
const MAX_LINKED_TOOLS = 20;
/** Linked tool icons shown on the trigger before the count takes over. */
const MAX_TRIGGER_ICONS = 3;
const LINKED_TOOL_NAME_MAX_LENGTH = 60;

const isLinkedTool = Schema.is(LinkedTool);

export type AutomationToolRow = {
  readonly serverName: string;
  readonly name: string;
  readonly url: string | undefined;
  readonly linked: boolean;
  readonly connected: boolean;
};

/**
 * Connected tools first, in Settings order, then tools still linked whose connector is gone
 * or signed out, so they can be unlinked.
 */
export function automationToolRows(
  connectors: readonly McpConnector[],
  linkedTools: readonly LinkedTool[],
): AutomationToolRow[] {
  const linked = new Set(linkedTools.map((tool) => tool.serverName));
  const rows: AutomationToolRow[] = [];
  const seen = new Set<string>();
  for (const connector of connectors) {
    if (connector.status !== "connected" || seen.has(connector.serverName)) continue;
    const tool = { serverName: connector.serverName, name: linkedToolName(connector.name) };
    // A server name the run contract would reject cannot be linked.
    if (!isLinkedTool(tool)) continue;
    seen.add(tool.serverName);
    rows.push({
      ...tool,
      url: connector.transport === "stdio" ? undefined : connector.url,
      linked: linked.has(tool.serverName),
      connected: true,
    });
  }
  for (const tool of linkedTools) {
    if (seen.has(tool.serverName)) continue;
    seen.add(tool.serverName);
    rows.push({ ...tool, url: undefined, linked: true, connected: false });
  }
  return rows;
}

function linkedToolName(name: string): string {
  return name.trim().slice(0, LINKED_TOOL_NAME_MAX_LENGTH) || name;
}

export function AutomationToolsPicker({
  value,
  onChange,
  disabled,
  title,
  triggerClassName,
  align,
}: {
  readonly value: readonly LinkedTool[];
  readonly onChange: (value: LinkedTool[]) => void;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  readonly triggerClassName?: string | undefined;
  readonly align?: "start" | "end" | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // A refused list (Connectors off, or an older host) reads as "nothing connected".
  const connectorsQuery = useQuery({
    ...mcpConnectorsQueryOptions(),
    enabled: MCP_CONNECTORS_ON,
  });
  if (!MCP_CONNECTORS_ON) return null;

  const rows = automationToolRows(connectorsQuery.data ?? [], value);
  const connectedCount = rows.filter((row) => row.connected).length;
  const atLimit = value.length >= MAX_LINKED_TOOLS;
  const toggle = (row: AutomationToolRow, checked: boolean) => {
    const rest = value.filter((tool) => tool.serverName !== row.serverName);
    onChange(checked ? [...rest, { serverName: row.serverName, name: row.name }] : rest);
  };
  const urlByServerName = new Map(rows.map((row) => [row.serverName, row.url]));

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            title={title}
            aria-label={
              value.length === 0
                ? t("automation:tools_label")
                : t("automation:tools_labelWithCount", { count: value.length })
            }
            className={triggerClassName}
          />
        }
      >
        {value.length === 0 ? (
          <>
            <CentralIcon name="connectors-1" className="size-4" />
            <span>{t("automation:tools_label")}</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-0.5">
              {value.slice(0, MAX_TRIGGER_ICONS).map((tool) => (
                <ConnectorIcon
                  key={tool.serverName}
                  name={tool.name}
                  url={urlByServerName.get(tool.serverName)}
                  className="size-4"
                />
              ))}
            </span>
            <span className="tabular-nums">{value.length}</span>
          </>
        )}
        <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align={align ?? "start"} className="w-60">
        <MenuGroup>
          <MenuGroupLabel>{t("automation:tools_menuLabel")}</MenuGroupLabel>
          {connectedCount === 0 ? (
            <p className="px-2 py-1.5 text-ui-sm leading-snug text-muted-foreground">
              {t("automation:tools_empty")}
            </p>
          ) : null}
          {rows.map((row) => (
            <MenuCheckboxItem
              key={row.serverName}
              variant="checkbox"
              checked={row.linked}
              disabled={!row.linked && atLimit}
              onCheckedChange={(checked) => toggle(row, checked)}
            >
              <ConnectorIcon name={row.name} url={row.url} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              {row.connected ? null : (
                <span className="shrink-0 text-ui-xs text-muted-foreground">
                  {t("automation:tools_notConnected")}
                </span>
              )}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          onClick={() => void navigate({ to: "/settings", search: { section: "connectors" } })}
        >
          <CentralIcon name="plus-small" className="size-4" />
          {t("automation:tools_connectMore")}
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
