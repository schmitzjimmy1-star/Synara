import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyCodexProfileLayer,
  buildCodexProcessEnv,
  linkOrCopyCodexOverlayEntry,
  prioritizeCodexOverlayEntries,
} from "./codexProcessEnv";
import { isProviderCredentialKey } from "./providerChildEnvironment.ts";

describe("applyCodexProfileLayer", () => {
  it("overrides inference settings while preserving base MCP and plugin configuration", () => {
    const layered = applyCodexProfileLayer(
      [
        'model = "gpt-5.5"',
        'model_provider = "openai"',
        "",
        "[mcp_servers.docs]",
        'url = "https://developers.openai.com/mcp"',
        "",
        '[plugins."computer-history@openai-bundled"]',
        "enabled = true",
      ].join("\n"),
      [
        'model = "openai/gpt-5.6-sol"',
        'model_provider = "openrouter"',
        "",
        "[model_providers.openrouter]",
        'base_url = "https://openrouter.ai/api/v1"',
        'wire_api = "responses"',
      ].join("\n"),
    );

    expect(layered).toContain('model = "openai/gpt-5.6-sol"');
    expect(layered).toContain('model_provider = "openrouter"');
    expect(layered).toContain("[mcp_servers.docs]");
    expect(layered).toContain('[plugins."computer-history@openai-bundled"]');
    expect(layered).toContain("[model_providers.openrouter]");
    expect(layered).not.toContain('model = "gpt-5.5"');
  });
});

describe("linkOrCopyCodexOverlayEntry", () => {
  it("copies auth.json when symlink creation is unavailable", async () => {
    const symlink = vi.fn(async () => {
      throw new Error("symlinks unavailable");
    });
    const copyFile = vi.fn(async () => undefined);

    await linkOrCopyCodexOverlayEntry(
      {
        entryName: "auth.json",
        sourcePath: "C:\\Users\\test\\.codex\\auth.json",
        targetPath: "C:\\Users\\test\\.synara\\codex-home-overlay\\auth.json",
        type: "file",
      },
      { symlink, copyFile },
    );

    expect(symlink).toHaveBeenCalledWith(
      "C:\\Users\\test\\.codex\\auth.json",
      "C:\\Users\\test\\.synara\\codex-home-overlay\\auth.json",
      "file",
    );
    expect(copyFile).toHaveBeenCalledWith(
      "C:\\Users\\test\\.codex\\auth.json",
      "C:\\Users\\test\\.synara\\codex-home-overlay\\auth.json",
    );
  });

  it("keeps symlink failures visible for other overlay entries", async () => {
    const symlink = vi.fn(async () => {
      throw new Error("symlinks unavailable");
    });

    await expect(
      linkOrCopyCodexOverlayEntry(
        {
          entryName: "sessions",
          sourcePath: "C:\\Users\\test\\.codex\\sessions",
          targetPath: "C:\\Users\\test\\.synara\\codex-home-overlay\\sessions",
          type: "dir",
        },
        { symlink, copyFile: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow("symlinks unavailable");
  });
});

describe("prioritizeCodexOverlayEntries", () => {
  it("prepares auth.json before entries whose symlinks may fail first", () => {
    expect(prioritizeCodexOverlayEntries(["sessions", "auth.json", "config.toml"])).toEqual([
      "auth.json",
      "sessions",
      "config.toml",
    ]);
  });
});

describe("buildCodexProcessEnv", () => {
  it("does not mutate a session overlay for read-only CLI probes", async () => {
    const sourceHome = mkdtempSync(path.join(os.tmpdir(), "synara-codex-source-"));
    const runtimeHome = mkdtempSync(path.join(os.tmpdir(), "synara-codex-runtime-"));
    writeFileSync(path.join(sourceHome, "config.toml"), 'model_provider = "openrouter"\n', "utf8");

    try {
      const env = await buildCodexProcessEnv({
        env: { SYNARA_HOME: runtimeHome },
        homePath: sourceHome,
        platform: "win32",
        prepareOverlay: false,
      });

      expect(env.CODEX_HOME).toBe(sourceHome);
      expect(() =>
        readFileSync(path.join(runtimeHome, "codex-home-overlay", "config.toml")),
      ).toThrow();
    } finally {
      rmSync(sourceHome, { recursive: true, force: true });
      rmSync(runtimeHome, { recursive: true, force: true });
    }
  });

  it("rejects profile names that can escape the Codex home", async () => {
    const sourceHome = mkdtempSync(path.join(os.tmpdir(), "synara-codex-profile-"));
    writeFileSync(path.join(sourceHome, "config.toml"), 'model = "gpt-5.6-sol"\n', "utf8");

    try {
      await expect(
        buildCodexProcessEnv({
          env: { SYNARA_HOME: sourceHome },
          homePath: sourceHome,
          profile: "../outside",
          platform: "darwin",
        }),
      ).rejects.toThrow("Invalid Codex profile name");
    } finally {
      rmSync(sourceHome, { recursive: true, force: true });
    }
  });

  it("registers the active custom provider env key for diagnostic redaction", async () => {
    const codexHome = mkdtempSync(path.join(os.tmpdir(), "synara-codex-provider-key-"));
    writeFileSync(
      path.join(codexHome, "config.toml"),
      [
        'model_provider = "acme"',
        "",
        "[model_providers.acme]",
        'env_key = "ACME-LICENSE.INTEGRATION"',
      ].join("\n"),
      "utf8",
    );

    try {
      await buildCodexProcessEnv({ env: { CODEX_HOME: codexHome }, platform: "win32" });
      expect(isProviderCredentialKey("ACME-LICENSE.INTEGRATION")).toBe(true);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("replaces a user-defined Synara MCP table only inside the session overlay", async () => {
    const sourceHome = mkdtempSync(path.join(os.tmpdir(), "synara-codex-source-"));
    const runtimeHome = mkdtempSync(path.join(os.tmpdir(), "synara-codex-runtime-"));
    const sourceConfig = [
      'model = "gpt-5.5"',
      "",
      "[mcp_servers.synara]",
      'url = "http://127.0.0.1:1111/stale-mcp"',
      'bearer_token_env_var = "STALE_GATEWAY_TOKEN"',
      "",
      "[mcp_servers.synara.headers]",
      'Authorization = "stale-inline-secret"',
      "",
      "[mcp_servers.synara.env]",
      'STALE_GATEWAY_TOKEN = "stale-inline-secret"',
      "",
      "[mcp_servers.synara-other]",
      'url = "http://127.0.0.1:2111/synara-other"',
      "",
      "[mcp_servers.user-tool]",
      'url = "http://127.0.0.1:2222/user-tool"',
      "",
      "[shell_environment_policy]",
      'inherit = "core"',
      'exclude = ["USER_SECRET"]',
    ].join("\n");
    const managedConfig = [
      "[mcp_servers.synara]",
      'url = "http://127.0.0.1:3773/mcp"',
      'bearer_token_env_var = "SYNARA_AGENT_GATEWAY_TOKEN"',
      "",
      "[shell_environment_policy]",
      'exclude = ["SYNARA_AGENT_GATEWAY_TOKEN"]',
    ].join("\n");
    const sourceConfigPath = path.join(sourceHome, "config.toml");
    writeFileSync(sourceConfigPath, sourceConfig, "utf8");

    try {
      const env = await buildCodexProcessEnv({
        env: { SYNARA_HOME: runtimeHome },
        homePath: sourceHome,
        platform: "darwin",
        appendConfigToml: managedConfig,
      });
      const overlayHome = env.CODEX_HOME;
      if (!overlayHome) {
        throw new Error("Expected a Synara Codex home overlay.");
      }
      const overlayConfig = readFileSync(path.join(overlayHome, "config.toml"), "utf8");

      expect(overlayConfig.match(/^\[mcp_servers\.synara\]$/gm)).toHaveLength(1);
      expect(overlayConfig).toContain('url = "http://127.0.0.1:3773/mcp"');
      expect(overlayConfig).toContain('bearer_token_env_var = "SYNARA_AGENT_GATEWAY_TOKEN"');
      expect(overlayConfig).not.toContain("http://127.0.0.1:1111/stale-mcp");
      expect(overlayConfig).not.toContain("STALE_GATEWAY_TOKEN");
      expect(overlayConfig).not.toContain("stale-inline-secret");
      expect(overlayConfig).not.toContain("[mcp_servers.synara.headers]");
      expect(overlayConfig).not.toContain("[mcp_servers.synara.env]");
      expect(overlayConfig).toContain(
        '[mcp_servers.synara-other]\nurl = "http://127.0.0.1:2111/synara-other"',
      );
      expect(overlayConfig).toContain(
        '[mcp_servers.user-tool]\nurl = "http://127.0.0.1:2222/user-tool"',
      );
      expect(overlayConfig).toContain('inherit = "core"');
      expect(overlayConfig).toContain('exclude = ["SYNARA_AGENT_GATEWAY_TOKEN", "USER_SECRET"]');
      expect(readFileSync(sourceConfigPath, "utf8")).toBe(sourceConfig);
    } finally {
      rmSync(sourceHome, { recursive: true, force: true });
      rmSync(runtimeHome, { recursive: true, force: true });
    }
  });
});
