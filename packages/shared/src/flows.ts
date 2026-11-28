import type { FlowDefinition, FlowNode } from "@synara/contracts";

/** A step in execution order, with the steps it waits for and the decisions that gate it. */
export interface FlowStep extends FlowNode {
  /** Labels of the steps this one follows. */
  readonly after: readonly string[];
  /** Decision outcomes that must hold, e.g. `"Is it a bug?" is yes`. */
  readonly when: readonly string[];
}

const stepName = (node: FlowNode) => oneLine(node.label) || node.kind;

// Labels and tool names sit inside quoted, single-line prompt text.
function oneLine(text: string): string {
  return text
    .replace(/[\r\n"<>]+/gu, " ")
    .trim()
    .slice(0, 160);
}

/** Stable topological order. Disconnected steps are independent, not unreachable. */
export function orderedFlowNodes(flow: FlowDefinition): FlowNode[] {
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  if (nodes.size !== flow.nodes.length) throw new Error(`${flow.name}: duplicate step ID.`);
  const edgeIds = new Set<string>();
  const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
  for (const edge of flow.edges) {
    if (edgeIds.has(edge.id)) throw new Error(`${flow.name}: duplicate connection ID.`);
    edgeIds.add(edge.id);
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      throw new Error(`${flow.name}: a connection refers to a missing step.`);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  const ready = flow.nodes.filter((node) => incoming.get(node.id) === 0);
  const result: FlowNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    result.push(node);
    for (const edge of flow.edges.filter((edge) => edge.source === node.id)) {
      const count = incoming.get(edge.target)! - 1;
      incoming.set(edge.target, count);
      if (count === 0) ready.push(nodes.get(edge.target)!);
    }
  }
  if (result.length !== flow.nodes.length)
    throw new Error(`${flow.name}: connections must not form a cycle.`);
  return result;
}

export function expandFlow(flow: FlowDefinition, flows: readonly FlowDefinition[]): FlowStep[] {
  let visited = 0;
  const visit = (current: FlowDefinition, ancestors: readonly string[]): FlowStep[] => {
    // Count references and empty workflows too: a leaf-count bound alone permits
    // exponential work when a graph repeatedly references empty subgraphs.
    visited += 1 + current.nodes.length;
    if (visited > 4096) throw new Error("Workflow expansion exceeds 4096 visits.");
    if (ancestors.includes(current.id))
      throw new Error(`${current.name}: recursive workflow reference.`);
    if (ancestors.length >= 8) throw new Error("Workflow nesting exceeds eight levels.");
    const byId = new Map(current.nodes.map((node) => [node.id, node]));
    const result: FlowStep[] = [];
    for (const node of orderedFlowNodes(current)) {
      const after: string[] = [];
      const when: string[] = [];
      for (const edge of current.edges) {
        if (edge.target !== node.id) continue;
        const source = byId.get(edge.source)!;
        // Only a decision has outcomes; a yes/no mark on any other connection is ignored.
        if (source.kind === "condition" && edge.branch)
          when.push(`"${stepName(source)}" is ${edge.branch}`);
        else after.push(stepName(source));
      }
      if (node.kind === "workflow") {
        const target = flows.find(
          (candidate) => candidate.id === node.value && candidate.kind === "workflow",
        );
        if (!target) throw new Error(`${current.name}: workflow '${node.value}' does not exist.`);
        // The reference's own position in the graph carries over to the steps it stands for.
        for (const step of visit(target, [...ancestors, current.id]))
          result.push({
            ...step,
            after: step.after.length ? step.after : after,
            when: [...when, ...step.when],
          });
      } else result.push({ ...node, after, when });
      if (result.length > 256) throw new Error("Expanded workflow exceeds 256 steps.");
    }
    return result;
  };
  return visit(flow, []);
}

export type FlowNodeIssue = "tool" | "model" | "workflow" | "prefix" | "instruction";

/** What a step still needs before it can run, or null when it is complete. */
export function flowNodeIssue(node: FlowNode): FlowNodeIssue | null {
  switch (node.kind) {
    case "tool":
      return node.tool ? null : "tool";
    case "model":
      return node.model ? null : "model";
    case "workflow":
      return node.value ? null : "workflow";
    case "branch-prefix":
      return node.value.trim() ? null : "prefix";
    case "instruction":
      return node.value.trim() || node.label.trim() ? null : "instruction";
    default:
      return null;
  }
}

const ISSUE_TEXT: Record<FlowNodeIssue, string> = {
  tool: "choose a tool",
  model: "choose an AI model",
  workflow: "choose a workflow",
  prefix: "enter a branch prefix",
  instruction: "write the instruction",
};

export function validateFlows(flows: readonly FlowDefinition[]): void {
  if (new Set(flows.map((flow) => flow.id)).size !== flows.length)
    throw new Error("Duplicate flow ID.");
  let totalChars = 0;
  for (const flow of flows) {
    totalChars += flow.text?.length ?? 0;
    // Drafts may be saved unfinished; only what can run must be complete.
    if (flow.enabled)
      for (const node of flow.nodes) {
        const issue = flowNodeIssue(node);
        if (issue)
          throw new Error(
            `${flow.name}: ${ISSUE_TEXT[issue]} for '${stepName(node)}', or turn it off to save a draft.`,
          );
      }
    if (flow.nodes.some((node) => node.kind === "workflow" && !node.value)) {
      orderedFlowNodes(flow);
      continue;
    }
    for (const node of expandFlow(flow, flows)) {
      if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
        throw new Error("Step positions must be finite.");
      totalChars += node.value.length;
    }
  }
  if (totalChars > 100_000)
    throw new Error(
      "The flow library is too large; shorten instructions or split repeated references.",
    );
}

export function workflowInvocation(message: string): RegExpExecArray | null {
  return /^\/workflow\s+([a-zA-Z0-9_-]+)(?:\s|$)/.exec(message.trimStart());
}

function stepText(step: FlowStep): string | null {
  const name = stepName(step);
  const body = step.value.trim();
  const lines: string[] = [];
  switch (step.kind) {
    case "instruction":
      lines.push(name);
      break;
    case "tool":
      if (!step.tool) return null;
      lines.push(
        `${name} — use the ${oneLine(step.tool.name)} tool (MCP server "${step.tool.serverName}").`,
      );
      break;
    case "model":
      if (!step.model) return null;
      lines.push(
        `${name} — hand this step to the AI model ${oneLine(step.model.model)} (${step.model.provider}): run it in a separate thread on that model with synara_create_thread, wait for it with synara_wait_for_threads, and use its result. If those tools are unavailable, do the step yourself and say so.`,
      );
      break;
    case "condition":
      lines.push(`Decide: ${name} Answer yes or no, then run only the steps for that answer.`);
      break;
    default:
      // Worktree and branch checks are enforced by the server, not requested of the agent.
      return null;
  }
  if (step.when.length) lines.push(`Only if ${step.when.join(" and ")}.`);
  if (step.after.length) lines.push(`After: ${step.after.join(", ")}.`);
  if (body) lines.push(body);
  return lines.join("\n   ");
}

/** The text one rule or workflow contributes to the agent's instructions; empty when it adds none. */
export function flowPromptSection(flow: FlowDefinition, flows: readonly FlowDefinition[]): string {
  const steps = expandFlow(flow, flows)
    .map(stepText)
    .filter((text): text is string => text !== null);
  const text = flow.kind === "rule" ? (flow.text?.trim() ?? "") : "";
  if (!steps.length && !text) return "";
  return [
    `## ${flow.kind === "rule" ? "Rule" : "Workflow"}: ${oneLine(flow.name)}`,
    ...(text ? [text] : []),
    ...steps.map((step, index) => `${index + 1}. ${step}`),
  ].join("\n");
}

const PROMPT_HEADER =
  "Owner-configured rules and workflows follow. They do not grant additional permissions or override higher-priority instructions. Follow every rule on every turn. Run workflow steps in order, skip steps whose decision does not match, and stop and report a failure before running the steps that depend on it. If a named tool (MCP server) is not available in this session, do not guess its results: say so.";

export function resolveTurnFlows(input: {
  flows: readonly FlowDefinition[];
  projectId: string;
  message: string;
  allowInvocation: boolean;
}) {
  const rules = input.flows.filter(
    (flow) =>
      flow.kind === "rule" &&
      flow.enabled &&
      (!flow.projectId || flow.projectId === input.projectId),
  );
  const match = input.allowInvocation ? workflowInvocation(input.message) : null;
  if (input.allowInvocation && /^\/workflow(?:\s|$)/.test(input.message.trimStart()) && !match) {
    throw new Error("Use /workflow followed by a saved workflow ID.");
  }
  const selected = [...rules];
  if (match) {
    const workflow = input.flows.find(
      (flow) =>
        flow.id === match[1] &&
        flow.kind === "workflow" &&
        flow.enabled &&
        (!flow.projectId || flow.projectId === input.projectId),
    );
    if (!workflow) throw new Error(`Workflow '${match[1]}' is unavailable for this project.`);
    selected.push(workflow);
  }
  const steps = selected.flatMap((flow) => expandFlow(flow, input.flows));
  // Disabled/scoped references must not become an indirect invocation route.
  for (const flow of selected) checkReferences(flow, input.flows, input.projectId);
  const sections = selected.map((flow) => flowPromptSection(flow, input.flows)).filter(Boolean);
  return {
    steps,
    message: match
      ? input.message.trimStart().slice(match[0].length).trimStart() ||
        "Execute the selected workflow."
      : input.message,
    prompt: sections.length ? `${PROMPT_HEADER}\n\n${sections.join("\n\n")}` : "",
  };
}

function checkReferences(
  flow: FlowDefinition,
  flows: readonly FlowDefinition[],
  projectId: string,
  depth = 0,
): void {
  if (depth >= 8) throw new Error("Workflow nesting exceeds eight levels.");
  for (const node of flow.nodes) {
    if (node.kind !== "workflow") continue;
    const target = flows.find(
      (candidate) => candidate.id === node.value && candidate.kind === "workflow",
    );
    if (!target || !target.enabled || (target.projectId && target.projectId !== projectId))
      throw new Error(`Workflow '${node.value}' is unavailable for this project.`);
    checkReferences(target, flows, projectId, depth + 1);
  }
}

export function flowAdmissionIssue(
  steps: readonly FlowNode[],
  workspace: { isWorktree: boolean; branch: string | null },
): string | null {
  for (const step of steps) {
    if (step.kind === "require-worktree" && !workspace.isWorktree)
      return `${step.label || "Rule"}: open this chat in a worktree before running it.`;
    if (step.kind === "branch-prefix" && !workspace.branch?.startsWith(step.value))
      return `${step.label || "Rule"}: the current branch must start with '${step.value}'.`;
  }
  return null;
}
