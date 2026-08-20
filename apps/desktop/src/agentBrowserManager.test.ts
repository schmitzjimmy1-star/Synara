import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ThreadId } from "@synara/contracts";

import {
  DesktopAgentBrowserManager,
  encodeAgentBrowserInputEvent,
  resolveAgentBrowserBinary,
  resolveAgentBrowserWorkingDirectory,
} from "./agentBrowserManager";

describe("resolveAgentBrowserBinary", () => {
  it("prefers an explicit executable path", () => {
    const directory = mkdtempSync(join(tmpdir(), "synara-agent-browser-"));
    const executable = join(directory, "agent-browser");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    expect(resolveAgentBrowserBinary({ explicitPath: executable, env: { PATH: "" } })).toBe(
      executable,
    );
  });

  it("returns null when no executable is available", () => {
    expect(resolveAgentBrowserBinary({ env: { PATH: "" } })).toBeNull();
  });
});

describe("resolveAgentBrowserWorkingDirectory", () => {
  it("keeps an existing directory", () => {
    expect(resolveAgentBrowserWorkingDirectory(process.cwd())).toBe(process.cwd());
  });

  it("falls back when the packaged root points at a file", () => {
    expect(resolveAgentBrowserWorkingDirectory(import.meta.filename)).not.toBe(
      import.meta.filename,
    );
  });

  it("rejects Electron's virtual app.asar directories", () => {
    expect(
      resolveAgentBrowserWorkingDirectory(
        "/Applications/Synara.app/Contents/Resources/app.asar/apps/desktop",
      ),
    ).not.toContain("app.asar");
  });
});

describe("encodeAgentBrowserInputEvent", () => {
  it("preserves the agent-browser mouse protocol discriminator", () => {
    expect(
      JSON.parse(
        encodeAgentBrowserInputEvent({
          type: "mouse",
          eventType: "mousePressed",
          x: 10,
          y: 20,
          button: "left",
          clickCount: 1,
        }),
      ),
    ).toMatchObject({ type: "input_mouse", eventType: "mousePressed", x: 10, y: 20 });
  });

  it("preserves the agent-browser keyboard protocol discriminator", () => {
    expect(
      JSON.parse(
        encodeAgentBrowserInputEvent({ type: "keyboard", eventType: "keyDown", key: "a" }),
      ),
    ).toMatchObject({ type: "input_keyboard", eventType: "keyDown", key: "a" });
  });
});

describe("DesktopAgentBrowserManager viewport", () => {
  it("clamps viewport commands and keeps them in the thread-owned CLI session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synara-agent-browser-viewport-"));
    const executable = join(directory, "agent-browser");
    const commandLog = join(directory, "commands.log");
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${commandLog}"\nprintf '%s\\n' '{"success":true,"data":{},"error":null}'\n`,
    );
    chmodSync(executable, 0o755);
    const manager = new DesktopAgentBrowserManager({ binaryPath: executable, cwd: directory });

    await manager.setViewport({
      threadId: ThreadId.makeUnsafe("thread-viewport"),
      width: 100,
      height: 9_999,
      deviceScaleFactor: 3,
    });

    expect(readFileSync(commandLog, "utf8").trim()).toBe("set viewport 320 1400 2 --json");
    expect(manager.getState({ threadId: ThreadId.makeUnsafe("thread-viewport") })).toMatchObject({
      viewportWidth: 320,
      viewportHeight: 1400,
    });
  });
});
