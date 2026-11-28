import { Schema } from "effect";

import { ModelSelection } from "./orchestration";

const Id = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/));
const ShortText = Schema.String.check(Schema.isMaxLength(160));

/**
 * A connected tool (Connector) referenced by a workflow step or an automation.
 * `serverName` is the MCP server name provider sessions see; `name` is the
 * display name kept so a disconnected tool still reads well.
 */
export const LinkedTool = Schema.Struct({
  serverName: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,79}$/)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
});
export type LinkedTool = typeof LinkedTool.Type;
export const LinkedTools = Schema.Array(LinkedTool).check(Schema.isMaxLength(20));

/**
 * instruction, tool, model, and condition steps are instructions the agent
 * follows; require-worktree and branch-prefix are checked by the server
 * before every turn; workflow inlines another saved workflow.
 */
export const FlowNodeKind = Schema.Literals([
  "instruction",
  "tool",
  "model",
  "condition",
  "workflow",
  "require-worktree",
  "branch-prefix",
]);
export type FlowNodeKind = typeof FlowNodeKind.Type;

export const FlowNode = Schema.Struct({
  id: Id,
  kind: FlowNodeKind,
  label: ShortText,
  value: Schema.String.check(Schema.isMaxLength(8000)),
  position: Schema.Struct({ x: Schema.Finite, y: Schema.Finite }),
  /** tool steps: the connected tool to use. */
  tool: Schema.optionalKey(LinkedTool),
  /** model steps: the AI model that should carry out the step. */
  model: Schema.optionalKey(ModelSelection),
});
export type FlowNode = typeof FlowNode.Type;

export const FlowEdge = Schema.Struct({
  id: Id,
  source: Id,
  target: Id,
  /** Which outcome of a condition step this connection follows. */
  branch: Schema.optionalKey(Schema.Literals(["yes", "no"])),
});
export type FlowEdge = typeof FlowEdge.Type;

export const FlowDefinition = Schema.Struct({
  id: Id,
  name: ShortText.check(Schema.isMinLength(1)),
  kind: Schema.Literals(["rule", "workflow"]),
  enabled: Schema.Boolean,
  // Empty means every project on this host; otherwise the durable project ID.
  projectId: Schema.String.check(Schema.isMaxLength(128)),
  /** Rules written as text. Applies together with the drawn steps. */
  text: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(8000))),
  nodes: Schema.Array(FlowNode).check(Schema.isMaxLength(64)),
  edges: Schema.Array(FlowEdge).check(Schema.isMaxLength(128)),
});
export type FlowDefinition = typeof FlowDefinition.Type;
export const FlowDefinitions = Schema.Array(FlowDefinition).check(Schema.isMaxLength(100));
