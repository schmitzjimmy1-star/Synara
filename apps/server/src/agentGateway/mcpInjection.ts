/** Codex-facing configuration for Synara's authenticated MCP gateway. */

export const SYNARA_MCP_SERVER_NAME = "synara";
export const SYNARA_AGENT_GATEWAY_TOKEN_ENV = "SYNARA_AGENT_GATEWAY_TOKEN";

/**
 * Codex reads MCP servers from a shared config file, so the per-session bearer
 * token is referenced through an environment variable and never written to
 * disk. The shell policy also prevents that token from leaking into workspace
 * commands spawned by the model.
 */
export function buildCodexMcpConfigToml(endpointUrl: string): string {
  return [
    `[mcp_servers.${SYNARA_MCP_SERVER_NAME}]`,
    `url = ${JSON.stringify(endpointUrl)}`,
    `bearer_token_env_var = ${JSON.stringify(SYNARA_AGENT_GATEWAY_TOKEN_ENV)}`,
    "",
    "[shell_environment_policy]",
    `exclude = [${JSON.stringify(SYNARA_AGENT_GATEWAY_TOKEN_ENV)}]`,
  ].join("\n");
}
