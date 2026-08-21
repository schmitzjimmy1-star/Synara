// FILE: runtimeDiagnostics.ts
// Purpose: Build a secret-safe, server-authoritative snapshot of the Codex runtime Synara delegates to.
// Layer: Server runtime diagnostics

import path from "node:path";

import type {
  CodexServerProviderSettings,
  ProviderSession,
  ServerDiagnosticsResult,
} from "@synara/contracts";
import { resolveCodexBinary } from "@synara/shared/codexBinary";
import { resolveEffectiveCodexRoute } from "@synara/shared/codexConfig";

import { resolveBaseCodexHomePath } from "./codexHomePaths.ts";
import { buildCodexProcessEnv } from "./codexProcessEnv.ts";

type CodexDiagnostics = ServerDiagnosticsResult["codex"];

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
  const effectiveRoute = resolveEffectiveCodexRoute({
    env,
    homePath: sourceHomePath,
    ...(profile ? { profile } : {}),
  });

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
    profileConfigPresent: effectiveRoute.profileConfigPresent,
    route: {
      status: effectiveRoute.status,
      provider: effectiveRoute.provider,
      kind: effectiveRoute.kind,
      baseUrl: effectiveRoute.baseUrl,
      wireApi: effectiveRoute.wireApi,
      credentialSource: effectiveRoute.credentialSource,
      ...(effectiveRoute.detail ? { detail: effectiveRoute.detail } : {}),
    },
    configuredMcpServerCount: effectiveRoute.configuredMcpServerCount,
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
