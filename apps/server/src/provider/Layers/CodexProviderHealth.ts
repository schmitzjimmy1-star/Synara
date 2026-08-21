import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ServerProviderUpdateError, type ServerProviderStatus } from "@synara/contracts";
import { resolveCodexBinary } from "@synara/shared/codexBinary";
import {
  resolveEffectiveCodexProviderEnvKey,
  resolveEffectiveCodexRoute,
} from "@synara/shared/codexConfig";
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

export const probeCodexProviderHealth = Effect.fn("CodexProviderHealth.probe")(function* () {
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings;
  const configuredBinaryPath = settings.providers.codex.binaryPath.trim() || "codex";
  const homePath = settings.providers.codex.homePath.trim();
  const profile = settings.providers.codex.profile.trim();
  const checkedAt = new Date().toISOString();
  const route = yield* Effect.try({
    try: () =>
      resolveEffectiveCodexRoute({
        ...(homePath ? { homePath } : {}),
        ...(profile ? { profile } : {}),
      }),
    catch: (cause) => cause,
  });
  if (route.status === "invalid") {
    return {
      provider: "codex",
      status: "error",
      available: false,
      authStatus: "unknown",
      checkedAt,
      autoRuntimeModeBinaryPath: configuredBinaryPath,
      message: `Codex route is invalid: ${route.detail ?? "the selected profile cannot be used"}`,
    } satisfies ServerProviderStatus;
  }
  const env = yield* Effect.promise(() =>
    buildCodexProcessEnv({
      ...(homePath ? { homePath } : {}),
      ...(profile ? { profile } : {}),
    }),
  );
  const credentialEnvKey =
    route.credentialSource === "env"
      ? resolveEffectiveCodexProviderEnvKey({
          ...(homePath ? { homePath } : {}),
          ...(profile ? { profile } : {}),
        })
      : undefined;
  if (credentialEnvKey && !env[credentialEnvKey]?.trim()) {
    return {
      provider: "codex",
      status: "warning",
      available: false,
      authStatus: "unauthenticated",
      checkedAt,
      autoRuntimeModeBinaryPath: configuredBinaryPath,
      message: `Codex route credential '${credentialEnvKey}' is not available.`,
    } satisfies ServerProviderStatus;
  }

  return yield* Effect.tryPromise({
    try: async () => {
      const resolution = resolveCodexBinary({ configuredPath: configuredBinaryPath, env });
      const output = await execFileAsync(resolution.path, ["--version"], {
        env,
        timeout: 4_000,
      });
      return { ...output, resolution };
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.tap(({ resolution }) =>
      Effect.logInfo("Codex provider health resolved executable", {
        binaryPath: resolution.path,
        source: resolution.source,
      }),
    ),
    Effect.map(({ stdout, stderr, resolution }): ServerProviderStatus => {
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
        // Match the settings identity used by the web capability guard. The
        // resolved absolute path remains visible in the message below.
        autoRuntimeModeBinaryPath: configuredBinaryPath,
        message: `Codex CLI is available at ${resolution.path}${
          resolution.source === "official-app" ? " (official app bundle)" : ""
        }${homePath ? ` through ${homePath}${profile ? ` (profile: ${profile})` : ""}` : ""}.`,
      };
    }),
    Effect.catch((cause) =>
      Effect.succeed({
        provider: "codex",
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt,
        autoRuntimeModeBinaryPath: configuredBinaryPath,
        message: `Codex CLI health check failed: ${cause instanceof Error ? cause.message : String(cause)}.`,
      } satisfies ServerProviderStatus),
    ),
  );
});

const probeCodexSafely = probeCodexProviderHealth().pipe(
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
    // Settings hydrate after layers are constructed. Never execute an
    // unconfigured PATH binary during construction; effectServer performs the
    // first real refresh immediately after persisted settings load.
    const initial: ServerProviderStatus = {
      provider: "codex",
      status: "warning",
      available: false,
      authStatus: "unknown",
      checkedAt: new Date().toISOString(),
      message: "Codex CLI status is loading.",
    };
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
