// FILE: runtimeDiagnostics.ts
// Purpose: Build a secret-safe, server-authoritative snapshot of the Codex runtime Synara delegates to.
// Layer: Server runtime diagnostics

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CodexServerProviderSettings,
  ProviderSession,
  ServerDiagnosticsResult,
} from "@synara/contracts";
import { resolveCodexBinary } from "@synara/shared/codexBinary";
import {
  parseCodexConfigMcpServerCount,
  parseCodexConfigModelProvider,
  parseCodexCustomProviderProfile,
} from "@synara/shared/codexConfig";

import { resolveBaseCodexHomePath } from "./codexHomePaths.ts";
import { applyCodexProfileLayer, buildCodexProcessEnv } from "./codexProcessEnv.ts";

type CodexDiagnostics = ServerDiagnosticsResult["codex"];

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

function describeRoute(input: {
  readonly config: string;
  readonly profile: string | null;
  readonly profileConfigPresent: boolean;
}): CodexDiagnostics["route"] {
  if (input.profile !== null && !input.profileConfigPresent) {
    return {
      status: "invalid",
      provider: null,
      kind: "unknown",
      baseUrl: null,
      wireApi: null,
      credentialSource: null,
      detail: `Profile '${input.profile}' is missing its config file.`,
    };
  }

  const provider = parseCodexConfigModelProvider(input.config) ?? "openai";
  if (provider === "openai") {
    return {
      status: "ready",
      provider,
      kind: "openai",
      baseUrl: null,
      wireApi: "responses",
      credentialSource: "codex-auth",
    };
  }

  const customProvider = parseCodexCustomProviderProfile(input.config);
  if (!customProvider || customProvider.provider !== provider) {
    return {
      status: "invalid",
      provider,
      kind: "custom-incompatible",
      baseUrl: null,
      wireApi: null,
      credentialSource: null,
      detail:
        "The active custom provider is missing a safe HTTPS endpoint or one credential source.",
    };
  }

  const responsesCompatible = customProvider.wireApi === "responses";
  return {
    status: responsesCompatible ? "ready" : "invalid",
    provider,
    kind: responsesCompatible ? "custom-responses" : "custom-incompatible",
    baseUrl: customProvider.baseUrl,
    wireApi: customProvider.wireApi,
    credentialSource: customProvider.credentialSource,
    ...(!responsesCompatible
      ? {
          detail: `Codex requires the Responses wire API; this route uses '${customProvider.wireApi}'.`,
        }
      : {}),
  };
}

export async function buildCodexRuntimeDiagnostics(input: {
  readonly settings: CodexServerProviderSettings;
  readonly sessions: ReadonlyArray<ProviderSession>;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<CodexDiagnostics> {
  const env = input.env ?? process.env;
  const sourceHomePath = path.resolve(
    resolveBaseCodexHomePath(env, input.settings.homePath.trim() || undefined),
  );
  const profile = input.settings.profile.trim() || null;
  const baseConfig = (await readOptionalFile(path.join(sourceHomePath, "config.toml"))) ?? "";
  const profileConfig = profile
    ? await readOptionalFile(path.join(sourceHomePath, `${profile}.config.toml`))
    : undefined;
  const effectiveConfig = profileConfig
    ? applyCodexProfileLayer(baseConfig, profileConfig)
    : baseConfig;

  let binary: CodexDiagnostics["binary"];
  try {
    const processEnv = await buildCodexProcessEnv({
      env,
      ...(input.settings.homePath.trim() ? { homePath: input.settings.homePath.trim() } : {}),
      prepareOverlay: false,
    });
    const resolution = resolveCodexBinary({
      configuredPath: input.settings.binaryPath.trim() || "codex",
      env: processEnv,
    });
    binary = {
      status: "ready",
      configuredPath: input.settings.binaryPath.trim() || "codex",
      resolvedPath: resolution.path,
      source: resolution.source,
      detail: null,
    };
  } catch (cause) {
    binary = {
      status: "error",
      configuredPath: input.settings.binaryPath.trim() || "codex",
      resolvedPath: null,
      source: null,
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const codexSessions = input.sessions.filter((session) => session.provider === "codex");
  const modelCounts = new Map<string, number>();
  for (const session of codexSessions) {
    const model = session.model?.trim() || "Codex default";
    modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
  }

  return {
    ownership: {
      execution: "codex",
      authentication: "codex",
      modelRouting: "codex-config",
      mcps: "codex-config",
      skills: "codex-app-server",
      plugins: "codex-app-server",
    },
    binary,
    sourceHomePath,
    profile,
    profileConfigPresent: profile === null || profileConfig !== undefined,
    route: describeRoute({
      config: effectiveConfig,
      profile,
      profileConfigPresent: profile === null || profileConfig !== undefined,
    }),
    configuredMcpServerCount: parseCodexConfigMcpServerCount(effectiveConfig),
    activeSessions: {
      totalCount: codexSessions.length,
      runningCount: codexSessions.filter((session) => session.status === "running").length,
      models: [...modelCounts.entries()]
        .map(([model, count]) => ({ model, count }))
        .toSorted(
          (left, right) => right.count - left.count || left.model.localeCompare(right.model),
        ),
    },
  };
}
