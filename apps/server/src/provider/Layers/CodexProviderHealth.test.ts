import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerSettingsService } from "../../serverSettings.ts";
import { CodexProviderHealthLive, probeCodexProviderHealth } from "./CodexProviderHealth.ts";

const temporaryDirectories: string[] = [];

function installFakeCodex(version = "codex-cli 0.149.0"): string {
  const directory = mkdtempSync(path.join(tmpdir(), "synara-provider-health-"));
  temporaryDirectories.push(directory);
  const executablePath = path.join(directory, "codex");
  writeFileSync(executablePath, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
  chmodSync(executablePath, 0o755);
  return executablePath;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("probeCodexProviderHealth", () => {
  it("does not execute PATH Codex before persisted settings hydrate", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "synara-provider-health-trap-"));
    temporaryDirectories.push(directory);
    const markerPath = path.join(directory, "executed");
    const trapPath = path.join(directory, "codex");
    writeFileSync(trapPath, `#!/bin/sh\ntouch '${markerPath}'\n`);
    chmodSync(trapPath, 0o755);
    vi.stubEnv("PATH", directory);

    await Effect.runPromise(
      Effect.scoped(
        Layer.build(
          CodexProviderHealthLive.pipe(
            Layer.provide(
              ServerSettingsService.layerTest({ providers: { codex: { binaryPath: "codex" } } }),
            ),
          ),
        ),
      ),
    );

    expect(existsSync(markerPath)).toBe(false);
  });

  it("reports the resolved absolute executable selected by settings", async () => {
    const binaryPath = installFakeCodex();
    const status = await Effect.runPromise(
      probeCodexProviderHealth().pipe(
        Effect.provide(ServerSettingsService.layerTest({ providers: { codex: { binaryPath } } })),
      ) as Effect.Effect<unknown, never, never>,
    );

    expect(status).toMatchObject({
      provider: "codex",
      status: "ready",
      available: true,
      autoRuntimeModeBinaryPath: binaryPath,
    });
  });

  it("fails closed with actionable copy for an invalid explicit executable", async () => {
    const binaryPath = "/definitely-missing/synara-codex";
    const status = await Effect.runPromise(
      probeCodexProviderHealth().pipe(
        Effect.provide(ServerSettingsService.layerTest({ providers: { codex: { binaryPath } } })),
      ) as Effect.Effect<unknown, never, never>,
    );

    expect(status).toMatchObject({
      provider: "codex",
      status: "error",
      available: false,
      autoRuntimeModeBinaryPath: binaryPath,
    });
    expect((status as { message?: string }).message).toContain(
      "configured Codex executable is missing or not executable",
    );
  });

  it("rejects an invalid custom route before executing the Codex binary", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "synara-provider-health-route-"));
    temporaryDirectories.push(directory);
    const markerPath = path.join(directory, "executed");
    const binaryPath = path.join(directory, "codex");
    writeFileSync(binaryPath, `#!/bin/sh\ntouch '${markerPath}'\nprintf 'codex-cli 0.149.0\\n'\n`);
    chmodSync(binaryPath, 0o755);
    writeFileSync(
      path.join(directory, "broken.config.toml"),
      [
        'model_provider = "chat-host"',
        "[model_providers.chat-host]",
        'base_url = "https://chat.example.test/v1"',
        'wire_api = "chat"',
        'env_key = "CHAT_HOST_KEY"',
      ].join("\n"),
    );

    const status = await Effect.runPromise(
      probeCodexProviderHealth().pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            providers: { codex: { binaryPath, homePath: directory, profile: "broken" } },
          }),
        ),
      ) as Effect.Effect<unknown, never, never>,
    );

    expect(status).toMatchObject({ provider: "codex", status: "error", available: false });
    expect((status as { message?: string }).message).toContain("Responses wire API");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("reports an env-auth custom route as unauthenticated when its key is missing", async () => {
    const binaryPath = installFakeCodex();
    const homePath = mkdtempSync(path.join(tmpdir(), "synara-provider-health-auth-"));
    temporaryDirectories.push(homePath);
    writeFileSync(
      path.join(homePath, "cloud.config.toml"),
      [
        'model_provider = "custom"',
        "[model_providers.custom]",
        'base_url = "https://models.example.test/v1"',
        'wire_api = "responses"',
        'env_key = "SYNARA_TEST_MISSING_PROVIDER_KEY"',
      ].join("\n"),
    );
    vi.stubEnv("SYNARA_TEST_MISSING_PROVIDER_KEY", "");

    const status = await Effect.runPromise(
      probeCodexProviderHealth().pipe(
        Effect.provide(
          ServerSettingsService.layerTest({
            providers: { codex: { binaryPath, homePath, profile: "cloud" } },
          }),
        ),
      ) as Effect.Effect<unknown, never, never>,
    );

    expect(status).toMatchObject({
      provider: "codex",
      status: "warning",
      available: false,
      authStatus: "unauthenticated",
    });
  });
});
