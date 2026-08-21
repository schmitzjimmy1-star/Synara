// Purpose: Records the command that caused a thread's current archived state so
//          source-cascaded Side Chats can be distinguished from direct archives.

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  if (!(yield* columnExists(sql, "projection_threads", "archive_command_id"))) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN archive_command_id TEXT
    `;
  }

  // The event envelope already contains the durable causal ID. Match the
  // projector's archivedAt fallback so stale archive cycles cannot claim the
  // provenance of a thread's current archived state.
  yield* sql`
    UPDATE projection_threads
    SET archive_command_id = (
      SELECT events.command_id
      FROM orchestration_events AS events
      WHERE events.aggregate_kind = 'thread'
        AND events.stream_id = projection_threads.thread_id
        AND events.event_type = 'thread.archived'
        AND COALESCE(
          json_extract(events.payload_json, '$.archivedAt'),
          json_extract(events.payload_json, '$.updatedAt'),
          events.occurred_at
        ) = projection_threads.archived_at
      ORDER BY events.sequence DESC
      LIMIT 1
    )
    WHERE projection_threads.archived_at IS NOT NULL
      AND projection_threads.archive_command_id IS NULL
  `;
});
