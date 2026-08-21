// FILE: executableLookup.ts
// Purpose: Resolve spawnable executables consistently across Synara runtimes.

import { accessSync, constants, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";

export interface ExecutableLookupOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowExtensionlessOnWindows?: boolean;
  readonly cwd?: string;
}
export interface ExecutableCandidate {
  readonly directory: string;
  readonly path: string;
}

const DEFAULT_WINDOWS_PATH_EXTENSIONS: readonly string[] = [".COM", ".EXE", ".BAT", ".CMD"];

export function envPathKeyFor(env: NodeJS.ProcessEnv): "PATH" | "Path" | "path" {
  if ("PATH" in env) return "PATH";
  if ("Path" in env) return "Path";
  return "path";
}
export function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}
export function windowsPathExtensions(env: NodeJS.ProcessEnv): readonly string[] {
  const rawValue = env.PATHEXT;
  if (!rawValue) return DEFAULT_WINDOWS_PATH_EXTENSIONS;
  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? [...new Set(parsed)] : DEFAULT_WINDOWS_PATH_EXTENSIONS;
}
export function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  if (!pathValue) return [];
  return pathValue
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);
}
export function executableNameCandidates(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  allowExtensionless = false,
): readonly string[] {
  if (platform !== "win32") return [command];
  const extensions = windowsPathExtensions(env);
  const extension = extname(command);
  const normalizedExtension = extension.toUpperCase();
  if (extension && extensions.includes(normalizedExtension)) {
    const stem = command.slice(0, -extension.length);
    return [
      ...new Set([
        command,
        `${stem}${normalizedExtension}`,
        `${stem}${normalizedExtension.toLowerCase()}`,
      ]),
    ];
  }
  const candidates = allowExtensionless ? [command] : [];
  for (const value of extensions)
    candidates.push(`${command}${value}`, `${command}${value.toLowerCase()}`);
  return [...new Set(candidates)];
}
function directoryOf(commandPath: string): string {
  const index = Math.max(commandPath.lastIndexOf("/"), commandPath.lastIndexOf("\\"));
  if (index < 0) return ".";
  if (index === 0) return commandPath.slice(0, 1);
  return commandPath.slice(0, index);
}
interface LookupContext {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly explicitCwd: boolean;
  readonly pathExtensions: readonly string[];
}
function lookupContext(options: ExecutableLookupOptions): LookupContext {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  return {
    platform,
    env,
    cwd: options.cwd ?? process.cwd(),
    explicitCwd: options.cwd !== undefined,
    pathExtensions: platform === "win32" ? windowsPathExtensions(env) : [],
  };
}
function absoluteCandidate(candidate: string, cwd: string): string {
  return isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
}
function* candidatesIn(
  command: string,
  context: LookupContext,
  allowExtensionless: boolean,
): Generator<ExecutableCandidate> {
  const names = executableNameCandidates(
    command,
    context.platform,
    context.env,
    allowExtensionless,
  );
  if (hasPathSeparator(command)) {
    for (const name of names) {
      yield {
        directory: directoryOf(name),
        path: context.explicitCwd ? absoluteCandidate(name, context.cwd) : name,
      };
    }
    return;
  }
  for (const directory of pathEntries(context.env, context.platform)) {
    const candidateDirectory = context.explicitCwd
      ? absoluteCandidate(directory, context.cwd)
      : directory;
    for (const name of names) {
      yield { directory: candidateDirectory, path: join(candidateDirectory, name) };
    }
  }
}
export function executableCandidates(
  command: string,
  options: ExecutableLookupOptions = {},
): Generator<ExecutableCandidate> {
  return candidatesIn(
    command,
    lookupContext(options),
    options.allowExtensionlessOnWindows ?? false,
  );
}
function isExecutableFileIn(filePath: string, context: LookupContext): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (context.platform === "win32") {
      const extension = extname(filePath).toUpperCase();
      return Boolean(extension) && context.pathExtensions.includes(extension);
    }
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
export function isExecutableFile(filePath: string, options: ExecutableLookupOptions = {}): boolean {
  const context = lookupContext(options);
  return isExecutableFileIn(
    context.explicitCwd ? absoluteCandidate(filePath, context.cwd) : filePath,
    context,
  );
}
export function resolveExecutable(
  command: string,
  options: ExecutableLookupOptions = {},
): string | null {
  const context = lookupContext(options);
  for (const candidate of candidatesIn(
    command,
    context,
    options.allowExtensionlessOnWindows ?? false,
  )) {
    if (!isExecutableFileIn(candidate.path, context)) continue;
    return candidate.path;
  }
  return null;
}
export function executableIdentity(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}
