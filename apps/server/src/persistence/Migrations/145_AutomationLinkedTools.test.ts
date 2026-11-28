import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migration from "./145_AutomationLinkedTools.ts";

const insertDefinition = (sql: SqlClient.SqlClient, id: string) =>
  sql`INSERT INTO automation_definitions (
      automation_id, project_id, name, prompt, schedule_json, enabled, next_run_at,
      model_selection_json, runtime_mode, interaction_mode, worktree_mode, mode,
      target_thread_id, max_iterations, stop_on_error, completion_policy_json,
      completion_policy_version, minimum_interval_seconds, max_runtime_seconds,
      retry_policy_json, misfire_policy, acknowledged_risks_json, iteration_count,
      created_at, updated_at, archived_at
    ) VALUES (
      ${id}, 'project', 'Existing', 'Keep working.', '{"type":"manual"}', 1, NULL,
      '{"provider":"codex","model":"gpt-5-codex"}', 'approval-required', 'default', 'auto',
      'standalone', NULL, NULL, 1, '{"type":"none"}', 0, 60, 3600, '{"type":"none"}',
      'coalesce', '[]', 0, '2026-11-17T09:00:00.000Z', '2026-11-17T09:00:00.000Z', NULL
    )`;

const readColumn = (sql: SqlClient.SqlClient) =>
  sql<{ readonly id: string; readonly linkedTools: string | null; readonly name: string }>`
    SELECT automation_id AS id, linked_tools_json AS "linkedTools", name
    FROM automation_definitions ORDER BY automation_id`;

it.effect(
  "adds a nullable linked tools column, leaves existing rows NULL, and replays safely",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 144 });
      yield* insertDefinition(sql, "automation-existing");
      yield* runMigrations({ toMigrationInclusive: 145 });

      assert.deepStrictEqual(yield* readColumn(sql), [
        { id: "automation-existing", linkedTools: null, name: "Existing" },
      ]);

      // A lineage reconcile can replay the migration: values written since are kept.
      const linked = JSON.stringify([{ serverName: "linear_connector", name: "Linear" }]);
      yield* sql`UPDATE automation_definitions SET linked_tools_json = ${linked}`;
      yield* migration;
      assert.strictEqual((yield* readColumn(sql))[0]!.linkedTools, linked);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
