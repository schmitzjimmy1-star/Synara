// FILE: useProviderModelCatalog.ts
// Purpose: Expose the Codex-owned model and agent catalog to composer-like surfaces.
// Layer: Web hooks

import type {
  ProviderAgentDescriptor,
  ProviderKind,
  ProviderModelDescriptor,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getAppModelOptions, getCustomModelsByProvider, useAppSettings } from "../appSettings";
import { resolveRuntimeModelDescriptor } from "../components/chat/runtimeModelCapabilities";
import {
  isInitialModelDiscoveryPending,
  providerAgentsQueryOptions,
  providerModelsQueryOptions,
} from "../lib/providerDiscoveryReactQuery";
import { serverDiagnosticsQueryOptions } from "../lib/serverReactQuery";
import {
  formatProviderModelOptionName,
  mergeDynamicModelOptions,
  type ProviderModelOption,
} from "../providerModelOptions";

export interface ProviderModelCatalog {
  customModelsByProvider: ReturnType<typeof getCustomModelsByProvider>;
  modelOptionsByProvider: Record<
    ProviderKind,
    ReadonlyArray<ProviderModelOption & { isCustom?: boolean }>
  >;
  loadingModelProviders: Partial<Record<ProviderKind, boolean>>;
  runtimeModelsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelDescriptor>>;
  selectedRuntimeModel: ProviderModelDescriptor | undefined;
  selectedRuntimeAgents: ReadonlyArray<ProviderAgentDescriptor>;
  selectedProviderModelsLoading: boolean;
  selectedProviderRuntimeModelDiscoveryPending: boolean;
}

const EMPTY_MODELS: ReadonlyArray<ProviderModelDescriptor> = [];
const EMPTY_OPTIONS: ReadonlyArray<ProviderModelOption & { isCustom?: boolean }> = [];
const EMPTY_AGENTS: ReadonlyArray<ProviderAgentDescriptor> = [];

export function useProviderModelCatalog(input: {
  selectedProvider: ProviderKind;
  discoveryEnabled: boolean;
  cwd?: string | null;
  modelHintByProvider?: Partial<Record<ProviderKind, string | null>>;
  prefetchProviders?: ReadonlyArray<ProviderKind>;
  agentDiscoveryPolicy?: "selected" | "eager-core";
}): ProviderModelCatalog {
  const { settings, serverSettings } = useAppSettings();
  const customModelsByProvider = useMemo(() => getCustomModelsByProvider(settings), [settings]);
  const codexEnabled = serverSettings?.providers.codex.enabled !== false;
  const discoverCodex =
    codexEnabled &&
    (input.selectedProvider === "codex" ||
      (input.discoveryEnabled && (input.prefetchProviders?.includes("codex") ?? true)));

  const codexModelsQuery = useQuery(
    providerModelsQueryOptions({
      provider: "codex",
      enabled: discoverCodex,
    }),
  );
  const codexAgentsQuery = useQuery(
    providerAgentsQueryOptions({
      provider: "codex",
      enabled:
        codexEnabled &&
        (input.selectedProvider === "codex" ||
          (input.discoveryEnabled && input.agentDiscoveryPolicy === "eager-core")),
    }),
  );

  const codexStaticOptions = useMemo(
    () =>
      getAppModelOptions("codex", customModelsByProvider.codex, input.modelHintByProvider?.codex),
    [customModelsByProvider.codex, input.modelHintByProvider?.codex],
  );
  const configuredCodexRouteCandidate = Boolean(
    settings.codexHomePath.trim().length > 0 || settings.codexProfile.trim().length > 0,
  );
  const codexDiagnosticsQuery = useQuery(
    serverDiagnosticsQueryOptions(discoverCodex && configuredCodexRouteCandidate),
  );
  const effectiveCodexRouteKind = codexDiagnosticsQuery.data?.codex.route.kind;
  // A configured home/profile can still resolve to native OpenAI. Only the
  // server can safely inspect the effective TOML; until it proves that route
  // native, keep the candidate fail-closed to its explicit model allowlist.
  const customCodexRouteConfigured =
    configuredCodexRouteCandidate && effectiveCodexRouteKind !== "openai";
  const codexRouteOptions = useMemo(
    () =>
      customModelsByProvider.codex.map((slug) => ({
        provider: "codex" as const,
        slug,
        name: formatProviderModelOptionName({ provider: "codex", slug }),
        isCustom: true,
      })),
    [customModelsByProvider.codex],
  );
  const codexOptions = useMemo(() => {
    const dynamicModels = codexModelsQuery.data?.models ?? EMPTY_MODELS;
    if (customCodexRouteConfigured) {
      const configuredSlugs = new Set(customModelsByProvider.codex);
      const configuredDynamicModels = dynamicModels.filter((model) =>
        configuredSlugs.has(model.slug),
      );
      return configuredDynamicModels.length > 0
        ? mergeDynamicModelOptions({
            provider: "codex",
            staticOptions: codexRouteOptions,
            dynamicModels: configuredDynamicModels,
          })
        : codexRouteOptions;
    }
    return dynamicModels.length > 0
      ? mergeDynamicModelOptions({
          provider: "codex",
          staticOptions: codexStaticOptions,
          dynamicModels,
        })
      : codexStaticOptions;
  }, [
    codexModelsQuery.data?.models,
    codexRouteOptions,
    codexStaticOptions,
    customCodexRouteConfigured,
    customModelsByProvider.codex,
  ]);

  const modelOptionsByProvider = useMemo<Record<ProviderKind, typeof EMPTY_OPTIONS>>(
    () => ({
      codex: codexOptions,
      claudeAgent: EMPTY_OPTIONS,
      cursor: EMPTY_OPTIONS,
      antigravity: EMPTY_OPTIONS,
      grok: EMPTY_OPTIONS,
      droid: EMPTY_OPTIONS,
      kilo: EMPTY_OPTIONS,
      opencode: EMPTY_OPTIONS,
      pi: EMPTY_OPTIONS,
    }),
    [codexOptions],
  );
  const runtimeModelsByProvider = useMemo<
    Record<ProviderKind, ReadonlyArray<ProviderModelDescriptor>>
  >(
    () => ({
      codex: codexModelsQuery.data?.models ?? EMPTY_MODELS,
      claudeAgent: EMPTY_MODELS,
      cursor: EMPTY_MODELS,
      antigravity: EMPTY_MODELS,
      grok: EMPTY_MODELS,
      droid: EMPTY_MODELS,
      kilo: EMPTY_MODELS,
      opencode: EMPTY_MODELS,
      pi: EMPTY_MODELS,
    }),
    [codexModelsQuery.data?.models],
  );

  const codexDiscoveryPending =
    discoverCodex &&
    (codexModelsQuery.data?.models.length ?? 0) === 0 &&
    isInitialModelDiscoveryPending(codexModelsQuery);
  const loadingModelProviders = useMemo<Partial<Record<ProviderKind, boolean>>>(
    () => ({ codex: codexDiscoveryPending }),
    [codexDiscoveryPending],
  );
  const selectedRuntimeModel = useMemo(
    () =>
      resolveRuntimeModelDescriptor({
        provider: input.selectedProvider,
        model: input.modelHintByProvider?.[input.selectedProvider] ?? null,
        runtimeModels: runtimeModelsByProvider[input.selectedProvider],
      }),
    [input.modelHintByProvider, input.selectedProvider, runtimeModelsByProvider],
  );
  const selectedRuntimeAgents = useMemo<ReadonlyArray<ProviderAgentDescriptor>>(
    () =>
      input.selectedProvider === "codex"
        ? (codexAgentsQuery.data?.agents ?? EMPTY_AGENTS).map((agent) =>
            agent.description
              ? {
                  name: agent.name,
                  displayName: agent.displayName,
                  description: agent.description,
                }
              : { name: agent.name, displayName: agent.displayName },
          )
        : EMPTY_AGENTS,
    [codexAgentsQuery.data?.agents, input.selectedProvider],
  );

  const selectedProviderModelsLoading =
    input.selectedProvider === "codex" &&
    (codexDiscoveryPending ||
      codexModelsQuery.isLoading ||
      (codexModelsQuery.isFetching && codexModelsQuery.data === undefined));
  const selectedProviderRuntimeModelDiscoveryPending =
    input.selectedProvider === "codex" && codexDiscoveryPending;

  return useMemo(
    () => ({
      customModelsByProvider,
      modelOptionsByProvider,
      loadingModelProviders,
      runtimeModelsByProvider,
      selectedRuntimeModel,
      selectedRuntimeAgents,
      selectedProviderModelsLoading,
      selectedProviderRuntimeModelDiscoveryPending,
    }),
    [
      customModelsByProvider,
      loadingModelProviders,
      modelOptionsByProvider,
      runtimeModelsByProvider,
      selectedProviderModelsLoading,
      selectedProviderRuntimeModelDiscoveryPending,
      selectedRuntimeAgents,
      selectedRuntimeModel,
    ],
  );
}
