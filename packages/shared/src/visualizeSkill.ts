/**
 * The built-in `visualize` agent skill. The server installs it into Sona's portable
 * skills folder; the web renderer (ChatMarkdown → VisualFenceBlock) draws the
 * fences it teaches. Keep the component list in sync with
 * apps/web/src/components/chat/generativeUi/catalog.ts (a web test enforces it).
 */
export const VISUALIZE_SKILL_NAME = "visualize";

/** Bump when the text changes so installed copies Sona wrote are refreshed. */
export const VISUALIZE_SKILL_VERSION = 1;

export const VISUALIZE_SKILL_MARKER = `<!-- sona-builtin-skill: ${VISUALIZE_SKILL_NAME} v${VISUALIZE_SKILL_VERSION} -->`;

export const VISUALIZE_SKILL_MARKDOWN = `---
name: ${VISUALIZE_SKILL_NAME}
description: Draw diagrams and visual previews in Sona chat. Use whenever the user asks to diagram, draw, map, visualize, or explain a system architecture, data flow, request/sequence flow, state machine, database schema, dependency graph, timeline, or plan; and whenever a dashboard, comparison, status summary, or UI mockup would be clearer as a rendered preview than as prose or a markdown table.
---
${VISUALIZE_SKILL_MARKER}

# Visualize in Sona

Sona renders two kinds of fenced blocks in your reply. Write the fence directly in
your final message; there is nothing to install and no tool to call. The user can
toggle to the source, copy it, and expand it.

Pick one:

| Need | Fence |
|---|---|
| Architecture, flows, sequences, states, schemas, dependencies, timelines | \`\`\`mermaid |
| Dashboards, metrics, comparisons, checklists, status, UI mockups | \`\`\`json-render |

Ground every visual in what you actually found (files, services, tables). Do not
invent components. Add one or two sentences around the visual explaining what it
shows; the visual supports the answer, it does not replace it.

## Mermaid

Use standard Mermaid syntax. Good defaults:

- System architecture / components: \`flowchart LR\` with \`subgraph\` per boundary
  (client, server, data, external).
- Request or message flow: \`sequenceDiagram\`.
- Lifecycles: \`stateDiagram-v2\`. Data models: \`erDiagram\`. Plans: \`gantt\` or
  \`timeline\`. Class/type structure: \`classDiagram\`.

Rules:

- Quote labels that contain spaces or punctuation: \`A["API gateway (Bun)"]\`.
- Keep node ids short and unique; put detail in labels, not ids.
- Prefer 5-25 nodes. Split a larger system into an overview plus focused diagrams.
- No \`click\` directives, links, HTML labels, or custom \`%%{init}%%\` themes; Sona
  renders strictly and applies its own light/dark theme.

Example:

\`\`\`mermaid
flowchart LR
  subgraph Client
    UI["Web UI"]
  end
  subgraph Server
    API["HTTP API"] --> Q[("Job queue")]
    W["Worker"] --> DB[("Postgres")]
  end
  UI -->|REST| API
  Q --> W
\`\`\`

## json-render previews

A \`json-render\` fence holds one JSON object (no comments, no trailing commas):
\`root\` names the top element and \`elements\` maps ids to
\`{ "type", "props", "children" }\`. Children are element ids. Every prop listed
below must be present; use \`null\` for an unused optional prop.

Components (display-only; there are no buttons, inputs, links or actions):

- \`Stack\` { direction: "vertical" | "horizontal" | null, gap: "sm" | "md" | "lg" | null } — children
- \`Grid\` { columns: 1-4 | null } — children
- \`Card\` { title: string | null, description: string | null } — children
- \`Heading\` { text: string, level: "1" | "2" | "3" | null }
- \`Text\` { text: string, muted: boolean | null }
- \`Metric\` { label: string, value: string, change: string | null, trend: "up" | "down" | "flat" | null }
- \`Badge\` { label: string, tone: "default" | "info" | "success" | "warning" | "error" | null }
- \`Alert\` { title: string, description: string | null, tone: same as Badge | null }
- \`Table\` { columns: string[], rows: string[][] } — one string per column in each row
- \`List\` { items: string[], ordered: boolean | null }
- \`KeyValue\` { items: { label: string, value: string }[] }
- \`Progress\` { label: string, value: number, max: number | null }
- \`Steps\` { items: { title: string, description: string | null, status: "done" | "current" | "pending" | null }[] }
- \`Divider\` {}

Example:

\`\`\`json-render
{
  "root": "page",
  "elements": {
    "page": { "type": "Stack", "props": { "direction": null, "gap": "md" }, "children": ["kpis", "status"] },
    "kpis": { "type": "Grid", "props": { "columns": 3 }, "children": ["m1", "m2", "m3"] },
    "m1": { "type": "Metric", "props": { "label": "p95 latency", "value": "182 ms", "change": "-14%", "trend": "down" } },
    "m2": { "type": "Metric", "props": { "label": "Error rate", "value": "0.3%", "change": null, "trend": "flat" } },
    "m3": { "type": "Metric", "props": { "label": "Deploys", "value": "12", "change": "+3", "trend": "up" } },
    "status": { "type": "Alert", "props": { "title": "Cache warmed", "description": "Cold starts no longer hit the database.", "tone": "success" } }
  }
}
\`\`\`

Use a plain markdown table instead when the content is only a small table.
`;
