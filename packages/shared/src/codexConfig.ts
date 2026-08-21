/**
 * Codex config helpers.
 *
 * Parses the small subset of `CODEX_HOME/config.toml` we need for provider
 * discovery. Parsing is read-only; source bytes are never rewritten here.
 */
import OS from "node:os";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from "smol-toml";

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

function mergeTomlTables(base: TomlTable, overlay: TomlTable): TomlTable {
  const merged: TomlTable = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = merged[key];
    merged[key] =
      isTomlTable(baseValue) && isTomlTable(overlayValue)
        ? mergeTomlTables(baseValue, overlayValue)
        : overlayValue;
  }
  return merged;
}

/** Applies Synara's compatibility sidecar profile over the base Codex config. */
export function layerCodexConfig(baseConfig: string, profileConfig: string): string {
  const base = baseConfig.trim() ? parseToml(baseConfig) : {};
  const profile = profileConfig.trim() ? parseToml(profileConfig) : {};
  return stringifyToml(mergeTomlTables(base, profile)).trimEnd();
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

export type EffectiveCodexRoute = {
  readonly fingerprint: string;
  readonly sourceHomePath: string;
  readonly profile: string | null;
  readonly profileConfigPresent: boolean;
  readonly status: "ready" | "invalid";
  readonly provider: string | null;
  readonly kind: "openai" | "custom-responses" | "custom-incompatible" | "unknown";
  readonly baseUrl: string | null;
  readonly wireApi: string | null;
  readonly credentialSource: "codex-auth" | "env" | "command" | null;
  readonly configuredMcpServerCount: number;
  readonly detail?: string;
};

/**
 * Reads the active cloud model-provider profile without mutating or normalizing
 * the user's TOML. A usable custom profile must identify its endpoint and a
 * credential source. HTTP endpoints fail closed because Codex would send the
 * provider credential and prompt contents over that connection.
 */
export function parseCodexCustomProviderProfile(
  content: string,
  activeProvider?: string,
): CodexCustomProviderProfile | undefined {
  const provider = activeProvider?.trim() || parseCodexConfigModelProvider(content);
  if (!provider) return undefined;

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

/**
 * Resolves the non-secret identity and compatibility of the exact base +
 * sidecar profile bytes used for a Codex launch. Credentials and raw config
 * never leave this boundary.
 */
export function resolveEffectiveCodexRoute(
  input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly homePath?: string;
    readonly profile?: string;
  } = {},
): EffectiveCodexRoute {
  const env = input.env ?? process.env;
  const sourceHomePath = resolve(input.homePath?.trim() || resolveCodexHome(env));
  const profile = input.profile?.trim() || null;
  const basePath = join(sourceHomePath, "config.toml");
  const profilePath = profile ? join(sourceHomePath, `${profile}.config.toml`) : null;
  const readOptional = (filePath: string): string | undefined => {
    try {
      return readFileSync(filePath, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
  };
  const baseConfig = readOptional(basePath) ?? "";
  const profileConfig = profilePath ? readOptional(profilePath) : undefined;
  const profileConfigPresent = profile === null || profileConfig !== undefined;
  const fingerprint = createHash("sha256")
    .update("synara-codex-route-v1\0")
    .update(sourceHomePath)
    .update("\0")
    .update(profile ?? "")
    .update("\0")
    .update(baseConfig)
    .update("\0")
    .update(profileConfig ?? "")
    .digest("hex");
  const invalid = (
    detail: string,
    overrides: Partial<Pick<EffectiveCodexRoute, "provider" | "kind">> = {},
  ): EffectiveCodexRoute => ({
    fingerprint,
    sourceHomePath,
    profile,
    profileConfigPresent,
    status: "invalid",
    provider: overrides.provider ?? null,
    kind: overrides.kind ?? "unknown",
    baseUrl: null,
    wireApi: null,
    credentialSource: null,
    configuredMcpServerCount: 0,
    detail,
  });

  if (!profileConfigPresent) {
    return invalid(`Profile '${profile}' is missing its config file.`);
  }

  let effectiveConfig: string;
  try {
    effectiveConfig =
      profile === null ? baseConfig : layerCodexConfig(baseConfig, profileConfig ?? "");
  } catch {
    return invalid("The active Codex configuration is not valid TOML.");
  }
  if (effectiveConfig.trim() && !parseCodexConfig(effectiveConfig)) {
    return invalid("The active Codex configuration is not valid TOML.");
  }

  const configuredMcpServerCount = parseCodexConfigMcpServerCount(effectiveConfig);
  const provider = parseCodexConfigModelProvider(effectiveConfig) ?? "openai";
  const activeProviderConfig = readProviderConfig(effectiveConfig, provider);
  const hasOpenAiRouteOverride =
    provider === "openai" &&
    activeProviderConfig !== undefined &&
    ["base_url", "env_key", "auth", "wire_api"].some((key) =>
      Object.prototype.hasOwnProperty.call(activeProviderConfig, key),
    );
  if (provider === "openai" && !hasOpenAiRouteOverride) {
    return {
      fingerprint,
      sourceHomePath,
      profile,
      profileConfigPresent,
      status: "ready",
      provider,
      kind: "openai",
      baseUrl: null,
      wireApi: "responses",
      credentialSource: "codex-auth",
      configuredMcpServerCount,
    };
  }

  const customProvider = parseCodexCustomProviderProfile(effectiveConfig, provider);
  if (!customProvider || customProvider.provider !== provider) {
    return {
      ...invalid(
        "The active custom provider is missing a safe HTTPS endpoint or exactly one credential source.",
        { provider, kind: "custom-incompatible" },
      ),
      configuredMcpServerCount,
    };
  }
  if (customProvider.wireApi !== "responses") {
    return {
      ...invalid(
        `Codex requires the Responses wire API; this route uses '${customProvider.wireApi}'.`,
        {
          provider,
          kind: "custom-incompatible",
        },
      ),
      baseUrl: customProvider.baseUrl,
      wireApi: customProvider.wireApi,
      credentialSource: customProvider.credentialSource,
      configuredMcpServerCount,
    };
  }
  return {
    fingerprint,
    sourceHomePath,
    profile,
    profileConfigPresent,
    status: "ready",
    provider,
    kind: "custom-responses",
    baseUrl: customProvider.baseUrl,
    wireApi: customProvider.wireApi,
    credentialSource: customProvider.credentialSource,
    configuredMcpServerCount,
  };
}

/** Resolves only the active provider's env-var name for a local readiness check. */
export function resolveEffectiveCodexProviderEnvKey(
  input: {
    readonly env?: NodeJS.ProcessEnv;
    readonly homePath?: string;
    readonly profile?: string;
  } = {},
): string | undefined {
  const env = input.env ?? process.env;
  const sourceHomePath = resolve(input.homePath?.trim() || resolveCodexHome(env));
  const readOptional = (filePath: string): string | undefined => {
    try {
      return readFileSync(filePath, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
  };
  const baseConfig = readOptional(join(sourceHomePath, "config.toml")) ?? "";
  const profile = input.profile?.trim();
  const profileConfig = profile
    ? readOptional(join(sourceHomePath, `${profile}.config.toml`))
    : undefined;
  if (profile && profileConfig === undefined) return undefined;
  const effectiveConfig = profile ? layerCodexConfig(baseConfig, profileConfig ?? "") : baseConfig;
  const provider = parseCodexConfigModelProvider(effectiveConfig) ?? "openai";
  return parseCodexConfigProviderEnvKey(effectiveConfig, provider);
}

export function parseCodexConfigActiveProviderEnvKey(content: string): string | undefined {
  const provider = parseCodexConfigModelProvider(content);
  if (!provider) {
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
