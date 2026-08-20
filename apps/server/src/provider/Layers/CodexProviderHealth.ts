import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ServerProviderUpdateError, type ServerProviderStatus } from "@synara/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import { buildCodexProcessEnv } from "../../codexProcessEnv.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  compareCodexCliVersions,
  MINIMUM_CODEX_AUTO_REVIEW_CLI_VERSION,
  parseCodexCliVersion,
} from "../codexCliVersion.ts";
import { ProviderHealth, type ProviderHealthShape } from "../Services/ProviderHealth.ts";

const execFileAsync = promisify(execFile);

const probeCodex = Effect.fn("CodexProviderHealth.probe")(function* () {
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings;
  const binaryPath = settings.providers.codex.binaryPath.trim() || "codex";
  const homePath = settings.providers.codex.homePath.trim();
  const profile = settings.providers.codex.profile.trim();
  const checkedAt = new Date().toISOString();
  const env = yield* Effect.promise(() =>
    buildCodexProcessEnv({
      ...(homePath ? { homePath } : {}),
      prepareOverlay: false,
    }),
  );

  return yield* Effect.tryPromise({
    try: () => execFileAsync(binaryPath, ["--version"], { env, timeout: 4_000 }),
    catch: (cause) => cause,
  }).pipe(
    Effect.map(({ stdout, stderr }): ServerProviderStatus => {
      const version = parseCodexCliVersion(`${stdout}\n${stderr}`);
      return {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "unknown",
        checkedAt,
        ...(version ? { version } : {}),
        supportsAutoRuntimeMode:
          version !== null &&
          compareCodexCliVersions(version, MINIMUM_CODEX_AUTO_REVIEW_CLI_VERSION) >= 0,
        autoRuntimeModeBinaryPath: binaryPath,
        message: homePath
          ? `Codex CLI is available through ${homePath}${profile ? ` (profile: ${profile})` : ""}.`
          : "Codex CLI is available.",
      };
    }),
    Effect.catch((cause) =>
      Effect.succeed({
        provider: "codex",
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        autoRuntimeModeBinaryPath: binaryPath,
        message: `Codex CLI health check failed: ${cause instanceof Error ? cause.message : String(cause)}.`,
      } satisfies ServerProviderStatus),
    ),
  );
});

const probeCodexSafely = probeCodex().pipe(
  Effect.catch((cause) =>
    Effect.succeed({
      provider: "codex",
      status: "error",
      available: false,
      authStatus: "unknown",
      checkedAt: new Date().toISOString(),
      message: `Codex CLI health check failed: ${cause instanceof Error ? cause.message : String(cause)}.`,
    } satisfies ServerProviderStatus),
  ),
);

export const CodexProviderHealthLive = Layer.effect(
  ProviderHealth,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const probe = probeCodexSafely.pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
    );
    const initial = yield* probe;
    const statuses = yield* Ref.make<ReadonlyArray<ServerProviderStatus>>([initial]);
    const changes = yield* PubSub.unbounded<ReadonlyArray<ServerProviderStatus>>();

    const refresh = probe.pipe(
      Effect.map((status) => [status] as const),
      Effect.tap((next) => Ref.set(statuses, next)),
      Effect.tap((next) => PubSub.publish(changes, next)),
    );

    return {
      getStatuses: Ref.get(statuses),
      refresh,
      updateProvider: (input) =>
        Effect.fail(
          new ServerProviderUpdateError({
            provider: input.provider,
            reason: "Provider updates are managed by the Codex CLI installation.",
          }),
        ),
      streamChanges: Stream.fromPubSub(changes),
    } satisfies ProviderHealthShape;
  }),
);
