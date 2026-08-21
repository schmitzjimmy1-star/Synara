// Purpose: Proves archive causality is backfilled from the matching current
//          archive event and the migration remains replay-safe.

import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration from "./097_ProjectionThreadsArchiveCommand.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("097_ProjectionThreadsArchiveCommand", (it) => {
  it.effect("backfills the command for the current archive cycle and is idempotent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 96 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'project-archive-command', 'project', 'Archive command', '/workspace', '[]',
          '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, runtime_mode, interaction_mode, env_mode,
          created_at, updated_at, archived_at
        ) VALUES
          (
            'thread-current', 'project-archive-command', 'Current',
            'approval-required', 'default', 'local',
            '2026-08-21T10:00:00.000Z', '2026-08-21T12:00:00.000Z',
            '2026-08-21T12:00:00.000Z'
          ),
          (
            'thread-legacy', 'project-archive-command', 'Legacy',
            'approval-required', 'default', 'local',
            '2026-08-21T10:00:00.000Z', '2026-08-21T12:00:00.000Z',
            '2026-08-21T12:00:00.000Z'
          )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, actor_kind, payload_json, metadata_json
        ) VALUES
          (
            'event-old-archive', 'thread', 'thread-current', 1, 'thread.archived',
            '2026-08-21T11:00:00.000Z', 'command-old', 'client',
            '{"threadId":"thread-current","archivedAt":"2026-08-21T11:00:00.000Z"}', '{}'
          ),
          (
            'event-current-archive', 'thread', 'thread-current', 2, 'thread.archived',
            '2026-08-21T12:00:00.000Z', 'command-current', 'client',
            '{"threadId":"thread-current","updatedAt":"2026-08-21T12:00:00.000Z"}', '{}'
          ),
          (
            'event-legacy-archive', 'thread', 'thread-legacy', 1, 'thread.archived',
            '2026-08-21T12:00:00.000Z', NULL, 'client',
            '{"threadId":"thread-legacy","archivedAt":"2026-08-21T12:00:00.000Z"}', '{}'
          )
      `;

      yield* Migration;
      yield* Migration;

      const rows = yield* sql<{
        readonly threadId: string;
        readonly archiveCommandId: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          archive_command_id AS "archiveCommandId"
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        { threadId: "thread-current", archiveCommandId: "command-current" },
        { threadId: "thread-legacy", archiveCommandId: null },
      ]);
    }),
  );
});
