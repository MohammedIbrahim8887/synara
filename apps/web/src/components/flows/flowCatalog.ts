// FILE: flowCatalog.ts
// Purpose: What each rule/workflow step is called, how it looks, and the starter templates.
// Layer: Web flows editor data
// Exports: FLOW_STEP_KINDS, FLOW_STEP_GROUPS, FLOW_TEMPLATES, stepKindsFor, newFlowStep

import type { FlowDefinition, FlowNode, FlowNodeKind } from "@synara/contracts";

import { randomUUID as newId } from "~/lib/utils";

export interface FlowStepKind {
  readonly kind: FlowNodeKind;
  /** i18n keys in the `automation` namespace. */
  readonly label: string;
  readonly hint: string;
  /** Central icon name. */
  readonly icon: string;
  /** Icon tile colors, from the shared status palette. */
  readonly tone: string;
  readonly group: "steps" | "checks";
}

export const FLOW_STEP_KINDS: Record<FlowNodeKind, FlowStepKind> = {
  instruction: {
    kind: "instruction",
    label: "automation:flows_instruction",
    hint: "automation:flows_instructionHint",
    icon: "note-text",
    tone: "bg-foreground/[0.07] text-foreground",
    group: "steps",
  },
  tool: {
    kind: "tool",
    label: "automation:flows_tool",
    hint: "automation:flows_toolHint",
    icon: "connectors-1",
    tone: "bg-info/10 text-info-foreground dark:bg-info/16",
    group: "steps",
  },
  model: {
    kind: "model",
    label: "automation:flows_model",
    hint: "automation:flows_modelHint",
    icon: "sparkle",
    tone: "bg-primary/10 text-primary",
    group: "steps",
  },
  condition: {
    kind: "condition",
    label: "automation:flows_condition",
    hint: "automation:flows_conditionHint",
    icon: "fork-simple",
    tone: "bg-warning/10 text-warning dark:bg-warning/16",
    group: "steps",
  },
  workflow: {
    kind: "workflow",
    label: "automation:flows_reuse",
    hint: "automation:flows_reuseHint",
    icon: "agents",
    tone: "bg-foreground/[0.07] text-foreground",
    group: "steps",
  },
  "require-worktree": {
    kind: "require-worktree",
    label: "automation:flows_worktree",
    hint: "automation:flows_worktreeHint",
    icon: "split",
    tone: "bg-success/10 text-success dark:bg-success/16",
    group: "checks",
  },
  "branch-prefix": {
    kind: "branch-prefix",
    label: "automation:flows_branch",
    hint: "automation:flows_branchHint",
    icon: "branch-simple",
    tone: "bg-success/10 text-success dark:bg-success/16",
    group: "checks",
  },
};

export const FLOW_STEP_GROUPS = [
  { id: "steps", label: "automation:flows_groupSteps", hint: "automation:flows_groupStepsHint" },
  { id: "checks", label: "automation:flows_groupChecks", hint: "automation:flows_groupChecksHint" },
] as const;

export function stepKindsFor(group: FlowStepKind["group"]): FlowStepKind[] {
  return Object.values(FLOW_STEP_KINDS).filter((entry) => entry.group === group);
}

export function newFlowStep(
  kind: FlowNodeKind,
  label: string,
  position: FlowNode["position"],
  extra: Partial<FlowNode> = {},
): FlowNode {
  return { id: newId(), kind, label, value: "", position, ...extra };
}

export interface FlowTemplate {
  readonly id: string;
  readonly kind: FlowDefinition["kind"];
  /** i18n keys in the `automation` namespace. */
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  /** Step labels and text are i18n keys too; `build` resolves them. */
  readonly build: (t: (key: string) => string) => Pick<FlowDefinition, "text" | "nodes" | "edges">;
}

const COLUMN = 300;

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  {
    id: "written-rule",
    kind: "rule",
    name: "automation:flows_tplWritten",
    description: "automation:flows_tplWrittenHint",
    icon: "pencil",
    build: (t) => ({ text: t("automation:flows_tplWrittenText"), nodes: [], edges: [] }),
  },
  {
    id: "safe-branches",
    kind: "rule",
    name: "automation:flows_tplBranches",
    description: "automation:flows_tplBranchesHint",
    icon: "shield-check",
    build: (t) => {
      const worktree = newFlowStep("require-worktree", t("automation:flows_worktree"), {
        x: 0,
        y: 0,
      });
      const branch = newFlowStep(
        "branch-prefix",
        t("automation:flows_branch"),
        { x: COLUMN, y: 0 },
        { value: "feature/" },
      );
      return {
        nodes: [worktree, branch],
        edges: [{ id: newId(), source: worktree.id, target: branch.id }],
      };
    },
  },
  {
    id: "issue-triage",
    kind: "workflow",
    name: "automation:flows_tplTriage",
    description: "automation:flows_tplTriageHint",
    icon: "connectors-1",
    build: (t) => {
      const fetch = newFlowStep(
        "tool",
        t("automation:flows_tplTriageFetch"),
        { x: 0, y: 80 },
        { value: t("automation:flows_tplTriageFetchText") },
      );
      const decide = newFlowStep(
        "condition",
        t("automation:flows_tplTriageDecide"),
        { x: COLUMN, y: 80 },
        { value: t("automation:flows_tplTriageDecideText") },
      );
      const fix = newFlowStep(
        "model",
        t("automation:flows_tplTriageFix"),
        { x: COLUMN * 2, y: 0 },
        { value: t("automation:flows_tplTriageFixText") },
      );
      const task = newFlowStep(
        "tool",
        t("automation:flows_tplTriageTask"),
        { x: COLUMN * 2, y: 170 },
        { value: t("automation:flows_tplTriageTaskText") },
      );
      return {
        nodes: [fetch, decide, fix, task],
        edges: [
          { id: newId(), source: fetch.id, target: decide.id },
          { id: newId(), source: decide.id, target: fix.id, branch: "yes" },
          { id: newId(), source: decide.id, target: task.id, branch: "no" },
        ],
      };
    },
  },
];
