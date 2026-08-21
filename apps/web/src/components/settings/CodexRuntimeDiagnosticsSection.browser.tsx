// FILE: CodexRuntimeDiagnosticsSection.browser.tsx
// Purpose: Browser acceptance for the read-only Codex runtime truth surface.
// Layer: Browser UI test

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({ refetch: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      codex: {
        ownership: {
          execution: "codex",
          authentication: "codex",
          modelRouting: "codex-config",
          mcps: "codex-config",
          skills: "codex-app-server",
          plugins: "codex-app-server",
        },
        binary: {
          status: "ready",
          configuredPath: "codex",
          resolvedPath: "/Applications/Codex.app/Contents/Resources/codex",
          source: "official-app",
          detail: null,
        },
        sourceHomePath: "/Users/test/.codex",
        profile: "openrouter",
        profileConfigPresent: true,
        route: {
          status: "ready",
          provider: "openrouter",
          kind: "custom-responses",
          baseUrl: "https://openrouter.ai/api/v1",
          wireApi: "responses",
          credentialSource: "env",
        },
        configuredMcpServerCount: 3,
        activeSessions: {
          totalCount: 2,
          runningCount: 1,
          models: [{ model: "openai/gpt-5.6-sol", count: 2 }],
        },
      },
    },
    isError: false,
    isFetching: false,
    refetch: harness.refetch,
  }),
}));

vi.mock("~/lib/serverReactQuery", () => ({
  serverDiagnosticsQueryOptions: (enabled: boolean) => ({ enabled }),
}));

import { CodexRuntimeDiagnosticsSection } from "./CodexRuntimeDiagnosticsSection";

describe("CodexRuntimeDiagnosticsSection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    harness.refetch.mockReset();
  });

  it("shows route, MCP, binary, and session evidence without pretending Synara owns them", async () => {
    await render(<CodexRuntimeDiagnosticsSection active />);

    expect(document.body.textContent).toContain("Official app bundle");
    expect(document.body.textContent).toContain("openrouter · Responses API");
    expect(document.body.textContent).toContain("3 configured servers");
    expect(document.body.textContent).toContain("1 running of 2 active");
    expect(document.body.textContent).toContain("Synara only presents the resulting state");

    await page.getByRole("button", { name: "Refresh" }).click();
    expect(harness.refetch).toHaveBeenCalledOnce();
  });
});
