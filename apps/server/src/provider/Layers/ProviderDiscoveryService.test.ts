// FILE: ProviderDiscoveryService.test.ts
// Purpose: Verifies skill discovery delegates to the provider runtime and applies
//          Synara's visibility settings without inventing a second skill catalog.
// Layer: Server provider tests

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type {
  ProviderComposerCapabilities,
  ProviderKind,
  ProviderListModelsResult,
  ProviderListSkillsResult,
} from "@synara/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveServerPaths,
  resolveDefaultChatWorkspaceRoot,
  resolveDefaultStudioWorkspaceRoot,
  ServerConfig,
  type ServerConfigShape,
} from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderDiscoveryService } from "../Services/ProviderDiscoveryService.ts";
import { ProviderDiscoveryServiceLive } from "./ProviderDiscoveryService.ts";

let root: string;
let homeDir: string;
let baseDir: string;
let cwd: string;

const makeConfigLayer = () =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const derived = yield* deriveServerPaths(baseDir, undefined);
      return {
        mode: "web",
        port: 0,
        host: undefined,
        cwd,
        homeDir,
        chatWorkspaceRoot: resolveDefaultChatWorkspaceRoot({ homeDir }),
        studioWorkspaceRoot: resolveDefaultStudioWorkspaceRoot({ homeDir }),
        baseDir,
        ...derived,
        staticDir: undefined,
        devUrl: undefined,
        publicUrl: undefined,
        allowInsecureRemote: false,
        noBrowser: true,
        authToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logProviderEvents: false,
        logWebSocketEvents: false,
      } satisfies ServerConfigShape;
    }),
  );

const makeRegistryLayer = (adapter: Partial<ProviderAdapterShape<ProviderAdapterError>>) =>
  Layer.succeed(ProviderAdapterRegistry, {
    getByProvider: () => Effect.succeed(adapter as ProviderAdapterShape<ProviderAdapterError>),
    listProviders: () => Effect.succeed([]),
  });

const runListSkills = (input: {
  adapter: Partial<ProviderAdapterShape<ProviderAdapterError>>;
  disabled?: string[];
  provider: ProviderKind;
}) => {
  const baseLayer = Layer.mergeAll(
    makeConfigLayer(),
    ServerSettingsService.layerTest({ skills: { disabled: input.disabled ?? [] } }),
    makeRegistryLayer(input.adapter),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  const testLayer = ProviderDiscoveryServiceLive.pipe(Layer.provideMerge(baseLayer));
  const program = Effect.gen(function* () {
    const discovery = yield* ProviderDiscoveryService;
    return yield* discovery.listSkills({ provider: input.provider, cwd });
  }).pipe(Effect.provide(testLayer));
  return Effect.runPromise(
    program as unknown as Effect.Effect<ProviderListSkillsResult, never, never>,
  );
};

const runListModels = (input: {
  adapter: Partial<ProviderAdapterShape<ProviderAdapterError>>;
  enabled: boolean;
}) => {
  const baseLayer = Layer.mergeAll(
    makeConfigLayer(),
    ServerSettingsService.layerTest({
      providers: {
        codex: {
          enabled: input.enabled,
          homePath: path.join(homeDir, ".codex-openrouter"),
          customModels: ["cursor-model", "valid-model", "invalid-model"],
        },
      },
    }),
    makeRegistryLayer(input.adapter),
  ).pipe(Layer.provideMerge(NodeServices.layer));
  const testLayer = ProviderDiscoveryServiceLive.pipe(Layer.provideMerge(baseLayer));
  const program = Effect.gen(function* () {
    const discovery = yield* ProviderDiscoveryService;
    return yield* discovery.listModels({ provider: "codex" });
  }).pipe(Effect.provide(testLayer));
  return Effect.runPromise(
    program as unknown as Effect.Effect<ProviderListModelsResult, never, never>,
  );
};

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "discovery-service-"));
  homeDir = path.join(root, "home");
  baseDir = path.join(homeDir, ".synara");
  cwd = path.join(root, "repo");
  await mkdir(cwd, { recursive: true });
  const openRouterHome = path.join(homeDir, ".codex-openrouter");
  await mkdir(openRouterHome, { recursive: true });
  await writeFile(
    path.join(openRouterHome, "config.toml"),
    [
      'model_provider = "openrouter"',
      "[model_providers.openrouter]",
      'base_url = "https://openrouter.ai/api/v1"',
      'wire_api = "responses"',
      'env_key = "OPENROUTER_API_KEY"',
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ProviderDiscoveryService.listSkills", () => {
  it("returns no skills when the provider has no native discovery", async () => {
    const result = await runListSkills({ adapter: {}, provider: "antigravity" });

    expect(result).toEqual({ skills: [], source: "unsupported", cached: false });
  });

  it("returns only provider-native entries", async () => {
    const nativeShared = {
      name: "shared",
      path: path.join(homeDir, ".codex", "skills", "shared", "SKILL.md"),
      enabled: true,
      scope: "user",
    };
    const result = await runListSkills({
      adapter: {
        listSkills: () =>
          Effect.succeed({ skills: [nativeShared], source: "codex-app-server", cached: false }),
      },
      provider: "codex",
    });

    expect(result).toEqual({
      skills: [nativeShared],
      source: "codex-app-server",
      cached: false,
    });
  });

  it("filters user-disabled skills from native results", async () => {
    const result = await runListSkills({
      adapter: {
        listSkills: () =>
          Effect.succeed({
            skills: [
              { name: "portable", path: "/codex/portable/SKILL.md", enabled: true },
              { name: "muted", path: "/codex/muted/SKILL.md", enabled: true },
            ],
            source: "codex-app-server",
            cached: false,
          }),
      },
      disabled: ["Muted"],
      provider: "codex",
    });

    expect(result.skills.map((skill) => skill.name)).toEqual(["portable"]);
  });

  it("fails closed when native discovery fails", async () => {
    const result = await runListSkills({
      adapter: {
        listSkills: () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: "codex",
              method: "skills/list",
              detail: "codex binary missing",
            }),
          ),
      },
      provider: "codex",
    });

    expect(result).toEqual({
      skills: [],
      source: "provider.discovery.failed",
      cached: false,
    });
  });
});

describe("ProviderDiscoveryService.getComposerCapabilities", () => {
  it("preserves the provider's unsupported skill capabilities", async () => {
    const baseLayer = Layer.mergeAll(
      makeConfigLayer(),
      ServerSettingsService.layerTest(),
      makeRegistryLayer({}),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    const testLayer = ProviderDiscoveryServiceLive.pipe(Layer.provideMerge(baseLayer));

    const program = Effect.gen(function* () {
      const discovery = yield* ProviderDiscoveryService;
      return yield* discovery.getComposerCapabilities({ provider: "grok" });
    }).pipe(Effect.provide(testLayer));
    const capabilities = await Effect.runPromise(
      program as unknown as Effect.Effect<ProviderComposerCapabilities, never, never>,
    );

    expect(capabilities.supportsSkillDiscovery).toBe(false);
    expect(capabilities.supportsSkillMentions).toBe(false);
  });
});

describe("ProviderDiscoveryService.listModels", () => {
  it("does not invoke the adapter for a disabled provider", async () => {
    let adapterCalls = 0;
    const result = await runListModels({
      adapter: {
        listModels: () => {
          adapterCalls += 1;
          return Effect.succeed({
            models: [{ slug: "cursor-model", name: "Cursor Model" }],
            source: "cursor.cli",
            cached: false,
          });
        },
      },
      enabled: false,
    });

    expect(result).toEqual({
      models: [],
      source: "disabled",
      cached: false,
    });
    expect(adapterCalls).toBe(0);
  });

  it("dispatches model discovery for an enabled provider", async () => {
    let adapterCalls = 0;
    let receivedInput: unknown;
    const result = await runListModels({
      adapter: {
        listModels: (input) => {
          adapterCalls += 1;
          receivedInput = input;
          return Effect.succeed({
            models: [{ slug: "cursor-model", name: "Cursor Model" }],
            source: "cursor.cli",
            cached: false,
          });
        },
      },
      enabled: true,
    });

    expect(result.models).toEqual([
      { slug: "cursor-model", name: "Cursor Model" },
      { slug: "valid-model", name: "valid-model" },
      { slug: "invalid-model", name: "invalid-model" },
    ]);
    expect(result.source).toBe("cursor.cli+curated");
    expect(adapterCalls).toBe(1);
    expect(receivedInput).toMatchObject({
      provider: "codex",
      binaryPath: "codex",
      homePath: path.join(homeDir, ".codex-openrouter"),
    });
  });

  it("curates configured slugs for an arbitrary Responses-compatible profile", async () => {
    await writeFile(
      path.join(homeDir, ".codex-openrouter", "config.toml"),
      [
        'model_provider = "acme"',
        "[model_providers.acme]",
        'base_url = "https://models.acme.test/v1"',
        'env_key = "ACME_API_KEY"',
      ].join("\n"),
    );

    const result = await runListModels({
      adapter: {
        listModels: () =>
          Effect.succeed({
            models: [{ slug: "cursor-model", name: "Cursor Model" }],
            source: "codex-app-server",
            cached: false,
          }),
      },
      enabled: true,
    });

    expect(result.models.map((model) => model.slug)).toEqual([
      "cursor-model",
      "valid-model",
      "invalid-model",
    ]);
    expect(result.source).toBe("codex-app-server+curated");
  });

  it("does not curate configured slugs for an explicit non-Responses profile", async () => {
    await writeFile(
      path.join(homeDir, ".codex-openrouter", "config.toml"),
      [
        'model_provider = "chat-host"',
        "[model_providers.chat-host]",
        'base_url = "https://chat.example.test/v1"',
        'wire_api = "chat"',
        'env_key = "CHAT_HOST_KEY"',
      ].join("\n"),
    );

    const result = await runListModels({
      adapter: {
        listModels: () =>
          Effect.succeed({
            models: [{ slug: "native-model", name: "Native Model" }],
            source: "codex-app-server",
            cached: false,
          }),
      },
      enabled: true,
    });

    expect(result).toEqual({
      models: [{ slug: "native-model", name: "Native Model" }],
      source: "codex-app-server",
      cached: false,
    });
  });

  it("repairs malformed configured model descriptors with allowlist metadata", async () => {
    const result = await runListModels({
      adapter: {
        listModels: () =>
          Effect.succeed({
            models: [
              { slug: "valid-model", name: "Valid Model" },
              { slug: "invalid-model", name: " " },
            ],
            source: "cursor.cli",
            cached: false,
          } as ProviderListModelsResult),
      },
      enabled: true,
    });

    expect(result).toEqual({
      models: [
        { slug: "cursor-model", name: "cursor-model" },
        { slug: "valid-model", name: "Valid Model" },
        { slug: "invalid-model", name: "invalid-model" },
      ],
      source: "cursor.cli+curated",
      cached: false,
    });
  });
});
