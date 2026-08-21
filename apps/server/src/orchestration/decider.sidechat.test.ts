import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-21T12:00:00.000Z";
const PROJECT_ID = ProjectId.makeUnsafe("project-sidechat-integrity");
const SOURCE_THREAD_ID = ThreadId.makeUnsafe("thread-source");
const SIDECHAT_THREAD_ID = ThreadId.makeUnsafe("thread-sidechat");
const SOURCE_SUBAGENT_ID = ThreadId.makeUnsafe("subagent:thread-source:child");
const SIDECHAT_SUBAGENT_ID = ThreadId.makeUnsafe("subagent:thread-sidechat:child");
const OTHER_THREAD_ID = ThreadId.makeUnsafe("thread-other");
const WORKTREE_PATH = "/tmp/worktrees/source";
const WORKTREE_BRANCH = "feature/source";

type ReadThread = OrchestrationReadModel["threads"][number];

function makeThread(input: {
  id: ThreadId;
  parentThreadId?: ThreadId;
  sidechatSourceThreadId?: ThreadId;
  archivedAt?: string;
  deletedAt?: string;
}): ReadThread {
  return {
    id: input.id,
    projectId: PROJECT_ID,
    title: `Thread ${input.id}`,
    modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    envMode: "worktree",
    branch: WORKTREE_BRANCH,
    worktreePath: WORKTREE_PATH,
    workingDirectory: null,
    associatedWorktreePath: WORKTREE_PATH,
    associatedWorktreeBranch: WORKTREE_BRANCH,
    associatedWorktreeRef: WORKTREE_BRANCH,
    createBranchFlowCompleted: true,
    createdAt: NOW,
    updatedAt: NOW,
    latestTurn: null,
    handoff: null,
    messages: [],
    session: null,
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    deletedAt: input.deletedAt ?? null,
    archivedAt: input.archivedAt ?? null,
    parentThreadId: input.parentThreadId ?? null,
    sidechatSourceThreadId: input.sidechatSourceThreadId ?? null,
  };
}

function makeReadModel(threads: ReadThread[]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: NOW,
    spaces: [],
    projects: [
      {
        id: PROJECT_ID,
        kind: "project",
        title: "Side Chat project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        isPinned: false,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads,
  };
}

function sidechatForkCommand(overrides?: {
  sourceThreadId?: ThreadId;
  sidechatSourceThreadId?: ThreadId;
}) {
  return {
    type: "thread.fork.create" as const,
    commandId: CommandId.makeUnsafe("cmd-create-sidechat"),
    threadId: SIDECHAT_THREAD_ID,
    sourceThreadId: overrides?.sourceThreadId ?? SOURCE_THREAD_ID,
    sidechatSourceThreadId: overrides?.sidechatSourceThreadId ?? SOURCE_THREAD_ID,
    projectId: PROJECT_ID,
    title: "Sidechat: Source",
    modelSelection: { provider: "codex" as const, model: "gpt-5.6-sol" },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required" as const,
    // Deliberately stale workspace metadata. The server must derive the source
    // workspace instead of trusting these values.
    envMode: "local" as const,
    branch: null,
    worktreePath: null,
    workingDirectory: "/tmp/wrong-folder",
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    importedMessages: [],
    createdAt: NOW,
  };
}

function eventThreadIds(result: unknown): ThreadId[] {
  const events = (Array.isArray(result) ? result : [result]) as Omit<
    OrchestrationEvent,
    "sequence"
  >[];
  return events.map((event) => (event.payload as { threadId: ThreadId }).threadId);
}

describe("decider Side Chat integrity", () => {
  it("requires the Side Chat source to match the fork source", async () => {
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: sidechatForkCommand({ sidechatSourceThreadId: OTHER_THREAD_ID }),
          readModel: makeReadModel([makeThread({ id: SOURCE_THREAD_ID })]),
        }),
      ),
    ).rejects.toThrow(
      `Side Chat source '${OTHER_THREAD_ID}' must match fork source '${SOURCE_THREAD_ID}'.`,
    );
  });

  it("rejects a Side Chat whose source is already a Side Chat", async () => {
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: sidechatForkCommand(),
          readModel: makeReadModel([
            makeThread({
              id: SOURCE_THREAD_ID,
              sidechatSourceThreadId: OTHER_THREAD_ID,
            }),
          ]),
        }),
      ),
    ).rejects.toThrow(
      `Side Chat source '${SOURCE_THREAD_ID}' is already a Side Chat. Nested Side Chats are not supported.`,
    );
  });

  it("derives Side Chat workspace metadata from the source thread", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: sidechatForkCommand(),
        readModel: makeReadModel([makeThread({ id: SOURCE_THREAD_ID })]),
      }),
    );
    const event = (Array.isArray(result) ? result : [result])[0];

    expect(event?.type).toBe("thread.created");
    if (!event || event.type !== "thread.created") return;
    expect(event.payload).toMatchObject({
      envMode: "worktree",
      branch: WORKTREE_BRANCH,
      worktreePath: WORKTREE_PATH,
      workingDirectory: null,
      associatedWorktreePath: WORKTREE_PATH,
      associatedWorktreeBranch: WORKTREE_BRANCH,
      associatedWorktreeRef: WORKTREE_BRANCH,
      createBranchFlowCompleted: true,
    });
  });
});

describe("decider Side Chat lifecycle cascade", () => {
  const linkedThreads = (archivedAt?: string) => [
    makeThread({ id: SOURCE_THREAD_ID, ...(archivedAt ? { archivedAt } : {}) }),
    makeThread({
      id: SOURCE_SUBAGENT_ID,
      parentThreadId: SOURCE_THREAD_ID,
      ...(archivedAt ? { archivedAt } : {}),
    }),
    makeThread({
      id: SIDECHAT_THREAD_ID,
      sidechatSourceThreadId: SOURCE_THREAD_ID,
      ...(archivedAt ? { archivedAt } : {}),
    }),
    makeThread({
      id: SIDECHAT_SUBAGENT_ID,
      parentThreadId: SIDECHAT_THREAD_ID,
      ...(archivedAt ? { archivedAt } : {}),
    }),
    makeThread({ id: OTHER_THREAD_ID, ...(archivedAt ? { archivedAt } : {}) }),
  ];

  it("deletes Side Chats before the source without changing subagent deletion behavior", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.delete",
          commandId: CommandId.makeUnsafe("cmd-delete-source"),
          threadId: SOURCE_THREAD_ID,
        },
        readModel: makeReadModel(linkedThreads()),
      }),
    );

    expect(eventThreadIds(result)).toEqual([SIDECHAT_THREAD_ID, SOURCE_THREAD_ID]);
  });

  it("archives Side Chats and both subagent branches before the source receipt", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.archive",
          commandId: CommandId.makeUnsafe("cmd-archive-source"),
          threadId: SOURCE_THREAD_ID,
        },
        readModel: makeReadModel(linkedThreads()),
      }),
    );

    expect(eventThreadIds(result)).toEqual([
      SOURCE_SUBAGENT_ID,
      SIDECHAT_THREAD_ID,
      SIDECHAT_SUBAGENT_ID,
      SOURCE_THREAD_ID,
    ]);
  });

  it("unarchives Side Chats and both subagent branches before the source receipt", async () => {
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.unarchive",
          commandId: CommandId.makeUnsafe("cmd-unarchive-source"),
          threadId: SOURCE_THREAD_ID,
        },
        readModel: makeReadModel(linkedThreads(NOW)),
      }),
    );

    expect(eventThreadIds(result)).toEqual([
      SOURCE_SUBAGENT_ID,
      SIDECHAT_THREAD_ID,
      SIDECHAT_SUBAGENT_ID,
      SOURCE_THREAD_ID,
    ]);
  });
});
