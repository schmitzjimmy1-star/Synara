import {
  DEFAULT_SERVER_SETTINGS,
  type ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListCommandsInput,
  ProviderListModelsInput,
  type ProviderListModelsResult,
  ProviderListPluginsInput,
  ProviderModelDescriptor,
  ProviderListSkillsInput,
  type ProviderListSkillsResult,
  ProviderReadPluginInput,
} from "@synara/contracts";
import { isOpenRouterCodexConfig } from "@synara/shared/codexConfig";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option, Schema, SchemaIssue } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderValidationError } from "../Errors.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  ProviderDiscoveryService,
  type ProviderDiscoveryServiceShape,
} from "../Services/ProviderDiscoveryService.ts";

function filterDisabledSkills(
  skills: ReadonlyArray<ProviderListSkillsResult["skills"][number]>,
  disabledNames: ReadonlyArray<string>,
): ProviderListSkillsResult["skills"] {
  if (disabledNames.length === 0) return [...skills];
  const disabled = new Set(disabledNames.map((name) => name.trim().toLowerCase()));
  return skills.filter((skill) => !disabled.has(skill.name.trim().toLowerCase()));
}

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

const disabledCapabilitiesForProvider = (
  provider: ProviderComposerCapabilities["provider"],
): ProviderComposerCapabilities => ({
  provider,
  supportsSkillMentions: false,
  supportsSkillDiscovery: false,
  supportsNativeSlashCommandDiscovery: false,
  supportsPluginMentions: false,
  supportsPluginDiscovery: false,
  supportsRuntimeModelList: false,
  supportsThreadCompaction: false,
  supportsThreadImport: false,
});

const decodeProviderModelDescriptorOption = Schema.decodeUnknownOption(ProviderModelDescriptor);

async function isValidatedOpenRouterHome(homePath: string, profile: string): Promise<boolean> {
  try {
    const resolvedHome = homePath || process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
    const configName = profile ? `${profile}.config.toml` : "config.toml";
    return isOpenRouterCodexConfig(await readFile(join(resolvedHome, configName), "utf8"));
  } catch {
    return false;
  }
}

function isolateMalformedModelDescriptors(input: {
  readonly provider: ProviderListModelsInput["provider"];
  readonly result: ProviderListModelsResult;
}): Effect.Effect<ProviderListModelsResult> {
  const models = input.result.models.flatMap((model) => {
    const decoded = decodeProviderModelDescriptorOption(model);
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
  const omittedCount = input.result.models.length - models.length;
  if (omittedCount === 0) {
    return Effect.succeed(input.result);
  }
  return Effect.logWarning("provider model discovery omitted malformed descriptors", {
    provider: input.provider,
    source: input.result.source ?? "unknown",
    omittedCount,
  }).pipe(
    Effect.as({
      ...input.result,
      models,
    }),
  );
}

function configuredModelFallback(slug: string) {
  const separatorIndex = slug.indexOf("/");
  if (separatorIndex <= 0) {
    return { slug, name: slug };
  }
  const upstreamProviderId = slug.slice(0, separatorIndex);
  const upstreamProviderName =
    upstreamProviderId === "openai"
      ? "OpenAI"
      : upstreamProviderId === "deepseek"
        ? "DeepSeek"
        : upstreamProviderId === "qwen"
          ? "Qwen"
          : `${upstreamProviderId.slice(0, 1).toUpperCase()}${upstreamProviderId.slice(1)}`;

  return {
    slug,
    name: slug,
    upstreamProviderId,
    upstreamProviderName,
  };
}

const make = Effect.gen(function* () {
  const registry = yield* ProviderAdapterRegistry;
  const serverSettings = yield* ServerSettingsService;

  const getComposerCapabilities: ProviderDiscoveryServiceShape["getComposerCapabilities"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.getComposerCapabilities",
        schema: ProviderGetComposerCapabilitiesInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      const capabilities = adapter.getComposerCapabilities
        ? yield* adapter.getComposerCapabilities()
        : disabledCapabilitiesForProvider(parsed.provider);
      return capabilities;
    });

  const listSkills: ProviderDiscoveryServiceShape["listSkills"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listSkills",
        schema: ProviderListSkillsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      const nativeResult: ProviderListSkillsResult = adapter.listSkills
        ? yield* adapter.listSkills(parsed).pipe(
            Effect.catch((error) =>
              Effect.logWarning("provider-native skill discovery failed", {
                provider: parsed.provider,
                error,
              }).pipe(
                Effect.as({ skills: [], source: "provider.discovery.failed", cached: false }),
              ),
            ),
          )
        : { skills: [], source: "unsupported", cached: false };
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
      );
      return {
        ...nativeResult,
        skills: filterDisabledSkills(nativeResult.skills, settings.skills.disabled),
      } satisfies ProviderListSkillsResult;
    });

  const listCommands: ProviderDiscoveryServiceShape["listCommands"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listCommands",
        schema: ProviderListCommandsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listCommands) {
        return {
          commands: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listCommands(parsed);
    });

  const listPlugins: ProviderDiscoveryServiceShape["listPlugins"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listPlugins",
        schema: ProviderListPluginsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listPlugins) {
        return {
          marketplaces: [],
          marketplaceLoadErrors: [],
          remoteSyncError: null,
          featuredPluginIds: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listPlugins(parsed);
    });

  const readPlugin: ProviderDiscoveryServiceShape["readPlugin"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.readPlugin",
        schema: ProviderReadPluginInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.readPlugin) {
        return yield* new ProviderValidationError({
          operation: "ProviderDiscoveryService.readPlugin",
          issue: `Plugin discovery is unavailable for provider '${parsed.provider}'.`,
        });
      }
      return yield* adapter.readPlugin(parsed);
    });

  const listModels: ProviderDiscoveryServiceShape["listModels"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listModels",
        schema: ProviderListModelsInput,
        payload: input,
      });
      // The enabled check is a short-circuit, not a precondition, and
      // ServerSettingsError is outside this operation's error channel. An
      // unreadable settings file falls back to discovering models, which is
      // what this call did before the gate existed.
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (settings !== null && !settings.providers[parsed.provider].enabled) {
        return {
          models: [],
          source: "disabled",
          cached: false,
        };
      }
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listModels) {
        return {
          models: [],
          source: "unsupported",
          cached: false,
        };
      }
      const discovered = yield* adapter.listModels(
        parsed.provider === "codex" && settings !== null
          ? {
              ...parsed,
              binaryPath: settings.providers.codex.binaryPath,
              ...(settings.providers.codex.homePath
                ? { homePath: settings.providers.codex.homePath }
                : {}),
              ...(settings.providers.codex.profile
                ? { profile: settings.providers.codex.profile }
                : {}),
            }
          : parsed,
      );
      const configuredModels = settings?.providers[parsed.provider].customModels ?? [];
      const configuredModelSet = new Set(configuredModels);
      const shouldCurateCodexModels =
        parsed.provider === "codex" &&
        settings !== null &&
        (settings.providers.codex.homePath.trim().length > 0 ||
          settings.providers.codex.profile.trim().length > 0) &&
        configuredModelSet.size > 0 &&
        (yield* Effect.promise(() =>
          isValidatedOpenRouterHome(
            settings.providers.codex.homePath.trim(),
            settings.providers.codex.profile.trim(),
          ),
        ));
      const result = shouldCurateCodexModels
        ? (() => {
            const discoveredBySlug = new Map(
              discovered.models.map((model) => [model.slug, model] as const),
            );
            return {
              ...discovered,
              // Codex's built-in model/list catalog does not necessarily know
              // every slug accepted by a custom provider. The configured list
              // is the OpenRouter allowlist and therefore the source of truth;
              // preserve live capability metadata when Codex has it, then add
              // a minimal descriptor for every configured provider/model slug.
              models: configuredModels.map((slug) => {
                const discoveredModel = discoveredBySlug.get(slug);
                if (discoveredModel) {
                  const decoded = decodeProviderModelDescriptorOption(discoveredModel);
                  if (Option.isSome(decoded)) return decoded.value;
                }
                return configuredModelFallback(slug);
              }),
              source: `${discovered.source ?? "codex"}+curated`,
            };
          })()
        : discovered;
      return yield* isolateMalformedModelDescriptors({
        provider: parsed.provider,
        result,
      });
    });

  const listAgents: ProviderDiscoveryServiceShape["listAgents"] = (input) =>
    Effect.gen(function* () {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderDiscoveryService.listAgents",
        schema: ProviderListAgentsInput,
        payload: input,
      });
      const adapter = yield* registry.getByProvider(parsed.provider);
      if (!adapter.listAgents) {
        return {
          agents: [],
          source: "unsupported",
          cached: false,
        };
      }
      return yield* adapter.listAgents(parsed);
    });

  return {
    getComposerCapabilities,
    listCommands,
    listSkills,
    listPlugins,
    readPlugin,
    listModels,
    listAgents,
  } satisfies ProviderDiscoveryServiceShape;
});

export const ProviderDiscoveryServiceLive = Layer.effect(ProviderDiscoveryService, make);
