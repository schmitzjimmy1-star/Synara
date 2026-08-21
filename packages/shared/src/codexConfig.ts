/**
 * Codex config helpers.
 *
 * Parses the small subset of `CODEX_HOME/config.toml` we need for provider
 * discovery. Parsing is read-only; source bytes are never rewritten here.
 */
import OS from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml, type TomlTable } from "smol-toml";

function isTomlTable(value: unknown): value is TomlTable {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function parseCodexConfig(content: string): TomlTable | undefined {
  try {
    return parseToml(content);
  } catch {
    return undefined;
  }
}

function readProviderConfig(content: string, provider: string): TomlTable | undefined {
  const providers = parseCodexConfig(content)?.model_providers;
  if (!isTomlTable(providers)) return undefined;
  const providerConfig = providers[provider];
  return isTomlTable(providerConfig) ? providerConfig : undefined;
}

export function parseCodexConfigModelProvider(content: string): string | undefined {
  const provider = parseCodexConfig(content)?.model_provider;
  return typeof provider === "string" && provider.trim() ? provider.trim() : undefined;
}

export function parseCodexConfigProviderEnvKey(
  content: string,
  provider: string,
): string | undefined {
  const envKey = readProviderConfig(content, provider)?.env_key;
  return typeof envKey === "string" && envKey.trim() ? envKey.trim() : undefined;
}

export function parseCodexConfigProviderBaseUrl(
  content: string,
  provider: string,
): string | undefined {
  const baseUrl = readProviderConfig(content, provider)?.base_url;
  return typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : undefined;
}

/**
 * Counts configured MCP servers without exposing their names, commands, arguments,
 * or environment. This is configuration evidence only; it does not claim that a
 * server successfully started in a particular Codex session.
 */
export function parseCodexConfigMcpServerCount(content: string): number {
  const servers = parseCodexConfig(content)?.mcp_servers;
  return isTomlTable(servers) ? Object.keys(servers).length : 0;
}

export function isOpenRouterCodexConfig(content: string): boolean {
  const baseUrl = parseCodexConfigProviderBaseUrl(content, "openrouter")?.replace(/\/+$/, "");
  return (
    parseCodexConfigModelProvider(content) === "openrouter" &&
    baseUrl === "https://openrouter.ai/api/v1" &&
    isCodexResponsesProviderConfig(content)
  );
}

export type CodexCustomProviderProfile = {
  readonly provider: string;
  readonly baseUrl: string;
  readonly wireApi: string;
  readonly credentialSource: "env" | "command";
};

/**
 * Reads the active cloud model-provider profile without mutating or normalizing
 * the user's TOML. A usable custom profile must identify its endpoint and a
 * credential source. HTTP endpoints fail closed because Codex would send the
 * provider credential and prompt contents over that connection.
 */
export function parseCodexCustomProviderProfile(
  content: string,
): CodexCustomProviderProfile | undefined {
  const provider = parseCodexConfigModelProvider(content);
  if (!provider || provider === "openai") return undefined;

  const rawBaseUrl = parseCodexConfigProviderBaseUrl(content, provider);
  const providerConfig = readProviderConfig(content, provider);
  if (!rawBaseUrl || !providerConfig) return undefined;
  const configuredWireApi = providerConfig.wire_api;
  if (configuredWireApi !== undefined && typeof configuredWireApi !== "string") return undefined;
  const wireApi = configuredWireApi ?? "responses";

  let baseUrl: string;
  try {
    const parsed = new URL(rawBaseUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }

  const auth = providerConfig.auth;
  if (auth !== undefined && !isTomlTable(auth)) return undefined;
  const authCommand = isTomlTable(auth) ? auth.command : undefined;
  if (authCommand !== undefined && (typeof authCommand !== "string" || !authCommand.trim())) {
    return undefined;
  }
  const envKey = parseCodexConfigProviderEnvKey(content, provider);
  const command = typeof authCommand === "string" ? authCommand.trim() : undefined;
  // Codex treats these as mutually exclusive authority sources. Refuse to guess
  // which credential should win when a profile accidentally configures both.
  if (envKey && command) return undefined;
  const credentialSource = envKey ? "env" : command ? "command" : undefined;
  if (!credentialSource) return undefined;

  return { provider, baseUrl, wireApi, credentialSource };
}

export function isCodexResponsesProviderConfig(content: string): boolean {
  return parseCodexCustomProviderProfile(content)?.wireApi === "responses";
}

export function parseCodexConfigActiveProviderEnvKey(content: string): string | undefined {
  const provider = parseCodexConfigModelProvider(content);
  if (!provider || provider === "openai") {
    return undefined;
  }

  return parseCodexConfigProviderEnvKey(content, provider);
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_HOME?.trim();
  return configured && configured.length > 0 ? configured : join(OS.homedir(), ".codex");
}

export function readCodexConfigContent(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configPath = join(resolveCodexHome(env), "config.toml");
  if (!existsSync(configPath)) {
    return undefined;
  }

  return readFileSync(configPath, "utf8");
}

export function readActiveCodexProviderEnvKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const content = readCodexConfigContent(env);
  if (content === undefined) {
    return undefined;
  }

  return parseCodexConfigActiveProviderEnvKey(content);
}
