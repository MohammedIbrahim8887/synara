// FILE: FlowNodeCard.tsx
// Purpose: The cards drawn on the rules/workflows canvas: one per step, plus the start marker.
// Layer: Web flows editor
// Exports: FLOW_NODE_TYPES, FlowCanvasContext, FlowStepIcon, START_NODE_ID

import { createContext, useContext } from "react";
import type { FlowDefinition, FlowNode, McpConnector } from "@synara/contracts";
import { flowNodeIssue, type FlowNodeIssue } from "@synara/shared/flows";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { ConnectorIcon } from "~/components/ConnectorIcon";
import { ProviderIcon } from "~/components/ProviderIcon";
import { useTranslation } from "~/i18n";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";

import { FLOW_STEP_KINDS } from "./flowCatalog";

export const START_NODE_ID = "__start";

export type StepCanvasNode = Node<{ step: FlowNode }, "step">;
export type StartCanvasNode = Node<Record<string, never>, "start">;
export type CanvasNode = StepCanvasNode | StartCanvasNode;

export const FlowCanvasContext = createContext<{
  readonly flow: FlowDefinition;
  readonly flows: readonly FlowDefinition[];
  /** Undefined while loading or when tools are unavailable on this host. */
  readonly connectors: readonly McpConnector[] | undefined;
} | null>(null);

function useCanvas() {
  const value = useContext(FlowCanvasContext);
  if (!value) throw new Error("Flow nodes render inside the flow canvas.");
  return value;
}

export const FLOW_ISSUE_KEYS: Record<FlowNodeIssue, string> = {
  tool: "automation:flows_issueTool",
  model: "automation:flows_issueModel",
  workflow: "automation:flows_issueWorkflow",
  prefix: "automation:flows_issuePrefix",
  instruction: "automation:flows_issueInstruction",
};

const HANDLE_CLASS =
  "!size-2.5 !border-2 !border-[var(--background)] !bg-muted-foreground transition-colors hover:!bg-foreground";

/** The step's icon: the tool's or provider's own mark once chosen, else the step kind's glyph. */
export function FlowStepIcon({ step, className }: { step: FlowNode; className?: string }) {
  const meta = FLOW_STEP_KINDS[step.kind];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        meta.tone,
        className,
      )}
    >
      {step.kind === "tool" && step.tool ? (
        <ConnectorIcon name={step.tool.name} className="size-4" />
      ) : step.kind === "model" && step.model ? (
        <ProviderIcon provider={step.model.provider} className="size-4" />
      ) : (
        <CentralIcon name={meta.icon} className="size-4" />
      )}
    </span>
  );
}

function stepSummary(
  step: FlowNode,
  flows: readonly FlowDefinition[],
  t: (key: string) => string,
): string {
  switch (step.kind) {
    case "tool":
      return [step.tool?.name, step.value].filter(Boolean).join(" · ");
    case "model":
      return [step.model?.model, step.value].filter(Boolean).join(" · ");
    case "workflow":
      return flows.find((flow) => flow.id === step.value)?.name ?? "";
    case "branch-prefix":
      return step.value;
    case "require-worktree":
      return t("automation:flows_worktreeSummary");
    default:
      return step.value;
  }
}

function StepNode({ data, selected }: NodeProps<StepCanvasNode>) {
  const { t } = useTranslation();
  const { flows, connectors } = useCanvas();
  const { step } = data;
  const meta = FLOW_STEP_KINDS[step.kind];
  const issue = flowNodeIssue(step);
  const disconnected =
    step.kind === "tool" &&
    step.tool !== undefined &&
    connectors !== undefined &&
    !connectors.some(
      (connector) =>
        connector.serverName === step.tool?.serverName && connector.status === "connected",
    );
  const summary = stepSummary(step, flows, t);
  const decision = step.kind === "condition";
  return (
    <div
      className={cn(
        "w-60 rounded-xl border bg-[var(--color-background-elevated-primary-opaque)] text-left shadow-sm transition-[border-color,box-shadow]",
        selected
          ? "border-[color:var(--color-text-accent)] shadow-md ring-2 ring-[color:var(--color-text-accent)]/25"
          : "border-[color:var(--color-border)] hover:border-foreground/30",
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      <div className="flex items-start gap-2.5 p-2.5">
        <FlowStepIcon step={step} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-ui-xs text-muted-foreground">
            <span className="truncate">
              {t(meta.group === "checks" ? "automation:flows_check" : meta.label)}
            </span>
            {meta.group === "checks" ? (
              <CentralIcon
                name="lock"
                className="size-3"
                label={t("automation:flows_enforcedBadge")}
              />
            ) : null}
          </div>
          <div className="truncate text-ui font-medium text-foreground">
            {step.label || t(meta.label)}
          </div>
          {summary ? (
            <div className="line-clamp-2 text-ui-sm leading-snug text-muted-foreground">
              {summary}
            </div>
          ) : null}
        </div>
        {decision ? (
          <div className="flex flex-col justify-between self-stretch py-0.5 text-right text-ui-xs font-medium">
            <span className="text-success">{t("automation:flows_yes")}</span>
            <span className="text-muted-foreground">{t("automation:flows_no")}</span>
          </div>
        ) : null}
      </div>
      {issue || disconnected ? (
        <div className="flex items-center gap-1.5 rounded-b-xl border-t border-warning/20 bg-warning/8 px-2.5 py-1 text-ui-xs text-warning">
          <CentralIcon name="warning-sign" className="size-3" />
          {t(issue ? FLOW_ISSUE_KEYS[issue] : "automation:flows_toolDisconnected")}
        </div>
      ) : null}
      {decision ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            style={{ top: 22 }}
            className={cn(HANDLE_CLASS, "!bg-success")}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Right}
            style={{ top: 50 }}
            className={HANDLE_CLASS}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
      )}
    </div>
  );
}

function StartNode() {
  const { t } = useTranslation();
  const { flow } = useCanvas();
  const rule = flow.kind === "rule";
  return (
    <div className="w-52 rounded-xl border border-dashed border-foreground/25 bg-foreground/[0.03] p-2.5 text-left">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.07]"
        >
          <CentralIcon name={rule ? "shield-check" : "play"} className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-ui-xs text-muted-foreground">{t("automation:flows_startLabel")}</div>
          <div className="text-ui font-medium leading-snug text-foreground">
            {t(rule ? "automation:flows_startRule" : "automation:flows_startWorkflow")}
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-2 !border-0 !bg-foreground/30"
      />
    </div>
  );
}

export const FLOW_NODE_TYPES = { step: StepNode, start: StartNode };
