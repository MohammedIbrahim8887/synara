import { describe, expect, it } from "vitest";
import type { FlowDefinition, FlowNode } from "@synara/contracts";
import { expandFlow, flowAdmissionIssue, resolveTurnFlows, validateFlows } from "./flows";
const step = (id: string, kind: FlowNode["kind"] = "instruction", value = id): FlowNode => ({
  id,
  kind,
  value,
  label: id,
  position: { x: 0, y: 0 },
});
const flow = (
  id: string,
  nodes: FlowNode[],
  extra: Partial<FlowDefinition> = {},
): FlowDefinition => ({
  id,
  name: id,
  kind: "workflow",
  enabled: true,
  projectId: "",
  nodes,
  edges: [],
  ...extra,
});
describe("rules and workflows", () => {
  it("orders dependencies before dependents and expands reusable workflows", () => {
    const child = flow("review", [step("check")]);
    const parent = flow("ship", [step("pr"), step("review", "workflow", "review")], {
      edges: [{ id: "e", source: "review", target: "pr" }],
    });
    expect(expandFlow(parent, [parent, child]).map((node) => node.id)).toEqual(["check", "pr"]);
  });
  it("rejects cycles, missing nodes, missing workflows and recursive references", () => {
    expect(() =>
      validateFlows([flow("x", [step("a")], { edges: [{ id: "e", source: "a", target: "a" }] })]),
    ).toThrow("cycle");
    expect(() =>
      validateFlows([flow("x", [], { edges: [{ id: "e", source: "a", target: "b" }] })]),
    ).toThrow("missing step");
    expect(() => validateFlows([flow("x", [step("a", "workflow", "gone")])])).toThrow(
      "does not exist",
    );
    expect(() => validateFlows([flow("x", [step("a", "workflow", "x")])])).toThrow("recursive");
  });
  it("applies only enabled project rules and explicit workflow invocations", () => {
    const flows = [
      flow("global", [step("always")], { kind: "rule" }),
      flow("private", [step("secret")], { kind: "rule", projectId: "other" }),
      flow("off", [step("off")], { kind: "rule", enabled: false }),
      flow("run", [step("manual")]),
    ];
    const input = { flows, projectId: "p", message: "/workflow run", allowInvocation: true };
    expect(resolveTurnFlows(input).steps.map((node) => node.id)).toEqual(["always", "manual"]);
    expect(
      resolveTurnFlows({ ...input, allowInvocation: false }).steps.map((node) => node.id),
    ).toEqual(["always"]);
    expect(() => resolveTurnFlows({ ...input, message: "/workflow gone" })).toThrow("unavailable");
  });
  it("rejects disabled and foreign-project workflow references", () => {
    const rule = flow("rule", [step("call", "workflow", "child")], { kind: "rule" });
    for (const child of [
      flow("child", [], { enabled: false }),
      flow("child", [], { projectId: "other" }),
    ]) {
      expect(() =>
        resolveTurnFlows({
          flows: [rule, child],
          projectId: "p",
          message: "hello",
          allowInvocation: true,
        }),
      ).toThrow("unavailable");
    }
  });
  it("blocks local checkouts, detached heads and nonmatching branches", () => {
    const steps = [
      step("worktree", "require-worktree"),
      step("branch", "branch-prefix", "feature/"),
    ];
    expect(flowAdmissionIssue(steps, { isWorktree: false, branch: "feature/x" })).toContain(
      "worktree",
    );
    expect(flowAdmissionIssue(steps, { isWorktree: true, branch: null })).toContain("feature/");
    expect(flowAdmissionIssue(steps, { isWorktree: true, branch: "main" })).toContain("feature/");
    expect(flowAdmissionIssue(steps, { isWorktree: true, branch: "feature/x" })).toBeNull();
  });
  it("limits graph expansion", () => {
    const flows = [flow("base", [step("a")])];
    for (let i = 0; i < 9; i++)
      flows.push(
        flow(`f${i}`, [
          step("a", "workflow", flows.at(-1)!.id),
          step("b", "workflow", flows.at(-1)!.id),
        ]),
      );
    expect(() => validateFlows(flows)).toThrow();
  });
});

it("bounds expansion even when referenced workflows contain no executable steps", () => {
  const flows = [flow("empty", [])];
  for (let i = 0; i < 5; i++) {
    const target = flows.at(-1)!.id;
    flows.push(
      flow(
        `empty${i}`,
        Array.from({ length: 8 }, (_, j) => step(`ref${j}`, "workflow", target)),
      ),
    );
  }
  expect(() => validateFlows(flows)).toThrow("expansion");
});

describe("tools, AI models, decisions and written rules", () => {
  const tool = { serverName: "linear_connector", name: 'Lin"ear\n' };
  const model = { provider: "codex", instanceId: "codex", model: "gpt-5-codex" } as const;
  it("tells the agent which tool, model and branch each step uses", () => {
    const triage = flow(
      "triage",
      [
        { ...step("fetch", "tool", "List open issues"), tool },
        step("bug", "condition", ""),
        { ...step("fix", "model", "Fix it"), model },
        step("skip", "instruction", "Leave a comment"),
        step("gate", "require-worktree"),
      ],
      {
        edges: [
          { id: "e1", source: "fetch", target: "bug" },
          { id: "e2", source: "bug", target: "fix", branch: "yes" },
          { id: "e3", source: "bug", target: "skip", branch: "no" },
        ],
      },
    );
    const { prompt, steps } = resolveTurnFlows({
      flows: [triage],
      projectId: "p",
      message: "/workflow triage",
      allowInvocation: true,
    });
    expect(prompt).toContain("## Workflow: triage");
    expect(prompt).toContain('use the Lin ear tool (MCP server "linear_connector")');
    expect(prompt).toContain("After: fetch.");
    expect(prompt).toContain('Only if "bug" is yes.');
    expect(prompt).toContain('Only if "bug" is no.');
    expect(prompt).toContain("gpt-5-codex (codex)");
    // Server-enforced checks stay in the admission steps and out of the agent's text.
    expect(prompt).not.toContain("gate");
    expect(steps.some((node) => node.kind === "require-worktree")).toBe(true);
  });
  it("carries a reference's decision onto the steps it stands for", () => {
    const child = flow("child", [step("inner")]);
    const parent = flow("parent", [step("ok", "condition"), step("call", "workflow", "child")], {
      edges: [{ id: "e", source: "ok", target: "call", branch: "no" }],
    });
    expect(expandFlow(parent, [parent, child]).at(-1)).toMatchObject({
      id: "inner",
      when: ['"ok" is no'],
    });
  });
  it("applies written rules alongside drawn steps, for rules only", () => {
    const flows = [
      flow("style", [step("draw")], { kind: "rule", text: "Never push to main." }),
      flow("written", [], { kind: "rule", text: "  Ask before deleting.  " }),
      flow("wf", [step("x")], { text: "ignored" }),
    ];
    const { prompt } = resolveTurnFlows({
      flows,
      projectId: "p",
      message: "/workflow wf",
      allowInvocation: true,
    });
    expect(prompt).toContain("## Rule: style\nNever push to main.\n1. draw");
    expect(prompt).toContain("## Rule: written\nAsk before deleting.");
    expect(prompt).not.toContain("ignored");
  });
  it("saves unfinished drafts but refuses to enable them", () => {
    const draft = flow("draft", [step("pick", "tool"), step("ref", "workflow", "")], {
      enabled: false,
    });
    expect(() => validateFlows([draft])).not.toThrow();
    expect(() => validateFlows([{ ...draft, enabled: true }])).toThrow("choose a tool");
    expect(() =>
      validateFlows([flow("b", [step("p", "branch-prefix", " ")], { kind: "rule" })]),
    ).toThrow("branch prefix");
  });
});
