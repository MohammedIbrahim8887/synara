import { defineRegistry } from "@json-render/react";

import { cn } from "~/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Separator } from "../../ui/separator";
import { generativeUiCatalog } from "./catalog";

const GAP = { sm: "gap-2", md: "gap-3", lg: "gap-5" } as const;
const GRID_COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;
const TREND = { up: "text-success", down: "text-destructive", flat: "text-muted-foreground" };
const STEP_DOT = {
  done: "bg-success",
  current: "bg-info ring-4 ring-info/20",
  pending: "bg-muted-foreground/40",
};

/** Maps the display-only catalog onto Sona's own UI primitives and tokens. */
export const { registry: generativeUiRegistry } = defineRegistry(generativeUiCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div
        className={cn(
          "flex min-w-0",
          props.direction === "horizontal" ? "flex-row flex-wrap items-start" : "flex-col",
          GAP[props.gap ?? "md"],
        )}
      >
        {children}
      </div>
    ),
    Grid: ({ props, children }) => (
      <div
        className={cn(
          "grid min-w-0 gap-3",
          GRID_COLUMNS[Math.min(Math.max(props.columns ?? 2, 1), 4) as 1 | 2 | 3 | 4],
        )}
      >
        {children}
      </div>
    ),
    Card: ({ props, children }) => (
      <section className="min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground">
        {props.title ? <h3 className="text-ui-lg font-semibold">{props.title}</h3> : null}
        {props.description ? (
          <p className="mt-0.5 text-ui-sm text-muted-foreground">{props.description}</p>
        ) : null}
        {children ? (
          <div
            className={cn("flex flex-col gap-3", props.title || props.description ? "mt-3" : "")}
          >
            {children}
          </div>
        ) : null}
      </section>
    ),
    Heading: ({ props }) => {
      const level = props.level ?? "2";
      const className = cn(
        "font-semibold text-foreground",
        level === "1" ? "text-ui-lg" : level === "2" ? "text-ui-lg" : "text-ui",
      );
      return level === "1" ? (
        <h2 className={className}>{props.text}</h2>
      ) : level === "2" ? (
        <h3 className={className}>{props.text}</h3>
      ) : (
        <h4 className={className}>{props.text}</h4>
      );
    },
    Text: ({ props }) => (
      <p className={cn("text-ui leading-relaxed", props.muted && "text-muted-foreground")}>
        {props.text}
      </p>
    ),
    Metric: ({ props }) => (
      <div className="min-w-0 rounded-xl border border-border bg-card p-4">
        <p className="text-ui-sm text-muted-foreground">{props.label}</p>
        <p className="mt-1 text-ui-lg font-semibold tabular-nums">{props.value}</p>
        {props.change ? (
          <p className={cn("text-ui-sm tabular-nums", TREND[props.trend ?? "flat"])}>
            {props.change}
          </p>
        ) : null}
      </div>
    ),
    Badge: ({ props }) => (
      <Badge
        className="w-fit self-start justify-self-start"
        variant={
          props.tone === "default" || !props.tone
            ? "secondary"
            : props.tone === "error"
              ? "error"
              : props.tone
        }
      >
        {props.label}
      </Badge>
    ),
    Alert: ({ props }) => (
      <Alert variant={props.tone ?? "default"}>
        <AlertTitle>{props.title}</AlertTitle>
        {props.description ? <AlertDescription>{props.description}</AlertDescription> : null}
      </Alert>
    ),
    Table: ({ props }) => (
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-ui-sm">
          <thead className="bg-muted/40">
            <tr>
              {props.columns.map((column, index) => (
                <th key={index} className="px-3 py-2 text-start font-medium text-muted-foreground">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-border">
                {props.columns.map((_, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 align-top">
                    {row[cellIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    List: ({ props }) => {
      const items = props.items.map((item, index) => <li key={index}>{item}</li>);
      return props.ordered ? (
        <ol className="list-decimal space-y-1 ps-5 text-ui">{items}</ol>
      ) : (
        <ul className="list-disc space-y-1 ps-5 text-ui">{items}</ul>
      );
    },
    KeyValue: ({ props }) => (
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui-sm">
        {props.items.map((item, index) => (
          <div key={index} className="contents">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 break-words">{item.value}</dd>
          </div>
        ))}
      </dl>
    ),
    Progress: ({ props }) => {
      const max = props.max && props.max > 0 ? props.max : 100;
      const percent = Math.round(Math.min(Math.max(props.value / max, 0), 1) * 100);
      return (
        <div className="min-w-0">
          <div className="flex justify-between text-ui-sm">
            <span>{props.label}</span>
            <span className="tabular-nums text-muted-foreground">{percent}%</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={props.label}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </div>
      );
    },
    Steps: ({ props }) => (
      <ol className="flex flex-col gap-3">
        {props.items.map((item, index) => (
          <li key={index} className="flex gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                STEP_DOT[item.status ?? "pending"],
              )}
            />
            <div className="min-w-0">
              <p className="text-ui font-medium">{item.title}</p>
              {item.description ? (
                <p className="text-ui-sm text-muted-foreground">{item.description}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    ),
    Divider: () => <Separator />,
  },
  actions: {},
});
