// FILE: codexBinary.ts
// Purpose: Resolve the one Codex executable every Synara surface must launch.
// Layer: Shared Node runtime utility
// Exports: Canonical Codex binary discovery and actionable resolution errors.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { resolveExecutable } from "./executableLookup";

export type CodexBinarySource = "explicit" | "path" | "official-app";

export interface CodexBinaryResolution {
  readonly path: string;
  readonly source: CodexBinarySource;
}

export class CodexBinaryResolutionError extends Error {
  readonly configuredPath: string;
  readonly explicit: boolean;

  constructor(input: { readonly configuredPath: string; readonly explicit: boolean }) {
    const message = input.explicit
      ? `Codex CLI (${input.configuredPath}) is required but not available. The configured Codex executable is missing or not executable.`
      : "Codex CLI was not found on PATH or in an official ChatGPT/Codex application bundle. Choose the Codex executable in Settings, then retry.";
    super(message);
    this.name = "CodexBinaryResolutionError";
    this.configuredPath = input.configuredPath;
    this.explicit = input.explicit;
  }
}

const OPENAI_TEAM_IDENTIFIER = "2DC432GLL2";
const OPENAI_CODEX_BUNDLE_IDENTIFIERS = new Set([
  "com.openai.codex",
  "com.openai.chat",
  "com.openai.chatgpt",
]);

function canonicalExecutablePath(filePath: string, cwd: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

function verifyOfficialMacBundle(candidate: string): boolean {
  const marker = ".app/Contents/Resources/codex";
  const markerIndex = candidate.indexOf(marker);
  if (markerIndex < 0) return false;
  const bundlePath = candidate.slice(0, markerIndex + ".app".length);
  const verification = spawnSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    bundlePath,
  ]);
  if (verification.status !== 0) return false;
  const details = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", bundlePath], {
    encoding: "utf8",
  });
  if (details.status !== 0) return false;
  const output = `${details.stdout ?? ""}\n${details.stderr ?? ""}`;
  const identifier = /^Identifier=(.+)$/mu.exec(output)?.[1]?.trim();
  const teamIdentifier = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim();
  return Boolean(
    identifier &&
    OPENAI_CODEX_BUNDLE_IDENTIFIERS.has(identifier) &&
    teamIdentifier === OPENAI_TEAM_IDENTIFIER,
  );
}

export function officialMacCodexBinaryCandidates(
  homeDirectory: string = homedir(),
): readonly string[] {
  const applicationRoots = ["/Applications", path.join(homeDirectory, "Applications")];
  const appNames = ["ChatGPT.app", "Codex.app"];
  return applicationRoots.flatMap((root) =>
    appNames.map((appName) => path.join(root, appName, "Contents", "Resources", "codex")),
  );
}

/**
 * Resolve Codex after the caller has built the exact child environment.
 *
 * A non-default configured value is an explicit user choice and therefore fails closed.
 * The default `codex` value may fall through from PATH to verified official macOS bundles.
 */
export function resolveCodexBinary(input: {
  readonly configuredPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly officialMacCandidates?: readonly string[];
  readonly cwd?: string;
  readonly verifyOfficialMacCandidate?: (candidate: string) => boolean;
}): CodexBinaryResolution {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const configuredPath = input.configuredPath?.trim() || "codex";
  const explicit = configuredPath !== "codex";
  const resolvedConfiguredPath = resolveExecutable(configuredPath, {
    env,
    platform,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  });
  if (resolvedConfiguredPath) {
    return {
      path: canonicalExecutablePath(resolvedConfiguredPath, input.cwd ?? process.cwd()),
      source: explicit ? "explicit" : "path",
    };
  }
  if (explicit) {
    throw new CodexBinaryResolutionError({ configuredPath, explicit: true });
  }

  if (platform === "darwin") {
    const officialCandidates = input.officialMacCandidates ?? officialMacCodexBinaryCandidates();
    const verifier = input.verifyOfficialMacCandidate ?? verifyOfficialMacBundle;
    const officialPath = officialCandidates.find((candidate) => {
      const resolved = resolveExecutable(candidate, { env, platform });
      return resolved !== null && verifier(candidate);
    });
    if (officialPath) {
      return {
        path: canonicalExecutablePath(
          resolveExecutable(officialPath, { env, platform }) ?? officialPath,
          process.cwd(),
        ),
        source: "official-app",
      };
    }
  }

  throw new CodexBinaryResolutionError({ configuredPath, explicit: false });
}
