// FILE: providerModelPrefetch.ts
// Purpose: Warm provider model discovery and composer capabilities into the
//          React Query cache before a new thread mounts ChatView, so the
//          composer can skip the "Loading models" skeleton and capability
//          round-trips on the common new-thread path.
// Layer: Web lib
// Exports: resolve + prefetch helpers that mirror ChatView's listModels query keys.

import type { ProviderKind, ServerSettings } from "@synara/contracts";
import type { QueryClient } from "@tanstack/react-query";

import {
  providerAgentsQueryOptions,
  providerComposerCapabilitiesQueryOptions,
  providerModelsQueryOptions,
} from "./providerDiscoveryReactQuery";

/** Codex is the sole runtime owner; external model hosts remain Codex routes. */
export const NEW_THREAD_MODEL_PREFETCH_PROVIDERS = ["codex"] as const;

/** Warm results stay fresh for 30 minutes instead of the interactive 60s. */
export const NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS = 30 * 60_000;

export function prefetchProviderModelsForNewThread(
  queryClient: QueryClient,
  input: {
    providers?: ReadonlyArray<ProviderKind>;
  },
): void {
  const shouldPrefetchCodex = (input.providers ?? NEW_THREAD_MODEL_PREFETCH_PROVIDERS).includes(
    "codex",
  );
  if (shouldPrefetchCodex) {
    void queryClient.prefetchQuery({
      ...providerModelsQueryOptions({ provider: "codex" }),
      retry: 0,
      staleTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
      gcTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
    });

    // Agent/mode lists ride along for providers that surface them next to models.
    void queryClient.prefetchQuery({
      ...providerAgentsQueryOptions({ provider: "codex" }),
      retry: 0,
      staleTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
      gcTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
    });

    // Composer capabilities gate composer affordances on ChatView mount; the query
    // has staleTime Infinity, so this costs one IPC per provider per session.
    // retry: 0 keeps a failing capabilities probe from multiplying per hover —
    // ChatView's own mount query still retries by its defaults if it refetches.
    void queryClient.prefetchQuery({
      ...providerComposerCapabilitiesQueryOptions("codex"),
      retry: 0,
      gcTime: NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
    });
  }
}

/** Warm the one Codex-owned catalog used by native and custom model routes. */
export function prefetchModelsForNewThread(
  queryClient: QueryClient,
  input: {
    serverSettings?: ServerSettings | null;
  },
): void {
  if (input.serverSettings?.providers.codex.enabled === false) {
    return;
  }

  prefetchProviderModelsForNewThread(queryClient, {
    providers: NEW_THREAD_MODEL_PREFETCH_PROVIDERS,
  });
}
