// Codex-only native session import. Historical non-Codex transcripts remain
// readable through projection compatibility; their native runtimes are retired.
import {
  CommandId,
  type OrchestrationImportThreadInput,
  type ThreadHandoffImportedMessage,
  type ThreadId,
} from "@synara/contracts";
import type { FileSystem, Path } from "effect";
import { Data, Effect, Option } from "effect";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery";
import type { ProviderAdapterRegistryShape } from "../provider/Services/ProviderAdapterRegistry";
import type { ProviderServiceShape } from "../provider/Services/ProviderService";
import { mapCodexSnapshotMessages } from "./importedThreadMessages";

class ImportThreadError extends Data.TaggedError("ImportThreadError")<{
  readonly message: string;
}> {}

function importMessagesError(message: string): ImportThreadError {
  return new ImportThreadError({ message });
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): "starting" | "ready" | "running" | "error" | "stopped" {
  if (status === "connecting") return "starting";
  if (status === "closed") return "stopped";
  return status;
}

export interface ImportThreadHandlerOptions {
  readonly fileSystem: FileSystem.FileSystem;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  readonly providerService: ProviderServiceShape;
}

export function makeImportThreadHandler(options: ImportThreadHandlerOptions) {
  const dispatchImportedMessages = (input: {
    readonly createdAt: string;
    readonly messages: ReadonlyArray<ThreadHandoffImportedMessage>;
    readonly threadId: ThreadId;
  }) =>
    input.messages.length === 0
      ? Effect.void
      : options.orchestrationEngine.dispatch({
          type: "thread.messages.import",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId: input.threadId,
          messages: input.messages,
          createdAt: input.createdAt,
        });

  return Effect.fnUntraced(function* (body: OrchestrationImportThreadInput) {
    const threadOption = yield* options.projectionSnapshotQuery.getThreadDetailById(body.threadId);
    if (Option.isNone(threadOption)) {
      return yield* Effect.fail(importMessagesError(`Thread '${body.threadId}' was not found.`));
    }
    const thread = threadOption.value;
    if (thread.modelSelection.provider !== "codex") {
      return yield* Effect.fail(
        importMessagesError(
          "Native import is available only for Codex sessions. Historical provider transcripts remain readable and continue with a fresh Codex session.",
        ),
      );
    }
    if (thread.session && thread.session.status !== "stopped") {
      return yield* Effect.fail(
        importMessagesError(`Thread '${body.threadId}' already has an active provider session.`),
      );
    }

    const project = Option.getOrNull(
      yield* options.projectionSnapshotQuery.getProjectShellById(thread.projectId),
    );
    const cwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project
        ? [{ id: project.id, kind: project.kind, workspaceRoot: project.workspaceRoot }]
        : [],
    });
    const session = yield* options.providerService.startSession(thread.id, {
      threadId: thread.id,
      provider: "codex",
      ...(cwd ? { cwd } : {}),
      modelSelection: thread.modelSelection,
      forkSourceResumeCursor: { threadId: body.externalId.trim() },
      runtimeMode: thread.runtimeMode,
    });

    const adapter = yield* options.providerAdapterRegistry.getByProvider("codex");
    const snapshot = yield* adapter.readThread(thread.id).pipe(
      Effect.mapError((cause) =>
        importMessagesError(
          cause instanceof Error ? cause.message : "Failed to read Codex thread history.",
        ),
      ),
      Effect.onError(() =>
        options.providerService.stopSession({ threadId: thread.id }).pipe(Effect.ignore),
      ),
    );
    yield* dispatchImportedMessages({
      threadId: thread.id,
      messages: mapCodexSnapshotMessages({
        threadId: thread.id,
        turns: snapshot.turns,
        importedAt: session.updatedAt,
      }),
      createdAt: session.updatedAt,
    });
    yield* options.orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: mapProviderSessionStatusToOrchestrationStatus(session.status),
        providerName: "codex",
        runtimeMode: thread.runtimeMode,
        activeTurnId: null,
        lastError: session.lastError ?? null,
        updatedAt: session.updatedAt,
      },
      createdAt: session.updatedAt,
    });
    return { threadId: thread.id };
  });
}
