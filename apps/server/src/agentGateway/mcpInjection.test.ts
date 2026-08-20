import { assert, describe, it } from "@effect/vitest";

import {
  appendCodexConfigSection,
  extractManagedCodexConfigSection,
  mergeShellEnvPolicyExclude,
  SYNARA_MANAGED_CODEX_CONFIG_BEGIN,
  SYNARA_MANAGED_CODEX_CONFIG_END,
} from "../codexProcessEnv.ts";
import {
  buildCodexMcpConfigToml,
  SYNARA_AGENT_GATEWAY_TOKEN_ENV,
} from "./mcpInjection.ts";

describe("Codex agent gateway MCP injection", () => {
  const endpoint = "http://127.0.0.1:3773/mcp";

  it("references the per-session token env var instead of writing a secret", () => {
    const block = buildCodexMcpConfigToml(endpoint);
    assert.include(block, "[mcp_servers.synara]");
    assert.include(block, `url = "${endpoint}"`);
    assert.include(block, `bearer_token_env_var = "${SYNARA_AGENT_GATEWAY_TOKEN_ENV}"`);
    assert.notInclude(block, "sagw_example-secret");
  });

  it("appends one managed section and preserves existing config", () => {
    const base = '[model]\nname = "gpt-5.5"\n';
    const section = buildCodexMcpConfigToml(endpoint);
    const appended = appendCodexConfigSection(base, section);
    assert.include(appended, base.trim());
    assert.equal(appended.split("[mcp_servers.synara]").length, 2);
  });

  it("keeps the bearer token out of model-spawned shell commands", () => {
    const config = ["[shell_environment_policy]", 'exclude = ["AWS_*"]'].join("\n");
    const merged = mergeShellEnvPolicyExclude(config, SYNARA_AGENT_GATEWAY_TOKEN_ENV);
    assert.include(merged, `exclude = ["${SYNARA_AGENT_GATEWAY_TOKEN_ENV}", "AWS_*"]`);
    assert.equal(mergeShellEnvPolicyExclude(merged, SYNARA_AGENT_GATEWAY_TOKEN_ENV), merged);
  });

  it("round-trips the managed overlay without stripping MCP wiring", () => {
    const section = buildCodexMcpConfigToml(endpoint);
    const overlay = [
      '[model]\nname = "gpt-5.5"',
      SYNARA_MANAGED_CODEX_CONFIG_BEGIN,
      section,
      SYNARA_MANAGED_CODEX_CONFIG_END,
    ].join("\n");
    assert.equal(extractManagedCodexConfigSection(overlay), section);
  });
});
