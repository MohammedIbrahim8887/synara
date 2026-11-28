import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react";
import { z } from "zod";

const tone = z.enum(["default", "info", "success", "warning", "error"]);

/**
 * Components an agent may use in a ```json-render fence. Display-only: no actions,
 * inputs, links or scripts, so a preview can never do anything on the user's behalf.
 * Keep the visualize skill (@synara/shared/visualizeSkill) in sync; a test checks it.
 */
export const generativeUiCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(["vertical", "horizontal"]).nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      slots: ["default"],
      description: "Lays children out vertically (default) or horizontally, wrapping when narrow.",
    },
    Grid: {
      props: z.object({ columns: z.number().int().min(1).max(4).nullable() }),
      slots: ["default"],
      description: "Responsive grid of equal columns (1-4) for cards or metrics.",
    },
    Card: {
      props: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
      slots: ["default"],
      description: "Bordered surface grouping related content under an optional title.",
    },
    Heading: {
      props: z.object({ text: z.string(), level: z.enum(["1", "2", "3"]).nullable() }),
      description: "Section heading.",
    },
    Text: {
      props: z.object({ text: z.string(), muted: z.boolean().nullable() }),
      description: "Paragraph of plain text.",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        change: z.string().nullable(),
        trend: z.enum(["up", "down", "flat"]).nullable(),
      }),
      description: "Single headline number with an optional change, e.g. '+12%'.",
    },
    Badge: {
      props: z.object({ label: z.string(), tone: tone.nullable() }),
      description: "Short status label.",
    },
    Alert: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        tone: tone.nullable(),
      }),
      description: "Callout for a warning, tip, error or success message.",
    },
    Table: {
      props: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      description: "Data table; every row has one string per column.",
    },
    List: {
      props: z.object({ items: z.array(z.string()), ordered: z.boolean().nullable() }),
      description: "Bulleted or numbered list.",
    },
    KeyValue: {
      props: z.object({
        items: z.array(z.object({ label: z.string(), value: z.string() })),
      }),
      description: "Label/value pairs, e.g. configuration or specs.",
    },
    Progress: {
      props: z.object({
        label: z.string(),
        value: z.number(),
        max: z.number().nullable(),
      }),
      description: "Progress bar from 0 to max (default 100).",
    },
    Steps: {
      props: z.object({
        items: z.array(
          z.object({
            title: z.string(),
            description: z.string().nullable(),
            status: z.enum(["done", "current", "pending"]).nullable(),
          }),
        ),
      }),
      description: "Ordered steps or a timeline with done/current/pending status.",
    },
    Divider: {
      props: z.object({}),
      description: "Horizontal separator.",
    },
  },
  actions: {},
});

export const GENERATIVE_UI_COMPONENT_NAMES = Object.keys(
  generativeUiCatalog.data.components,
) as ReadonlyArray<string>;
