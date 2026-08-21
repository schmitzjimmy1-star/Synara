// FILE: providerModelPrefetch.test.ts
// Purpose: Verify new-thread warming stays on the single Codex runtime boundary.
// Layer: Web lib tests

import { DEFAULT_SERVER_SETTINGS, type ProviderKind } from "@synara/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NEW_THREAD_MODEL_PREFETCH_PROVIDERS,
  NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS,
  prefetchModelsForNewThread,
  prefetchProviderModelsForNewThread,
} from "./providerModelPrefetch";
import { providerDiscoveryQueryKeys } from "./providerDiscoveryReactQuery";

afterEach(() => {
  vi.restoreAllMocks();
});

function discoveryCalls(prefetchQuery: { mock: { calls: unknown[][] } }): unknown[][] {
  return prefetchQuery.mock.calls.map((call) => {
    const options = call[0] as { queryKey: unknown[] };
    return options.queryKey;
  });
}

describe("prefetchProviderModelsForNewThread", () => {
  it("warms only Codex models, agents, and composer capabilities", () => {
    const queryClient = new QueryClient();
    const prefetchQuery = vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);

    prefetchProviderModelsForNewThread(queryClient, {
      providers: ["codex", "claudeAgent", "cursor", "grok", "droid"] as ProviderKind[],
    });

    const calls = prefetchQuery.mock.calls.map((call) => call[0]);
    const keys = discoveryCalls(prefetchQuery);
    expect(keys).toEqual([
      providerDiscoveryQueryKeys.models("codex", null, null, null, null),
      providerDiscoveryQueryKeys.agents("codex", null, null),
      providerDiscoveryQueryKeys.composerCapabilities("codex"),
    ]);
    for (const options of calls) {
      expect(options.retry).toBe(0);
      expect(options.gcTime).toBe(NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS);
    }
    expect(calls[0]?.staleTime).toBe(NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS);
    expect(calls[1]?.staleTime).toBe(NEW_THREAD_MODEL_PREFETCH_STALE_TIME_MS);
  });

  it("does nothing when an explicit subset omits Codex", () => {
    const queryClient = new QueryClient();
    const prefetchQuery = vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);

    prefetchProviderModelsForNewThread(queryClient, {
      providers: ["claudeAgent", "droid"],
    });

    expect(prefetchQuery).not.toHaveBeenCalled();
  });
});

describe("prefetchModelsForNewThread", () => {
  it("declares Codex as the only production warm target", () => {
    expect(NEW_THREAD_MODEL_PREFETCH_PROVIDERS).toEqual(["codex"]);
  });

  it("warms Codex regardless of a historical non-Codex default", () => {
    const queryClient = new QueryClient();
    const prefetchQuery = vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);

    prefetchModelsForNewThread(queryClient, {
      serverSettings: DEFAULT_SERVER_SETTINGS,
    });

    expect(discoveryCalls(prefetchQuery)).toHaveLength(3);
    expect(discoveryCalls(prefetchQuery)[0]).toEqual(
      providerDiscoveryQueryKeys.models("codex", null, null, null, null),
    );
  });

  it("does not warm a disabled Codex runtime", () => {
    const queryClient = new QueryClient();
    const prefetchQuery = vi.spyOn(queryClient, "prefetchQuery").mockResolvedValue(undefined);

    prefetchModelsForNewThread(queryClient, {
      serverSettings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: { ...DEFAULT_SERVER_SETTINGS.providers.codex, enabled: false },
        },
      },
    });

    expect(prefetchQuery).not.toHaveBeenCalled();
  });
});
