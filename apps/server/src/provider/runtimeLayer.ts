import { Effect, Layer } from "effect";

import { ServerConfig } from "../config";
import { ServerSettingsLive } from "../serverSettings";
import { makeCodexAdapterLive } from "./Layers/CodexAdapter";
import { makeEventNdjsonLogger } from "./Layers/EventNdjsonLogger";
import { ProviderAdapterRegistryCodexOnlyLive } from "./Layers/ProviderAdapterRegistry";
import { ProviderDiscoveryServiceLive } from "./Layers/ProviderDiscoveryService";
import { makeDurableProviderServiceLive } from "./Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "./Layers/ProviderSessionDirectory";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime";
import { ProviderRuntimeEventRepositoryLive } from "../persistence/Layers/ProviderRuntimeEvents";

export function makeServerProviderLayer() {
  return Effect.gen(function* () {
    const { logProviderEvents, providerEventLogPath } = yield* ServerConfig;
    const nativeEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "native",
        })
      : undefined;
    const canonicalEventLogger = logProviderEvents
      ? yield* makeEventNdjsonLogger(providerEventLogPath, {
          stream: "canonical",
        })
      : undefined;
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const adapterRegistryLayer = ProviderAdapterRegistryCodexOnlyLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerServiceLayer = makeDurableProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(
      Layer.provide(adapterRegistryLayer),
      Layer.provide(providerSessionDirectoryLayer),
      Layer.provide(ProviderRuntimeEventRepositoryLive),
    );
    const providerDiscoveryLayer = ProviderDiscoveryServiceLive.pipe(
      Layer.provide(adapterRegistryLayer),
      // Skill toggles live in server settings; the shared ServerSettingsLive
      // layer is memoized so this reuses the instance built at the top level.
      Layer.provide(ServerSettingsLive),
    );
    return Layer.mergeAll(
      providerServiceLayer,
      providerDiscoveryLayer,
      adapterRegistryLayer,
      providerSessionDirectoryLayer,
    );
  }).pipe(Layer.unwrap);
}
