import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import OS from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseCodexCustomProviderProfile,
  parseCodexConfigActiveProviderEnvKey,
  parseCodexConfigModelProvider,
  parseCodexConfigMcpServerCount,
  parseCodexConfigProviderEnvKey,
  readActiveCodexProviderEnvKey,
  resolveEffectiveCodexRoute,
} from "./codexConfig";

const tempDirs: string[] = [];

function makeTempCodexHome(configContent?: string): string {
  const tempDir = mkdtempSync(join(OS.tmpdir(), "synara-codex-config-"));
  tempDirs.push(tempDir);

  if (configContent !== undefined) {
    writeFileSync(join(tempDir, "config.toml"), configContent, "utf8");
  }

  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("parseCodexConfigMcpServerCount", () => {
  it("counts configured servers without returning their configuration", () => {
    expect(
      parseCodexConfigMcpServerCount(
        [
          "[mcp_servers.docs]",
          'url = "https://example.test/mcp"',
          "[mcp_servers.browser]",
          'command = "browser-secret-command"',
        ].join("\n"),
      ),
    ).toBe(2);
  });

  it("returns zero for malformed configuration", () => {
    expect(parseCodexConfigMcpServerCount("[mcp_servers.invalid")).toBe(0);
  });
});

describe("parseCodexConfigModelProvider", () => {
  it("reads the top-level model provider", () => {
    expect(
      parseCodexConfigModelProvider('model = "gpt-5.3-codex"\nmodel_provider = "azure"\n'),
    ).toBe("azure");
  });

  it("ignores model_provider declarations inside nested sections", () => {
    expect(
      parseCodexConfigModelProvider(
        ["[model_providers.portkey]", 'model_provider = "should-be-ignored"'].join("\n"),
      ),
    ).toBeUndefined();
  });
});

describe("parseCodexConfigProviderEnvKey", () => {
  it("reads env_key from the matching model provider section", () => {
    expect(
      parseCodexConfigProviderEnvKey(
        [
          'model_provider = "portkey"',
          "",
          "[model_providers.portkey]",
          'env_key = "PORTKEY_API_KEY"',
        ].join("\n"),
        "portkey",
      ),
    ).toBe("PORTKEY_API_KEY");
  });

  it("supports quoted provider section names", () => {
    expect(
      parseCodexConfigProviderEnvKey(
        [
          'model_provider = "my-company-proxy"',
          "",
          '[model_providers."my-company-proxy"]',
          'env_key = "MY_COMPANY_PROXY_KEY"',
        ].join("\n"),
        "my-company-proxy",
      ),
    ).toBe("MY_COMPANY_PROXY_KEY");
  });
});

describe("parseCodexCustomProviderProfile", () => {
  it("recognizes a quoted Responses provider using command auth", () => {
    const content = [
      'model_provider = "my-company-proxy"',
      '[model_providers."my-company-proxy"]',
      'base_url = "https://models.example.test/api/v1/"',
      'wire_api = "responses"',
      '[model_providers."my-company-proxy".auth]',
      'command = "security"',
    ].join("\n");

    expect(parseCodexCustomProviderProfile(content)).toEqual({
      provider: "my-company-proxy",
      baseUrl: "https://models.example.test/api/v1",
      wireApi: "responses",
      credentialSource: "command",
    });
  });

  it("uses Responses when wire_api is omitted without changing the source profile", () => {
    const content = [
      'model_provider = "custom"',
      "[model_providers.custom]",
      'base_url = "https://models.example.test/v1/"',
      'env_key = "CUSTOM_API_KEY"',
    ].join("\n");
    const original = content.slice();

    expect(parseCodexCustomProviderProfile(content)).toEqual({
      provider: "custom",
      baseUrl: "https://models.example.test/v1",
      wireApi: "responses",
      credentialSource: "env",
    });
    expect(content).toBe(original);
  });

  it("describes authenticated non-Responses providers without marking them compatible", () => {
    const content = [
      'model_provider = "chat-host"',
      "[model_providers.chat-host]",
      'base_url = "https://chat.example.test/v1"',
      'wire_api = "chat"',
      'env_key = "CHAT_HOST_KEY"',
    ].join("\n");

    expect(parseCodexCustomProviderProfile(content)?.wireApi).toBe("chat");
  });

  it.each([
    ["an insecure endpoint", 'base_url = "http://models.example.test/v1"'],
    ["a URL containing credentials", 'base_url = "https://token@models.example.test/v1"'],
    ["a missing credential source", 'base_url = "https://models.example.test/v1"'],
  ])("fails closed for %s", (_label, baseUrlLine) => {
    expect(
      parseCodexCustomProviderProfile(
        [
          'model_provider = "custom"',
          "[model_providers.custom]",
          baseUrlLine,
          'wire_api = "responses"',
        ].join("\n"),
      ),
    ).toBeUndefined();
  });

  it("fails closed for malformed TOML", () => {
    const content = [
      'model_provider = "custom"',
      "[model_providers.custom",
      'base_url = "https://models.example.test/v1"',
      'env_key = "CUSTOM_API_KEY"',
    ].join("\n");

    expect(parseCodexCustomProviderProfile(content)).toBeUndefined();
    expect(parseCodexConfigModelProvider(content)).toBeUndefined();
  });

  it("fails closed when env and command auth are both configured", () => {
    const content = [
      'model_provider = "custom"',
      "[model_providers.custom]",
      'base_url = "https://models.example.test/v1"',
      'env_key = "CUSTOM_API_KEY"',
      "[model_providers.custom.auth]",
      'command = "security"',
    ].join("\n");

    expect(parseCodexCustomProviderProfile(content)).toBeUndefined();
  });
});

describe("parseCodexConfigActiveProviderEnvKey", () => {
  it("returns the active custom provider env_key", () => {
    expect(
      parseCodexConfigActiveProviderEnvKey(
        [
          'model_provider = "azure"',
          "",
          "[model_providers.azure]",
          'env_key = "AZURE_OPENAI_API_KEY"',
        ].join("\n"),
      ),
    ).toBe("AZURE_OPENAI_API_KEY");
  });

  it("returns undefined for the default openai provider", () => {
    expect(parseCodexConfigActiveProviderEnvKey('model_provider = "openai"\n')).toBeUndefined();
  });
});

describe("resolveEffectiveCodexRoute", () => {
  it("validates an overridden openai provider as a custom route", () => {
    const codexHome = makeTempCodexHome(
      [
        'model_provider = "openai"',
        "[model_providers.openai]",
        'base_url = "http://models.example.test/v1"',
        'env_key = "CUSTOM_API_KEY"',
      ].join("\n"),
    );

    expect(resolveEffectiveCodexRoute({ homePath: codexHome })).toMatchObject({
      status: "invalid",
      provider: "openai",
      kind: "custom-incompatible",
    });
  });

  it("layers a sidecar selection over base provider, MCP, and auth configuration", () => {
    const codexHome = makeTempCodexHome(
      [
        "[mcp_servers.docs]",
        'url = "https://example.test/mcp"',
        "[model_providers.openrouter]",
        'base_url = "https://openrouter.ai/api/v1"',
        'wire_api = "responses"',
        'env_key = "OPENROUTER_API_KEY"',
      ].join("\n"),
    );
    writeFileSync(join(codexHome, "cloud.config.toml"), 'model_provider = "openrouter"\n');

    expect(resolveEffectiveCodexRoute({ homePath: codexHome, profile: "cloud" })).toMatchObject({
      status: "ready",
      provider: "openrouter",
      kind: "custom-responses",
      baseUrl: "https://openrouter.ai/api/v1",
      wireApi: "responses",
      credentialSource: "env",
      configuredMcpServerCount: 1,
      profileConfigPresent: true,
    });
  });

  it.each([
    ["missing profile", undefined, "Profile 'gone' is missing its config file."],
    [
      "insecure endpoint",
      [
        'model_provider = "custom"',
        "[model_providers.custom]",
        'base_url = "http://models.example.test/v1"',
        'env_key = "CUSTOM_API_KEY"',
      ].join("\n"),
      "safe HTTPS endpoint",
    ],
    [
      "two auth authorities",
      [
        'model_provider = "custom"',
        "[model_providers.custom]",
        'base_url = "https://models.example.test/v1"',
        'env_key = "CUSTOM_API_KEY"',
        "[model_providers.custom.auth]",
        'command = "security"',
      ].join("\n"),
      "exactly one credential source",
    ],
    [
      "non-Responses wire API",
      [
        'model_provider = "custom"',
        "[model_providers.custom]",
        'base_url = "https://models.example.test/v1"',
        'wire_api = "chat"',
        'env_key = "CUSTOM_API_KEY"',
      ].join("\n"),
      "requires the Responses wire API",
    ],
  ])("fails closed for %s", (_label, profileContent, expectedDetail) => {
    const codexHome = makeTempCodexHome();
    if (profileContent !== undefined) {
      writeFileSync(join(codexHome, "gone.config.toml"), profileContent);
    }

    const route = resolveEffectiveCodexRoute({ homePath: codexHome, profile: "gone" });
    expect(route.status).toBe("invalid");
    expect(route.detail).toContain(expectedDetail);
  });

  it("fingerprints exact route bytes without returning credentials", () => {
    const codexHome = makeTempCodexHome(
      [
        'model_provider = "custom"',
        "[model_providers.custom]",
        'base_url = "https://models.example.test/v1"',
        'env_key = "CUSTOM_API_KEY"',
      ].join("\n"),
    );
    const first = resolveEffectiveCodexRoute({ homePath: codexHome });
    writeFileSync(join(codexHome, "config.toml"), 'model_provider = "openai"\n');
    const second = resolveEffectiveCodexRoute({ homePath: codexHome });

    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(JSON.stringify(first)).not.toContain("CUSTOM_API_KEY");
  });
});

describe("readActiveCodexProviderEnvKey", () => {
  it("reads the active env_key from CODEX_HOME/config.toml", () => {
    const codexHome = makeTempCodexHome(
      [
        'model_provider = "my-company-proxy"',
        "",
        '[model_providers."my-company-proxy"]',
        'env_key = "MY_COMPANY_PROXY_KEY"',
      ].join("\n"),
    );

    expect(readActiveCodexProviderEnvKey({ CODEX_HOME: codexHome })).toBe("MY_COMPANY_PROXY_KEY");
  });

  it("returns undefined when config.toml is missing", () => {
    const codexHome = makeTempCodexHome();
    expect(readActiveCodexProviderEnvKey({ CODEX_HOME: codexHome })).toBeUndefined();
  });
});
