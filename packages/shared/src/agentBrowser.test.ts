import { describe, expect, it } from "vitest";

import {
  buildSynaraAgentBrowserEnvironment,
  resolveSynaraAgentBrowserSessionName,
} from "./agentBrowser";

describe("agent-browser session identity", () => {
  it("derives a stable bounded session name from a thread id", () => {
    expect(resolveSynaraAgentBrowserSessionName(" ABC/123 ")).toBe("synara-abc-123");
    expect(resolveSynaraAgentBrowserSessionName("x".repeat(100))).toBe(
      `synara-${"x".repeat(12)}-${"x".repeat(8)}`,
    );
  });

  it("builds the Codex and desktop environment contract", () => {
    expect(buildSynaraAgentBrowserEnvironment("thread-1")).toMatchObject({
      AGENT_BROWSER_SESSION: "synara-thread-1",
      AGENT_BROWSER_NAMESPACE: "synara",
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "600000",
    });
  });
});
