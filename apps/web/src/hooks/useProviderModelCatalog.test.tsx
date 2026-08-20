// FILE: useProviderModelCatalog.test.tsx
// Purpose: Locks the shared provider-model catalog's memoization and discovery policy.
// Layer: Web hook tests

import {
  DEFAULT_SERVER_SETTINGS,
  type ProviderKind,
  type ProviderModelDescriptor,
} from "@synara/contracts";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderModelCatalog } from "./useProviderModelCatalog";
import { useProviderModelCatalog } from "./useProviderModelCatalog";

const mocks = vi.hoisted(() => ({
  useAppSettings: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: mocks.useQuery };
});

vi.mock("../appSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../appSettings")>();
  return { ...actual, useAppSettings: mocks.useAppSettings };
});

interface QueryOptionsLike {
  readonly queryKey: readonly unknown[];
  readonly enabled?: boolean;
}

interface QueryResultLike {
  readonly data?: {
    readonly agents?: ReadonlyArray<{ name: string; displayName: string }>;
    readonly cached?: boolean;
    readonly models?: ReadonlyArray<ProviderModelDescriptor>;
    readonly source?: string;
  };
  readonly isFetching: boolean;
  readonly isLoading: boolean;
  readonly isPlaceholderData: boolean;
}

const EMPTY_QUERY: QueryResultLike = {
  isFetching: false,
  isLoading: false,
  isPlaceholderData: false,
};
const modelQueries = new Map<ProviderKind, QueryResultLike>();
const agentQueries = new Map<ProviderKind, QueryResultLike>();
const MODEL_HINTS = { codex: "openai/gpt-5.6-sol" } as const;
const SETTINGS = {
  antigravityBinaryPath: "",
  cursorApiEndpoint: "",
  cursorBinaryPath: "",
  customAntigravityModels: [],
  customClaudeModels: [],
  customCodexModels: ["openrouter/custom-model"],
  customCursorModels: ["cursor-custom"],
  customDroidModels: [],
  customGrokModels: [],
  customKiloModels: [],
  customOpenCodeModels: [],
  customPiModels: [],
  droidBinaryPath: "",
  grokBinaryPath: "",
  hiddenProviders: [],
  kiloBinaryPath: "",
  openCodeBinaryPath: "",
  piAgentDir: "",
  piBinaryPath: "",
};

function readCatalogRenders(
  input: Parameters<typeof useProviderModelCatalog>[0],
): ProviderModelCatalog[] {
  const results: ProviderModelCatalog[] = [];

  function Probe() {
    const [renderIndex, setRenderIndex] = useState(0);
    results.push(useProviderModelCatalog(input));
    if (renderIndex === 0) {
      setRenderIndex(1);
    }
    return null;
  }

  renderToStaticMarkup(<Probe />);
  expect(results).toHaveLength(2);
  return results;
}

function readAgentQueryEnabled(provider: ProviderKind): boolean | undefined {
  const call = mocks.useQuery.mock.calls.find(([value]) => {
    const queryKey = (value as QueryOptionsLike).queryKey;
    return queryKey[1] === "agents" && queryKey[2] === provider;
  });
  return call ? (call[0] as QueryOptionsLike).enabled : undefined;
}

function readModelQueryEnabled(provider: ProviderKind): boolean | undefined {
  const call = mocks.useQuery.mock.calls.find(([value]) => {
    const queryKey = (value as QueryOptionsLike).queryKey;
    return queryKey[1] === "models" && queryKey[2] === provider;
  });
  return call ? (call[0] as QueryOptionsLike).enabled : undefined;
}

beforeEach(() => {
  modelQueries.clear();
  agentQueries.clear();
  mocks.useAppSettings
    .mockReset()
    .mockReturnValue({ settings: SETTINGS, serverSettings: DEFAULT_SERVER_SETTINGS });
  mocks.useQuery.mockReset().mockImplementation((value: QueryOptionsLike) => {
    const [, resource, provider] = value.queryKey;
    if (resource === "models") {
      return modelQueries.get(provider as ProviderKind) ?? EMPTY_QUERY;
    }
    if (resource === "agents") {
      return agentQueries.get(provider as ProviderKind) ?? EMPTY_QUERY;
    }
    throw new Error(`Unexpected provider catalog query: ${String(resource)}`);
  });
});

describe("useProviderModelCatalog", () => {
  it("keeps aggregate identities stable when inputs and query data are unchanged", () => {
    const [first, second] = readCatalogRenders({
      selectedProvider: "codex",
      discoveryEnabled: true,
      modelHintByProvider: MODEL_HINTS,
    });

    expect(second).toBe(first);
    expect(second?.customModelsByProvider).toBe(first?.customModelsByProvider);
    expect(second?.modelOptionsByProvider).toBe(first?.modelOptionsByProvider);
    expect(second?.loadingModelProviders).toBe(first?.loadingModelProviders);
    expect(second?.runtimeModelsByProvider).toBe(first?.runtimeModelsByProvider);
    expect(second?.selectedRuntimeAgents).toBe(first?.selectedRuntimeAgents);
  });

  it("only creates Codex discovery queries", () => {
    readCatalogRenders({ selectedProvider: "cursor", discoveryEnabled: false });
    expect(readAgentQueryEnabled("codex")).toBe(false);
    expect(readModelQueryEnabled("codex")).toBe(false);
    expect(readAgentQueryEnabled("cursor")).toBeUndefined();
    expect(readModelQueryEnabled("cursor")).toBeUndefined();
  });

  it("discovers Codex when selected or eagerly requested", () => {
    readCatalogRenders({ selectedProvider: "codex", discoveryEnabled: false });
    expect(readModelQueryEnabled("codex")).toBe(true);
    expect(readAgentQueryEnabled("codex")).toBe(true);

    mocks.useQuery.mockClear();
    readCatalogRenders({
      selectedProvider: "cursor",
      discoveryEnabled: true,
      agentDiscoveryPolicy: "eager-core",
    });
    expect(readModelQueryEnabled("codex")).toBe(true);
    expect(readAgentQueryEnabled("codex")).toBe(true);
  });

  it("does not discover Codex when it is disabled", () => {
    mocks.useAppSettings.mockReturnValue({
      settings: SETTINGS,
      serverSettings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            enabled: false,
          },
        },
      },
    });

    readCatalogRenders({ selectedProvider: "codex", discoveryEnabled: true });

    expect(readModelQueryEnabled("codex")).toBe(false);
    expect(readAgentQueryEnabled("codex")).toBe(false);
  });

  it("keeps discovering while the server settings are unavailable", () => {
    mocks.useAppSettings.mockReturnValue({ settings: SETTINGS, serverSettings: undefined });

    readCatalogRenders({ selectedProvider: "codex", discoveryEnabled: true });

    expect(readModelQueryEnabled("codex")).toBe(true);
    expect(readAgentQueryEnabled("codex")).toBe(true);
  });

  it("respects a prefetch list that omits Codex", () => {
    readCatalogRenders({
      selectedProvider: "cursor",
      discoveryEnabled: true,
      prefetchProviders: ["kilo", "opencode"],
    });

    expect(readModelQueryEnabled("codex")).toBe(false);
  });

  it("merges the Codex runtime catalog with configured model slugs", () => {
    modelQueries.set("codex", {
      data: {
        models: [{ slug: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" }],
        source: "codex.app-server",
        cached: false,
      },
      isFetching: true,
      isLoading: false,
      isPlaceholderData: true,
    });

    const catalog = readCatalogRenders({
      selectedProvider: "codex",
      discoveryEnabled: true,
      modelHintByProvider: MODEL_HINTS,
    }).at(-1);

    expect(catalog?.modelOptionsByProvider.codex.map((model) => model.slug)).toEqual([
      "openai/gpt-5.6-sol",
      "openrouter/custom-model",
    ]);
    expect(catalog?.modelOptionsByProvider.cursor).toEqual([]);
    expect(catalog?.loadingModelProviders.codex).toBe(false);
    expect(catalog?.selectedProviderModelsLoading).toBe(false);
    expect(catalog?.runtimeModelsByProvider.codex).toEqual([
      { slug: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
    ]);
  });
});
