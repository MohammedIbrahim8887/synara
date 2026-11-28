// FILE: FlowsView.tsx
// Purpose: The Rules & workflows page: the library of saved definitions, the welcome/templates
//          state, saving, AI drafting, and the "how it runs" overview beside the canvas.
// Layer: Web flows route view
// Exports: FlowsView

import { type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { FlowDefinition, FlowDefinitions, type McpConnector } from "@synara/contracts";
import { flowPromptSection, validateFlows, workflowInvocation } from "@synara/shared/flows";

import { resolveNewChatDefault, useAppSettings } from "~/appSettings";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { RouteSurface, RouteSurfaceHeader } from "~/components/RouteSurface";
import { Button } from "~/components/ui/button";
import { CopyTextButton } from "~/components/ui/copyTextButton";
import { Menu, MenuItem, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { resolvePreferredComposerModelSelection } from "~/composerDraftStore";
import { useTranslation } from "~/i18n";
import { formFromDefinition, projectModelSelection } from "~/lib/automationForm";
import { CentralIcon } from "~/lib/central-icons";
import { createDraftThread } from "~/lib/draftThreadCreate";
import { portableAutomationDraft } from "~/lib/hosts/automationWorkspace";
import { EllipsisIcon } from "~/lib/icons";
import { mcpConnectorsQueryOptions } from "~/lib/mcpConnectorsReactQuery";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { cn, randomUUID as newId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { AutomationCreateDialog } from "~/routes/-automations.list";
import { useAutomations } from "~/routes/-automations.shared";
import { useStore } from "~/store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "~/types";

import { FLOW_STEP_KINDS, FLOW_TEMPLATES, type FlowTemplate } from "./flowCatalog";
import { FlowEditor } from "./FlowEditor";

const NO_DRAG = "[-webkit-app-region:no-drag]";

export function FlowsView() {
  const query = useQuery(serverSettingsQueryOptions());
  const { t } = useTranslation();
  return (
    <RouteInsetSurface>
      <RouteSurface>
        {query.data ? (
          <FlowLibrary initial={query.data.flows} />
        ) : (
          <>
            <RouteSurfaceHeader>
              <h1 className="text-ui-lg font-medium">{t("automation:flows_title")}</h1>
            </RouteSurfaceHeader>
            {query.error ? (
              <div className="flex flex-col items-start gap-3 p-6 text-ui" role="alert">
                {query.error.message}
                <Button size="sm" onClick={() => void query.refetch()}>
                  {t("automation:flows_retry")}
                </Button>
              </div>
            ) : (
              <p className="p-6 text-ui text-muted-foreground">{t("automation:flows_loading")}</p>
            )}
          </>
        )}
      </RouteSurface>
    </RouteInsetSurface>
  );
}

/** What an AI-drafted definition must look like; kept next to the importer that reads it. */
function draftPrompt(request: string, connectors: readonly McpConnector[]): string {
  const example = {
    id: "my-workflow",
    name: "My workflow",
    kind: "workflow",
    enabled: false,
    projectId: "",
    nodes: [{ id: "s1", kind: "instruction", label: "Step", value: "…", position: { x: 0, y: 0 } }],
    edges: [],
  };
  const tools = connectors
    .filter((connector) => connector.status === "connected")
    .map((connector) => JSON.stringify({ serverName: connector.serverName, name: connector.name }));
  return [
    "Create a Sona rule or workflow as JSON for me to review and import in Automations > Rules & workflows (⋯ > Edit as JSON). Do not change settings or run it.",
    `Request: ${request}`,
    `Format: ${JSON.stringify(example)}`,
    'kind is "rule" (applies on every turn) or "workflow" (run on demand with /workflow <id>). A rule may also set "text": plain-language rules.',
    "Node kinds: instruction (value = what the agent does); tool (use a connected tool: set tool to one of the tools below, value = what to do with it); model (hand the step to another AI model; value = the task; leave model unset for me to choose); condition (label = a yes/no question, value = how to decide); workflow (value = a saved workflow ID); require-worktree and branch-prefix (checked by Sona before every turn; branch-prefix value = the literal prefix).",
    'Edges: {id, source, target}; an edge leaving a condition also has branch: "yes" or "no". No cycles. Max 64 nodes, 128 edges. Lay nodes out left to right, about 300 apart.',
    tools.length ? `Connected tools: ${tools.join(", ")}` : "No tools are connected yet.",
    "Return JSON only.",
  ].join("\n");
}

function FlowLibrary({ initial }: { initial: readonly FlowDefinition[] }) {
  const { t } = useTranslation();
  const [flows, setFlows] = useState<readonly FlowDefinition[]>(initial);
  const [baseline, setBaseline] = useState(initial);
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? "");
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const projects = useStore((state) => state.projects);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const client = useQueryClient();
  // Tools are optional: where connectors are off the query fails and steps simply list none.
  const connectors = useQuery(mcpConnectorsQueryOptions()).data;
  const automations = useAutomations();
  const selected = flows.find((flow) => flow.id === selectedId);
  const dirty = JSON.stringify(flows) !== JSON.stringify(baseline);
  const busy = dirty || json !== null;
  useBlocker({
    shouldBlockFn: () => {
      if (busy) setError(t("automation:flows_leaveHint"));
      return busy;
    },
    enableBeforeUnload: busy,
  });
  const save = useMutation({
    onMutate: () => flows,
    mutationFn: async () => {
      const decoded = Schema.decodeUnknownSync(FlowDefinitions)(flows);
      validateFlows(decoded);
      return ensureNativeApi().server.updateSettings({ flows: decoded, expectedFlows: baseline });
    },
    onSuccess: (result, _variables, submitted) => {
      setBaseline(result.flows);
      setFlows((current) =>
        JSON.stringify(current) === JSON.stringify(submitted) ? result.flows : current,
      );
      client.setQueryData(serverQueryKeys.settings(), result);
      setError("");
    },
    onError: (cause) => setError(cause.message),
  });
  const replace = (flow: FlowDefinition) =>
    setFlows((current) => current.map((entry) => (entry.id === flow.id ? flow : entry)));
  const select = (id: string) => {
    setSelectedId(id);
    setJson(null);
  };
  function add(kind: FlowDefinition["kind"], template?: FlowTemplate) {
    const built = template?.build(t) ?? { nodes: [], edges: [] };
    const entry: FlowDefinition = {
      id: newId(),
      name: t(
        template?.name ??
          (kind === "rule" ? "automation:flows_newRule" : "automation:flows_newWorkflow"),
      ),
      kind,
      enabled: false,
      projectId: "",
      ...built,
      // Template model steps start on this host's default model rather than unset.
      nodes: built.nodes.map((node) =>
        node.kind === "model" && !node.model
          ? { ...node, model: projectModelSelection(projects, projectId) }
          : node,
      ),
    };
    setFlows((current) => [...current, entry]);
    select(entry.id);
  }
  function openChat(prompt: string, inProjectId = projectId) {
    const project = projects.find((entry) => entry.id === inProjectId);
    if (!project) {
      setError(t("automation:flows_chooseProject"));
      return;
    }
    const threadId = createDraftThread({
      projectId: project.id,
      prompt,
      modelSelection: resolvePreferredComposerModelSelection({
        draft: null,
        threadModelSelection: null,
        projectModelSelection: project.defaultModelSelection,
        newChatDefault: resolveNewChatDefault(settings),
      }),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_INTERACTION_MODE,
      envMode: settings.defaultThreadEnvMode,
    });
    void navigate({ to: "/$threadId", params: { threadId } });
  }
  function importJson() {
    try {
      const imported = Schema.decodeUnknownSync(FlowDefinition)(JSON.parse(json ?? ""));
      // Import is review-only: activation always requires an explicit owner choice.
      const next = { ...imported, id: selected?.id ?? imported.id, enabled: false };
      const updated = selected
        ? flows.map((flow) => (flow.id === selected.id ? next : flow))
        : [...flows, next];
      validateFlows(updated);
      setFlows(updated);
      setSelectedId(next.id);
      setJson(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  function reload() {
    void ensureNativeApi()
      .server.getSettings()
      .then(
        (result) => {
          setFlows(result.flows);
          setBaseline(result.flows);
          setSelectedId(result.flows[0]?.id ?? "");
          client.setQueryData(serverQueryKeys.settings(), result);
          setError("");
        },
        (cause: unknown) => setError(String(cause)),
      );
  }
  const projectSelect = (
    <Select
      value={projectId || null}
      onValueChange={(value) => {
        if (value !== null) setProjectId(value);
      }}
    >
      <SelectTrigger size="sm" aria-label={t("automation:flows_chatProject")}>
        <SelectValue>
          {projects.find((project) => project.id === projectId)?.name ??
            t("automation:flows_chooseProject")}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup surface="settings">
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
  const group = (kind: FlowDefinition["kind"]) => {
    const rule = kind === "rule";
    const entries = flows.filter((flow) => flow.kind === kind);
    const title = t(rule ? "automation:flows_rules" : "automation:flows_workflows");
    return (
      <section className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-1.5">
          <h2 className="text-ui-sm font-medium">{title}</h2>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(rule ? "automation:flows_newRule" : "automation:flows_newWorkflow")}
            title={t(rule ? "automation:flows_newRule" : "automation:flows_newWorkflow")}
            disabled={flows.length >= 100}
            onClick={() => add(kind)}
          >
            <CentralIcon name="plus-small" className="size-4" />
          </Button>
        </div>
        <p className="px-1.5 pb-1 text-ui-xs leading-snug text-muted-foreground">
          {t(rule ? "automation:flows_rulesHint" : "automation:flows_workflowsHint")}
        </p>
        <nav aria-label={title} className="flex flex-col gap-0.5">
          {entries.map((flow) => (
            <button
              key={flow.id}
              type="button"
              aria-current={selectedId === flow.id ? "page" : undefined}
              onClick={() => select(flow.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-ui outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                selectedId === flow.id ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  flow.enabled ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{flow.name}</span>
              <span className="shrink-0 text-ui-xs text-muted-foreground">
                {t(flow.enabled ? "automation:flows_on" : "automation:flows_off")}
              </span>
            </button>
          ))}
        </nav>
      </section>
    );
  };
  return (
    <>
      <RouteSurfaceHeader>
        <h1 className="min-w-0 flex-1 truncate text-ui-lg font-medium">
          {t("automation:flows_title")}
        </h1>
        <div className={cn("flex shrink-0 items-center gap-1.5", NO_DRAG)}>
          <span className="text-ui-sm text-muted-foreground" role="status">
            {t(dirty ? "automation:flows_unsaved" : "automation:flows_saved")}
          </span>
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setFlows(baseline);
                setSelectedId(baseline[0]?.id ?? "");
                setJson(null);
                setError("");
              }}
            >
              {t("automation:flows_discard")}
            </Button>
          ) : null}
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {t(save.isPending ? "automation:flows_saving" : "automation:flows_save")}
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={t("automation:flows_more")} />
              }
            >
              <EllipsisIcon className="size-4" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" className="w-44">
              <MenuItem disabled={dirty || save.isPending} onClick={reload}>
                {t("automation:flows_reload")}
              </MenuItem>
              <MenuItem onClick={() => setJson("")}>{t("automation:flows_importJson")}</MenuItem>
            </ComposerPickerMenuPopup>
          </Menu>
        </div>
      </RouteSurfaceHeader>
      {error ? (
        <p
          role="alert"
          className="border-b border-destructive/20 bg-destructive/8 px-4 py-2 text-ui text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto text-ui md:flex-row md:overflow-hidden">
        <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-border p-2.5 md:w-48 md:overflow-auto md:border-r md:border-b-0">
          <Button
            size="sm"
            variant="ghost"
            className={cn("justify-start", !selectedId && json === null && "bg-foreground/[0.08]")}
            onClick={() => select("")}
          >
            <CentralIcon name="book-simple" className="size-4" />
            {t("automation:flows_overview")}
          </Button>
          {group("rule")}
          {group("workflow")}
          <Popover>
            <PopoverTrigger
              render={<Button size="sm" variant="outline" className="mt-auto justify-start" />}
            >
              <CentralIcon name="magic-wand" className="size-4" />
              {t("automation:flows_ai")}
            </PopoverTrigger>
            <PopoverPopup side="top" align="start" className="w-80">
              <div className="flex flex-col gap-2.5">
                <PopoverTitle className="text-ui font-medium">
                  {t("automation:flows_ai")}
                </PopoverTitle>
                <p className="text-ui-sm text-muted-foreground">{t("automation:flows_aiHint")}</p>
                <Textarea
                  className="min-h-24"
                  aria-label={t("automation:flows_describe")}
                  placeholder={t("automation:flows_describePlaceholder")}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                {projectSelect}
                <Button
                  size="sm"
                  disabled={!description.trim() || busy}
                  title={busy ? t("automation:flows_leaveHint") : undefined}
                  onClick={() => openChat(draftPrompt(description, connectors ?? []))}
                >
                  {t("automation:flows_aiStart")}
                </Button>
              </div>
            </PopoverPopup>
          </Popover>
        </aside>
        <main className="flex min-h-96 min-w-0 flex-1 flex-col">
          {json !== null ? (
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 p-6">
              <label className="flex flex-1 flex-col gap-2 text-ui">
                {t("automation:flows_jsonHint")}
                <Textarea
                  className="min-h-80 flex-1 font-mono"
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={importJson}>
                  {t("automation:flows_applyJson")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setJson(null)}>
                  {t("automation:flows_cancel")}
                </Button>
              </div>
            </div>
          ) : selected ? (
            <FlowEditor
              key={selected.id}
              flow={selected}
              flows={flows}
              connectors={connectors}
              onChange={replace}
              onEditJson={() => setJson(JSON.stringify(selected, null, 2))}
              onDelete={() => {
                setFlows((current) => current.filter((flow) => flow.id !== selected.id));
                setSelectedId("");
              }}
              overview={
                <Overview
                  flow={selected}
                  flows={flows}
                  blocked={busy}
                  usedBy={automations.data.definitions
                    .filter(
                      (definition) =>
                        !definition.archivedAt &&
                        workflowInvocation(definition.prompt)?.[1] === selected.id,
                    )
                    .map((definition) => definition.name)}
                  projectSelect={selected.projectId || projects.length < 2 ? null : projectSelect}
                  onRun={() =>
                    openChat(`/workflow ${selected.id} `, selected.projectId || projectId)
                  }
                  onSchedule={() => setScheduling(true)}
                />
              }
            />
          ) : (
            <Welcome onAdd={add} onAutomations={() => void navigate({ to: "/automations" })} />
          )}
        </main>
      </div>
      {selected ? (
        <AutomationCreateDialog
          open={scheduling}
          onOpenChange={setScheduling}
          initialDraft={portableAutomationDraft({
            ...formFromDefinition(null, selected.projectId || projectId),
            name: selected.name,
            prompt: `/workflow ${selected.id}`,
          })}
          createAutomation={(input, onCreated) =>
            automations.createMutation.mutate(input, { onSuccess: onCreated })
          }
          busy={automations.createMutation.isPending}
        />
      ) : null}
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-b border-border p-3 last:border-b-0">
      <h3 className="text-ui-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Overview({
  flow,
  flows,
  blocked,
  usedBy,
  projectSelect,
  onRun,
  onSchedule,
}: {
  flow: FlowDefinition;
  flows: readonly FlowDefinition[];
  /** Unsaved changes: the server would run the last saved version. */
  blocked: boolean;
  usedBy: readonly string[];
  projectSelect: ReactNode;
  onRun: () => void;
  onSchedule: () => void;
}) {
  const { t } = useTranslation();
  const rule = flow.kind === "rule";
  let preview = "";
  let invalid = "";
  try {
    preview = flowPromptSection(flow, flows);
  } catch (cause) {
    invalid = cause instanceof Error ? cause.message : String(cause);
  }
  const checks = flow.nodes.filter((node) => FLOW_STEP_KINDS[node.kind].group === "checks");
  return (
    <div className="flex flex-col">
      <Card title={t("automation:flows_howItRuns")}>
        <p className="text-ui leading-snug">
          {t(rule ? "automation:flows_ruleRuns" : "automation:flows_workflowRuns")}
        </p>
        {rule ? null : (
          <>
            <div className="flex items-center gap-1 rounded-lg bg-foreground/[0.05] py-1 pr-1 pl-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-ui-sm">
                /workflow {flow.id}
              </code>
              <CopyTextButton
                iconOnly
                text={`/workflow ${flow.id}`}
                label={t("automation:flows_command")}
              />
            </div>
            {projectSelect}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={blocked || !flow.enabled} onClick={onRun}>
                <CentralIcon name="play" className="size-3.5" />
                {t("automation:flows_openChat")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked || !flow.enabled}
                onClick={onSchedule}
              >
                <CentralIcon name="clock" className="size-3.5" />
                {t("automation:flows_schedule")}
              </Button>
            </div>
            {blocked || !flow.enabled ? (
              <p className="text-ui-xs text-muted-foreground">
                {t(blocked ? "automation:flows_saveFirst" : "automation:flows_turnOnFirst")}
              </p>
            ) : null}
            {usedBy.length ? (
              <p className="text-ui-sm text-muted-foreground">
                {t("automation:flows_usedBy", { names: usedBy.join(", ") })}
              </p>
            ) : null}
          </>
        )}
      </Card>
      {checks.length ? (
        <Card title={t("automation:flows_checkedBySona")}>
          <ul className="flex flex-col gap-1 text-ui">
            {checks.map((node) => (
              <li key={node.id} className="flex items-center gap-1.5">
                <CentralIcon name="lock" className="size-3.5 text-success" />
                <span className="min-w-0 truncate">
                  {node.label || t(FLOW_STEP_KINDS[node.kind].label)}
                  {node.kind === "branch-prefix" && node.value ? ` · ${node.value}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={t("automation:flows_agentReceives")}>
        {invalid ? (
          <p className="text-ui-sm text-warning">{invalid}</p>
        ) : preview ? (
          <pre className="max-h-80 overflow-auto rounded-lg bg-foreground/[0.05] p-2.5 font-mono text-ui-xs leading-relaxed whitespace-pre-wrap">
            {preview}
          </pre>
        ) : (
          <p className="text-ui-sm text-muted-foreground">{t("automation:flows_previewEmpty")}</p>
        )}
      </Card>
      <Card title={t("automation:flows_tips")}>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-ui-sm leading-snug text-muted-foreground">
          <li>{t("automation:flows_tipAdd")}</li>
          <li>{t("automation:flows_tipConnect")}</li>
          <li>{t("automation:flows_tipDelete")}</li>
        </ul>
      </Card>
    </div>
  );
}

function Welcome({
  onAdd,
  onAutomations,
}: {
  onAdd: (kind: FlowDefinition["kind"], template?: FlowTemplate) => void;
  onAutomations: () => void;
}) {
  const { t } = useTranslation();
  const concepts = [
    {
      icon: "shield-check",
      title: t("automation:flows_rules"),
      when: t("automation:flows_conceptRuleWhen"),
      body: t("automation:flows_conceptRule"),
      action: t("automation:flows_newRule"),
      onClick: () => onAdd("rule"),
    },
    {
      icon: "agents",
      title: t("automation:flows_workflows"),
      when: t("automation:flows_conceptWorkflowWhen"),
      body: t("automation:flows_conceptWorkflow"),
      action: t("automation:flows_newWorkflow"),
      onClick: () => onAdd("workflow"),
    },
    {
      icon: "clock",
      title: t("automation:detail_breadcrumb"),
      when: t("automation:flows_conceptAutomationWhen"),
      body: t("automation:flows_conceptAutomation"),
      action: t("automation:flows_openAutomations"),
      onClick: onAutomations,
    },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-1">
          <h2 className="text-ui-xl font-medium">{t("automation:flows_welcomeTitle")}</h2>
          <p className="max-w-xl text-ui text-muted-foreground">{t("automation:flows_intro")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {concepts.map((concept) => (
            <div
              key={concept.title}
              className="flex flex-col gap-2 rounded-xl border border-border bg-[var(--color-background-elevated-primary-opaque)] p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-lg bg-foreground/[0.07]"
                >
                  <CentralIcon name={concept.icon} className="size-4" />
                </span>
                <div>
                  <p className="text-ui font-medium">{concept.title}</p>
                  <p className="text-ui-xs text-muted-foreground">{concept.when}</p>
                </div>
              </div>
              <p className="flex-1 text-ui-sm leading-snug text-muted-foreground">{concept.body}</p>
              <Button size="sm" variant="outline" className="self-start" onClick={concept.onClick}>
                {concept.action}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-medium">{t("automation:flows_templates")}</h3>
          <div className="grid gap-2 md:grid-cols-3">
            {FLOW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onAdd(template.kind, template)}
                className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-1 focus-visible:ring-ring"
              >
                <CentralIcon name={template.icon} className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-ui font-medium">{t(template.name)}</span>
                  <span className="block text-ui-sm leading-snug text-muted-foreground">
                    {t(template.description)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
