// FILE: FlowEditor.tsx
// Purpose: Edit one rule or workflow: its name/scope/on-off header, the written rule, and the
//          diagram (step palette, canvas, and the selected step's settings).
// Layer: Web flows editor
// Exports: FlowEditor

import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { FlowDefinition, FlowNode, FlowNodeKind, McpConnector } from "@synara/contracts";
import { flowNodeIssue } from "@synara/shared/flows";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { ConnectorIcon } from "~/components/ConnectorIcon";
import { SegmentedPicker } from "~/components/SegmentedPicker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useTranslation } from "~/i18n";
import { projectModelSelection } from "~/lib/automationForm";
import { CentralIcon } from "~/lib/central-icons";
import { EllipsisIcon } from "~/lib/icons";
import { cn, randomUUID as newId } from "~/lib/utils";
import { AutomationModelPicker } from "~/routes/-automations.shared";
import { useStore } from "~/store";

import { FLOW_STEP_GROUPS, FLOW_STEP_KINDS, newFlowStep, stepKindsFor } from "./flowCatalog";
import {
  type CanvasNode,
  FLOW_ISSUE_KEYS,
  FLOW_NODE_TYPES,
  FlowCanvasContext,
  FlowStepIcon,
  START_NODE_ID,
  type StartCanvasNode,
  type StepCanvasNode,
} from "./FlowNodeCard";

const DRAG_TYPE = "application/x-sona-flow-step";
const COLUMN = 300;
const ROW = 130;
const ALL_PROJECTS = "all";

type Tool = NonNullable<FlowNode["tool"]>;
type Branch = "yes" | "no";
type CanvasEdge = Edge<{ branch?: Branch }>;

const isStep = (node: CanvasNode): node is StepCanvasNode => node.type === "step";

function stepNode(step: FlowNode, selected = false): StepCanvasNode {
  return { id: step.id, type: "step", position: step.position, data: { step }, selected };
}

// The start marker sits to the left of the leftmost step and is never saved.
function startNode(steps: readonly { position: FlowNode["position"] }[]): StartCanvasNode {
  const first = steps.reduce<FlowNode["position"] | null>(
    (best, step) => (!best || step.position.x < best.x ? step.position : best),
    null,
  );
  return {
    id: START_NODE_ID,
    type: "start",
    position: first ? { x: first.x - 270, y: first.y } : { x: 0, y: 0 },
    data: {},
    draggable: false,
    selectable: false,
    deletable: false,
  };
}

function connectedTools(connectors: readonly McpConnector[] | undefined): Tool[] {
  return (connectors ?? [])
    .filter((connector) => connector.status === "connected")
    .map((connector) => ({ serverName: connector.serverName, name: connector.name.slice(0, 60) }));
}

export function FlowEditor({
  flow,
  flows,
  connectors,
  onChange,
  onDelete,
  onEditJson,
  overview,
}: {
  flow: FlowDefinition;
  flows: readonly FlowDefinition[];
  connectors: readonly McpConnector[] | undefined;
  onChange: (flow: FlowDefinition) => void;
  onDelete: () => void;
  onEditJson: () => void;
  /** Shown beside the canvas while no step is selected. */
  overview: ReactNode;
}) {
  const { t } = useTranslation();
  const projects = useStore((state) => state.projects);
  const rule = flow.kind === "rule";
  // A rule opens on whichever form it already uses; a new one starts as text.
  const [view, setView] = useState<"write" | "draw">(
    rule && (flow.text?.trim() || flow.nodes.length === 0) ? "write" : "draw",
  );
  const scopeName =
    projects.find((project) => project.id === flow.projectId)?.name ??
    t("automation:flows_allProjects");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.07]"
        >
          <CentralIcon name={rule ? "shield-check" : "agents"} className="size-4" />
        </span>
        <div className="min-w-40 flex-1">
          <input
            value={flow.name}
            maxLength={160}
            onChange={(event) => onChange({ ...flow, name: event.target.value })}
            aria-label={t("automation:flows_name")}
            placeholder={t("automation:flows_name")}
            className="w-full bg-transparent font-system-ui text-ui-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <p className="truncate text-ui-sm text-muted-foreground">
            {t(rule ? "automation:flows_ruleTagline" : "automation:flows_workflowTagline")}
          </p>
        </div>
        {rule ? (
          <SegmentedPicker
            ariaLabel={t("automation:flows_viewLabel")}
            className="w-44"
            value={view}
            onValueChange={setView}
            options={[
              { value: "write", label: t("automation:flows_write") },
              { value: "draw", label: t("automation:flows_draw") },
            ]}
          />
        ) : null}
        <Select
          value={flow.projectId || ALL_PROJECTS}
          onValueChange={(value) => {
            if (value !== null)
              onChange({ ...flow, projectId: value === ALL_PROJECTS ? "" : value });
          }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label={t("automation:flows_scope")}>
            <SelectValue>{scopeName}</SelectValue>
          </SelectTrigger>
          <SelectPopup surface="settings">
            <SelectItem value={ALL_PROJECTS}>{t("automation:flows_allProjects")}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <label className="flex items-center gap-2 text-ui">
          <Switch
            checked={flow.enabled}
            onCheckedChange={(enabled) => onChange({ ...flow, enabled })}
            aria-label={t("automation:flows_enabled")}
          />
          {t(flow.enabled ? "automation:flows_on" : "automation:flows_off")}
        </label>
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t("automation:flows_more")} />
            }
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <ComposerPickerMenuPopup align="end" className="w-44">
            <MenuItem onClick={onEditJson}>{t("automation:flows_json")}</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={onDelete}>
              {t("automation:flows_delete")}
            </MenuItem>
          </ComposerPickerMenuPopup>
        </Menu>
      </div>
      {view === "write" ? (
        <WrittenRule flow={flow} scopeName={scopeName} onChange={onChange} onDraw={setView} />
      ) : (
        <ReactFlowProvider>
          <FlowCanvas
            flow={flow}
            flows={flows}
            connectors={connectors}
            onChange={onChange}
            overview={overview}
          />
        </ReactFlowProvider>
      )}
    </div>
  );
}

const WRITTEN_EXAMPLES = [
  "automation:flows_example1",
  "automation:flows_example2",
  "automation:flows_example3",
] as const;

function WrittenRule({
  flow,
  scopeName,
  onChange,
  onDraw,
}: {
  flow: FlowDefinition;
  scopeName: string;
  onChange: (flow: FlowDefinition) => void;
  onDraw: (view: "draw") => void;
}) {
  const { t } = useTranslation();
  const text = flow.text ?? "";
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-6 py-8">
        <label className="flex flex-col gap-2">
          <span className="text-ui-lg font-medium">{t("automation:flows_writeTitle")}</span>
          <span className="text-ui text-muted-foreground">
            {t("automation:flows_writeHint", { scope: scopeName })}
          </span>
          <Textarea
            className="min-h-64"
            maxLength={8000}
            value={text}
            placeholder={t("automation:flows_writePlaceholder")}
            onChange={(event) => onChange({ ...flow, text: event.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ui-sm text-muted-foreground">{t("automation:flows_examples")}</span>
          {WRITTEN_EXAMPLES.map((key) => (
            <Button
              key={key}
              size="xs"
              variant="outline"
              shape="capsule"
              onClick={() =>
                onChange({ ...flow, text: [text.trimEnd(), t(key)].filter(Boolean).join("\n") })
              }
            >
              {t(key)}
            </Button>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-border bg-foreground/[0.03] p-3 text-ui text-muted-foreground">
          <CentralIcon name="shield-check" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{t("automation:flows_writeEnforce")}</p>
            {flow.nodes.length > 0 ? (
              <p className="mt-1 text-foreground">
                {t("automation:flows_writeAlsoDrawn", { count: flow.nodes.length })}
              </p>
            ) : null}
          </div>
          <Button size="xs" variant="outline" onClick={() => onDraw("draw")}>
            {t("automation:flows_openDraw")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FlowCanvas({
  flow,
  flows,
  connectors,
  onChange,
  overview,
}: {
  flow: FlowDefinition;
  flows: readonly FlowDefinition[];
  connectors: readonly McpConnector[] | undefined;
  onChange: (flow: FlowDefinition) => void;
  overview: ReactNode;
}) {
  const { t } = useTranslation();
  const projects = useStore((state) => state.projects);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes] = useState<CanvasNode[]>(() => [
    startNode(flow.nodes),
    ...flow.nodes.map((step) => stepNode(step)),
  ]);
  const [edges, setEdges] = useState<CanvasEdge[]>(() =>
    flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.branch ?? null,
      data: edge.branch ? { branch: edge.branch } : {},
    })),
  );
  const steps = nodes.filter(isStep);
  // Discard/reload can replace a graph without changing the selected flow ID.
  // Ignore our own commits so selection and measured geometry survive ordinary edits.
  const graph = useRef({ nodes: flow.nodes, edges: flow.edges });
  useEffect(() => {
    if (graph.current.nodes === flow.nodes && graph.current.edges === flow.edges) return;
    graph.current = { nodes: flow.nodes, edges: flow.edges };
    setNodes([startNode(flow.nodes), ...flow.nodes.map((step) => stepNode(step))]);
    setEdges(
      flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.branch ?? null,
        data: edge.branch ? { branch: edge.branch } : {},
      })),
    );
  }, [flow.nodes, flow.edges]);
  const selected = steps.find((node) => node.selected);
  const tools = useMemo(() => connectedTools(connectors), [connectors]);
  const context = useMemo(() => ({ flow, flows, connectors }), [flow, flows, connectors]);
  // A step added from the palette may land outside the view; refit once it has been measured.
  const refit = useRef(false);
  useEffect(() => {
    if (!refit.current || nodes.some((node) => !node.measured)) return;
    refit.current = false;
    void fitView({ maxZoom: 1, padding: 0.2, duration: 200 });
  }, [nodes, fitView]);

  const commit = (nextSteps: StepCanvasNode[], nextEdges: CanvasEdge[] = edges) => {
    setNodes([startNode(nextSteps), ...nextSteps]);
    setEdges(nextEdges);
    const next = {
      ...flow,
      nodes: nextSteps.map((node) => ({ ...node.data.step, position: node.position })),
      edges: nextEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.data?.branch ? { branch: edge.data.branch } : {}),
      })),
    };
    graph.current = { nodes: next.nodes, edges: next.edges };
    onChange(next);
  };

  // Steps with nothing before them start the flow; the dashed lines say so without being saved.
  const drawnEdges = useMemo<CanvasEdge[]>(() => {
    const targets = new Set(edges.map((edge) => edge.target));
    const start = steps
      .filter((node) => !targets.has(node.id))
      .map<CanvasEdge>((node) => ({
        id: `${START_NODE_ID}:${node.id}`,
        source: START_NODE_ID,
        target: node.id,
        selectable: false,
        deletable: false,
        focusable: false,
        style: { strokeDasharray: "4 4", opacity: 0.6 },
      }));
    const real = edges.map<CanvasEdge>((edge) => ({
      ...edge,
      markerEnd: { type: MarkerType.ArrowClosed },
      ...(edge.data?.branch
        ? {
            label: t(edge.data.branch === "yes" ? "automation:flows_yes" : "automation:flows_no"),
          }
        : {}),
    }));
    return [...start, ...real];
    // `steps` is rebuilt every render; its identity follows `nodes`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, t]);

  function addStep(kind: FlowNodeKind, tool?: Tool, at?: FlowNode["position"]) {
    if (steps.length >= 64) return;
    const anchor = at ? undefined : selected;
    const siblings = anchor ? edges.filter((edge) => edge.source === anchor.id) : [];
    const last = steps.reduce<StepCanvasNode | undefined>(
      (best, node) => (!best || node.position.x > best.position.x ? node : best),
      undefined,
    );
    const position =
      at ??
      (anchor
        ? { x: anchor.position.x + COLUMN, y: anchor.position.y + siblings.length * ROW }
        : last
          ? { x: last.position.x, y: last.position.y + ROW }
          : { x: 0, y: 0 });
    const step = newFlowStep(kind, tool?.name ?? t(FLOW_STEP_KINDS[kind].label), position, {
      ...(tool ? { tool } : {}),
      ...(kind === "model"
        ? { model: projectModelSelection(projects, flow.projectId || (projects[0]?.id ?? "")) }
        : {}),
    });
    // Adding from a selected step continues from it; a decision fills "yes" first, then "no".
    const branch: Branch | undefined =
      anchor?.data.step.kind === "condition"
        ? siblings.some((edge) => edge.data?.branch === "yes")
          ? "no"
          : "yes"
        : undefined;
    commit(
      [...steps.map((node) => ({ ...node, selected: false })), stepNode(step, true)],
      anchor
        ? [
            ...edges,
            {
              id: newId(),
              source: anchor.id,
              target: step.id,
              sourceHandle: branch ?? null,
              data: branch ? { branch } : {},
            },
          ]
        : edges,
    );
    refit.current = !at;
  }

  function updateStep(patch: Partial<FlowNode>) {
    commit(
      steps.map((node) =>
        node.id === selected?.id
          ? { ...node, data: { step: { ...node.data.step, ...patch } } }
          : node,
      ),
    );
  }

  function removeStep(id: string) {
    commit(
      steps.filter((node) => node.id !== id),
      edges.filter((edge) => edge.source !== id && edge.target !== id),
    );
  }

  function reaches(from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return edges.some((edge) => edge.source === from && reaches(edge.target, to, seen));
  }

  function onDrop(event: DragEvent) {
    const payload = event.dataTransfer.getData(DRAG_TYPE);
    if (!payload) return;
    event.preventDefault();
    const { kind, tool } = JSON.parse(payload) as { kind: FlowNodeKind; tool?: Tool };
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addStep(kind, tool, { x: point.x - 120, y: point.y - 30 });
  }

  return (
    <FlowCanvasContext.Provider value={context}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Palette tools={tools} toolsLoaded={connectors !== undefined} onAdd={addStep} />
        <div
          className="sona-flow-canvas relative min-h-96 min-w-0 flex-1"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
          }}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={drawnEdges}
            nodeTypes={FLOW_NODE_TYPES}
            onNodesChange={(changes) => setNodes(changes.applyTo(nodes))}
            onEdgesChange={(changes) =>
              setEdges(changes.applyTo(drawnEdges).filter((edge) => edge.source !== START_NODE_ID))
            }
            onNodeDragStop={(_, _node, dragged) => {
              const moved = new Map(dragged.map((node) => [node.id, node.position]));
              commit(
                steps.map((node) =>
                  moved.has(node.id) ? { ...node, position: moved.get(node.id)! } : node,
                ),
              );
            }}
            isValidConnection={(connection) =>
              connection.target !== START_NODE_ID &&
              connection.source !== START_NODE_ID &&
              !edges.some(
                (edge) => edge.source === connection.source && edge.target === connection.target,
              ) &&
              !reaches(connection.target, connection.source)
            }
            onConnect={(connection) => {
              const source = steps.find((node) => node.id === connection.source);
              const branch: Branch | undefined =
                source?.data.step.kind === "condition"
                  ? connection.sourceHandle === "no"
                    ? "no"
                    : "yes"
                  : undefined;
              commit(steps, [
                ...edges,
                {
                  id: newId(),
                  source: connection.source,
                  target: connection.target,
                  sourceHandle: branch ?? null,
                  data: branch ? { branch } : {},
                },
              ]);
            }}
            onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
              const gone = new Set(removedNodes.map((node) => node.id));
              const cut = new Set(removedEdges.map((edge) => edge.id));
              commit(
                steps.filter((node) => !gone.has(node.id)),
                edges.filter(
                  (edge) => !gone.has(edge.source) && !gone.has(edge.target) && !cut.has(edge.id),
                ),
              );
            }}
            minZoom={0.2}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {steps.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center px-6">
              <p className="rounded-full border border-border bg-[var(--color-background-elevated-primary-opaque)] px-3 py-1.5 text-ui text-muted-foreground shadow-sm">
                {t("automation:flows_canvasEmpty")}
              </p>
            </div>
          ) : null}
        </div>
        <aside className="w-full shrink-0 overflow-auto border-t border-border lg:w-64 lg:border-t-0 lg:border-l">
          {selected ? (
            <StepSettings
              key={selected.id}
              step={selected.data.step}
              flow={flow}
              flows={flows}
              tools={tools}
              onChange={updateStep}
              onRemove={() => removeStep(selected.id)}
            />
          ) : (
            overview
          )}
        </aside>
      </div>
    </FlowCanvasContext.Provider>
  );
}

function PaletteItem({
  icon,
  label,
  hint,
  payload,
  onAdd,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  payload: { kind: FlowNodeKind; tool?: Tool };
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      title={hint}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      className="flex w-full cursor-grab items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left text-ui outline-none transition-colors hover:border-border hover:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <CentralIcon name="plus-small" className="size-3.5 text-muted-foreground" />
    </button>
  );
}

function Palette({
  tools,
  toolsLoaded,
  onAdd,
}: {
  tools: readonly Tool[];
  toolsLoaded: boolean;
  onAdd: (kind: FlowNodeKind, tool?: Tool) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <aside
      aria-label={t("automation:flows_palette")}
      className="flex w-full shrink-0 flex-col gap-4 overflow-auto border-b border-border p-3 lg:w-44 lg:border-r lg:border-b-0"
    >
      {FLOW_STEP_GROUPS.map((group) => (
        <section key={group.id} className="flex flex-col gap-0.5">
          <h3 className="px-1.5 text-ui-sm font-medium text-foreground">{t(group.label)}</h3>
          <p className="px-1.5 pb-1 text-ui-xs leading-snug text-muted-foreground">
            {t(group.hint)}
          </p>
          {stepKindsFor(group.id).map((meta) => (
            <PaletteItem
              key={meta.kind}
              label={t(meta.label)}
              hint={t(meta.hint)}
              payload={{ kind: meta.kind }}
              onAdd={() => onAdd(meta.kind)}
              icon={
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    meta.tone,
                  )}
                >
                  <CentralIcon name={meta.icon} className="size-3.5" />
                </span>
              }
            />
          ))}
        </section>
      ))}
      <section className="flex flex-col gap-0.5">
        <h3 className="px-1.5 text-ui-sm font-medium text-foreground">
          {t("automation:flows_groupTools")}
        </h3>
        <p className="px-1.5 pb-1 text-ui-xs leading-snug text-muted-foreground">
          {t(
            tools.length || !toolsLoaded
              ? "automation:flows_groupToolsHint"
              : "automation:flows_noTools",
          )}
        </p>
        {tools.map((tool) => (
          <PaletteItem
            key={tool.serverName}
            label={tool.name}
            payload={{ kind: "tool", tool }}
            onAdd={() => onAdd("tool", tool)}
            icon={
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05]"
              >
                <ConnectorIcon name={tool.name} className="size-3.5" />
              </span>
            }
          />
        ))}
        <Button
          size="xs"
          variant="ghost"
          className="mt-1 justify-start text-muted-foreground"
          onClick={() => void navigate({ to: "/settings", search: { section: "connectors" } })}
        >
          <CentralIcon name="plus-small" className="size-3.5" />
          {t("automation:flows_connectTools")}
        </Button>
      </section>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-ui">
      <span className="text-ui-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function StepSettings({
  step,
  flow,
  flows,
  tools,
  onChange,
  onRemove,
}: {
  step: FlowNode;
  flow: FlowDefinition;
  flows: readonly FlowDefinition[];
  tools: readonly Tool[];
  onChange: (patch: Partial<FlowNode>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const projects = useStore((state) => state.projects);
  const meta = FLOW_STEP_KINDS[step.kind];
  const issue = flowNodeIssue(step);
  const project = projects.find((entry) => entry.id === flow.projectId) ?? projects[0];
  // A tool that was disconnected stays listed so the step still shows what it referred to.
  const toolOptions =
    step.tool && !tools.some((tool) => tool.serverName === step.tool?.serverName)
      ? [...tools, step.tool]
      : tools;
  const workflows = flows.filter((entry) => entry.kind === "workflow" && entry.id !== flow.id);
  const text = (label: string, placeholder: string) => (
    <Field label={label}>
      <Textarea
        className="min-h-28"
        maxLength={8000}
        value={step.value}
        placeholder={placeholder}
        onChange={(event) => onChange({ value: event.target.value })}
      />
    </Field>
  );
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-start gap-2.5">
        <FlowStepIcon step={step} />
        <div className="min-w-0">
          <p className="text-ui font-medium">{t(meta.label)}</p>
          <p className="text-ui-sm leading-snug text-muted-foreground">{t(meta.hint)}</p>
        </div>
      </div>
      <Field label={t("automation:flows_stepName")}>
        <Input
          value={step.label}
          maxLength={160}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </Field>
      {step.kind === "tool" ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-ui-sm text-muted-foreground">
              {t("automation:flows_toolPick")}
            </span>
            {toolOptions.length ? (
              <div
                role="radiogroup"
                aria-label={t("automation:flows_toolPick")}
                className="flex flex-col gap-1"
              >
                {toolOptions.map((tool) => {
                  const active = tool.serverName === step.tool?.serverName;
                  return (
                    <button
                      key={tool.serverName}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onChange({ tool })}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-ui outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                        active
                          ? "border-[color:var(--color-text-accent)] bg-[color:var(--color-text-accent)]/8"
                          : "border-border hover:bg-foreground/[0.04]",
                      )}
                    >
                      <ConnectorIcon name={tool.name} className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                      {tools.includes(tool) ? null : (
                        <span className="text-ui-xs text-warning">
                          {t("automation:flows_toolDisconnected")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-2.5 text-ui-sm text-muted-foreground">
                {t("automation:flows_noTools")}
              </p>
            )}
          </div>
          {text(t("automation:flows_toolTask"), t("automation:flows_toolTaskPlaceholder"))}
        </>
      ) : step.kind === "model" ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-ui-sm text-muted-foreground">
              {t("automation:flows_modelPick")}
            </span>
            <div className="rounded-lg border border-border p-1">
              <AutomationModelPicker
                value={step.model ?? projectModelSelection(projects, project?.id ?? "")}
                projectCwd={project?.cwd ?? null}
                onChange={(model) => onChange({ model })}
              />
            </div>
          </div>
          {text(t("automation:flows_modelTask"), t("automation:flows_modelTaskPlaceholder"))}
        </>
      ) : step.kind === "condition" ? (
        text(t("automation:flows_conditionTask"), t("automation:flows_conditionPlaceholder"))
      ) : step.kind === "workflow" ? (
        <Field label={t("automation:flows_workflow")}>
          <Select
            value={step.value || null}
            onValueChange={(value) => {
              if (value !== null) onChange({ value });
            }}
          >
            <SelectTrigger size="sm" aria-label={t("automation:flows_workflow")}>
              <SelectValue>
                {workflows.find((entry) => entry.id === step.value)?.name ??
                  t("automation:flows_selectWorkflow")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup surface="settings">
              {workflows.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      ) : step.kind === "branch-prefix" ? (
        <Field label={t("automation:flows_prefix")}>
          <Input
            value={step.value}
            placeholder="feature/"
            onChange={(event) => onChange({ value: event.target.value })}
          />
        </Field>
      ) : step.kind === "instruction" ? (
        text(t("automation:flows_instructions"), t("automation:flows_instructionPlaceholder"))
      ) : null}
      {issue ? (
        <p className="flex items-center gap-1.5 text-ui-sm text-warning">
          <CentralIcon name="warning-sign" className="size-3.5" />
          {t(FLOW_ISSUE_KEYS[issue])}
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 rounded-lg bg-foreground/[0.04] p-2 text-ui-xs leading-snug text-muted-foreground">
        <CentralIcon
          name={meta.group === "checks" ? "lock" : "info-simple"}
          className="mt-px size-3.5 shrink-0"
        />
        {t(meta.group === "checks" ? "automation:flows_gateHint" : "automation:flows_agentHint")}
      </p>
      <Button size="sm" variant="ghost" className="self-start" onClick={onRemove}>
        <CentralIcon name="trash-can-simple" className="size-3.5" />
        {t("automation:flows_removeStep")}
      </Button>
    </div>
  );
}
