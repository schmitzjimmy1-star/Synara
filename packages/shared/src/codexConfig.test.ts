import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import OS from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isOpenRouterCodexConfig,
  isCodexResponsesProviderConfig,
  parseCodexCustomProviderProfile,
  parseCodexConfigActiveProviderEnvKey,
  parseCodexConfigModelProvider,
  parseCodexConfigProviderEnvKey,
  readActiveCodexProviderEnvKey,
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

describe("isOpenRouterCodexConfig", () => {
  const valid = [
    'model_provider = "openrouter"',
    "",
    "[model_providers.openrouter]",
    'base_url = "https://openrouter.ai/api/v1/"',
    'wire_api = "responses"',
    'env_key = "OPENROUTER_API_KEY"',
  ].join("\n");

  it("accepts a scoped Responses provider with an optional trailing slash", () => {
    expect(isOpenRouterCodexConfig(valid)).toBe(true);
  });

  it("does not borrow wire_api or auth from an unrelated section", () => {
    expect(
      isOpenRouterCodexConfig(
        [
          'model_provider = "openrouter"',
          "[model_providers.openrouter]",
          'base_url = "https://openrouter.ai/api/v1"',
          "[model_providers.other]",
          'wire_api = "responses"',
          'env_key = "OPENROUTER_API_KEY"',
        ].join("\n"),
      ),
    ).toBe(false);
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
    expect(isCodexResponsesProviderConfig(content)).toBe(true);
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
    expect(isCodexResponsesProviderConfig(content)).toBe(false);
  });

  it.each([
    ["an insecure endpoint", 'base_url = "http://models.example.test/v1"'],
    ["a URL containing credentials", 'base_url = "https://token@models.example.test/v1"'],
    ["a missing credential source", 'base_url = "https://models.example.test/v1"'],
  ])("fails closed for %s", (_label, baseUrlLine) => {
    expect(
      parseCodexCustomProviderProfile(
        ['model_provider = "custom"', "[model_providers.custom]", baseUrlLine, 'wire_api = "responses"'].join(
          "\n",
        ),
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
    expect(isCodexResponsesProviderConfig(content)).toBe(false);
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
