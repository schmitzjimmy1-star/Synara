import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CodexBinaryResolutionError, resolveCodexBinary } from "./codexBinary";

const tempDirectories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "synara-codex-binary-"));
  tempDirectories.push(directory);
  return directory;
}

function installExecutable(directory: string, name = "codex"): string {
  mkdirSync(directory, { recursive: true });
  const executablePath = path.join(directory, name);
  writeFileSync(executablePath, "#!/bin/sh\nexit 0\n");
  chmodSync(executablePath, 0o755);
  return realpathSync(executablePath);
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("resolveCodexBinary", () => {
  it("honors an executable explicit path", () => {
    const executablePath = installExecutable(tempDirectory());
    expect(resolveCodexBinary({ configuredPath: executablePath, env: { PATH: "" } })).toEqual({
      path: executablePath,
      source: "explicit",
    });
  });

  it("fails closed for an invalid explicit path", () => {
    expect(() =>
      resolveCodexBinary({
        configuredPath: "/missing/codex",
        env: { PATH: tempDirectory() },
        officialMacCandidates: [installExecutable(tempDirectory())],
      }),
    ).toThrow(CodexBinaryResolutionError);
  });

  it("resolves the default command from the child PATH", () => {
    const directory = tempDirectory();
    const executablePath = installExecutable(directory);
    expect(resolveCodexBinary({ env: { PATH: directory }, platform: "darwin" })).toEqual({
      path: executablePath,
      source: "path",
    });
  });

  it("falls back to a verified official macOS application binary", () => {
    const executablePath = installExecutable(tempDirectory());
    expect(
      resolveCodexBinary({
        env: { PATH: "" },
        platform: "darwin",
        officialMacCandidates: ["/missing/codex", executablePath],
        verifyOfficialMacCandidate: (candidate) => candidate === executablePath,
      }),
    ).toEqual({ path: executablePath, source: "official-app" });
  });

  it("rejects an unverified application candidate", () => {
    const executablePath = installExecutable(tempDirectory());
    expect(() =>
      resolveCodexBinary({
        env: { PATH: "" },
        platform: "darwin",
        officialMacCandidates: [executablePath],
        verifyOfficialMacCandidate: () => false,
      }),
    ).toThrow("Codex CLI was not found");
  });

  it("canonicalizes an explicit relative path before a caller changes cwd", () => {
    const directory = tempDirectory();
    const executablePath = installExecutable(directory);
    expect(
      resolveCodexBinary({ configuredPath: "./codex", env: { PATH: "" }, cwd: directory }),
    ).toEqual({ path: executablePath, source: "explicit" });
  });

  it("canonicalizes relative PATH entries", () => {
    const root = tempDirectory();
    const executablePath = installExecutable(path.join(root, "bin"));
    expect(resolveCodexBinary({ env: { PATH: "bin" }, platform: "darwin", cwd: root })).toEqual({
      path: executablePath,
      source: "path",
    });
  });

  it("rejects Windows extensions outside PATHEXT", () => {
    const directory = tempDirectory();
    installExecutable(directory, "codex.txt");
    expect(() =>
      resolveCodexBinary({
        configuredPath: path.join(directory, "codex.txt"),
        env: { PATH: "", PATHEXT: ".EXE;.CMD" },
        platform: "win32",
      }),
    ).toThrow(CodexBinaryResolutionError);
  });

  it("does not use macOS application candidates on other platforms", () => {
    const executablePath = installExecutable(tempDirectory());
    expect(() =>
      resolveCodexBinary({
        env: { PATH: "" },
        platform: "linux",
        officialMacCandidates: [executablePath],
      }),
    ).toThrow("Codex CLI was not found");
  });

  it("rejects non-executable candidates", () => {
    const directory = tempDirectory();
    const candidate = path.join(directory, "codex");
    writeFileSync(candidate, "not executable\n");
    chmodSync(candidate, 0o644);
    expect(() =>
      resolveCodexBinary({
        env: { PATH: directory },
        platform: "darwin",
        officialMacCandidates: [],
      }),
    ).toThrow("Codex CLI was not found");
  });
});
