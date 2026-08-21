import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CodexServerProviderSettings, ProviderSession } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildCodexRuntimeDiagnostics } from "./runtimeDiagnostics";

const tempDirs: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "synara-runtime-diagnostics-"));
  tempDirs.push(home);
  return home;
}

function settings(homePath: string, profile = ""): CodexServerProviderSettings {
  return {
    enabled: true,
    binaryPath: process.execPath,
    homePath,
    profile,
    customModels: [],
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("buildCodexRuntimeDiagnostics", () => {
  it("reports a Responses route and aggregate session evidence without credentials", async () => {
    const home = makeHome();
    writeFileSync(
      path.join(home, "config.toml"),
      [
        "[mcp_servers.docs]",
        'url = "https://example.test/mcp"',
        "[model_providers.openrouter]",
        'base_url = "https://openrouter.ai/api/v1"',
        'wire_api = "responses"',
        'env_key = "OPENROUTER_API_KEY"',
      ].join("\n"),
    );
    writeFileSync(path.join(home, "cloud.config.toml"), 'model_provider = "openrouter"\n');
    const session = {
      provider: "codex",
      status: "running",
      model: "openai/gpt-5.6-sol",
    } as ProviderSession;

    const result = await buildCodexRuntimeDiagnostics({
      settings: settings(home, "cloud"),
      sessions: [session],
      env: { ...process.env, OPENROUTER_API_KEY: "never-return-this" },
    });

    expect(result.binary).toMatchObject({ status: "ready", source: "explicit" });
    expect(result.route).toEqual({
      status: "ready",
      provider: "openrouter",
      kind: "custom-responses",
      baseUrl: "https://openrouter.ai/api/v1",
      wireApi: "responses",
      credentialSource: "env",
    });
    expect(result.configuredMcpServerCount).toBe(1);
    expect(result.activeSessions).toEqual({
      totalCount: 1,
      runningCount: 1,
      models: [{ model: "openai/gpt-5.6-sol", count: 1 }],
    });
    expect(JSON.stringify(result)).not.toContain("never-return-this");
  });

  it("fails the route truthfully when the selected profile is missing", async () => {
    const home = makeHome();
    writeFileSync(path.join(home, "config.toml"), 'model_provider = "openai"\n');

    const result = await buildCodexRuntimeDiagnostics({
      settings: settings(home, "gone"),
      sessions: [],
    });

    expect(result.profileConfigPresent).toBe(false);
    expect(result.route).toMatchObject({
      status: "invalid",
      kind: "unknown",
      detail: "Profile 'gone' is missing its config file.",
    });
  });
});
