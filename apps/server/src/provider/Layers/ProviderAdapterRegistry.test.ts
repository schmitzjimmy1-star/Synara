import type { ProviderKind } from "@synara/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { CodexAdapter, CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  ProviderAdapterRegistryCodexOnlyLive,
  ProviderAdapterRegistryLive,
} from "./ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../Errors.ts";

const fakeCodexAdapter: CodexAdapterShape = {
  provider: "codex",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const layer = it.layer(
  Layer.provide(ProviderAdapterRegistryLive, Layer.succeed(CodexAdapter, fakeCodexAdapter)),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByProvider("codex");
      assert.equal(codex, fakeCodexAdapter);

      const providers = yield* registry.listProviders();
      assert.deepEqual(providers, ["codex"]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry.getByProvider("unknown" as ProviderKind).pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});

const codexOnlyLayer = it.layer(
  Layer.provide(
    ProviderAdapterRegistryCodexOnlyLive,
    Layer.succeed(CodexAdapter, fakeCodexAdapter),
  ),
);

codexOnlyLayer("ProviderAdapterRegistryCodexOnlyLive", (it) => {
  it.effect("registers Codex and rejects retired providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      assert.deepEqual(yield* registry.listProviders(), ["codex"]);
      const retired = yield* registry.getByProvider("claudeAgent").pipe(Effect.result);
      assertFailure(retired, new ProviderUnsupportedError({ provider: "claudeAgent" }));
    }),
  );
});
