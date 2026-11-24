// FILE: 145_AutomationLinkedTools.ts
// Purpose: Adds the connected tools (Connectors) an automation tells every run to use.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

// Additive and nullable: existing rows keep NULL, which the repository reads as "no tools", so
// nothing is rewritten and an older build that ignores the column keeps working. The check
// makes a replay over an already-migrated database a no-op.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* columnExists(sql, "automation_definitions", "linked_tools_json"))) {
    yield* sql`ALTER TABLE automation_definitions ADD COLUMN linked_tools_json TEXT`;
  }
});
