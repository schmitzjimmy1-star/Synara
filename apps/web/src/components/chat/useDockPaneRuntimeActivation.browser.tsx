// FILE: useDockPaneRuntimeActivation.browser.tsx
// Purpose: Browser-runtime regressions for restored heavy dock pane hydration.
// Layer: Web browser tests
// Depends on: useDockPaneRuntimeActivation and a real React/browser event loop.

import { ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import { useDockPaneRuntimeActivation } from "~/hooks/useDockPaneRuntimeActivation";
import type { RightDockPane } from "~/rightDockStore.logic";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const BROWSER_PANE: RightDockPane = {
  id: "browser-pane",
  kind: "browser",
  threadId: null,
  diffTurnId: null,
  diffFilePath: null,
  filePath: null,
  pullRequestProjectId: null,
  pullRequestRepository: null,
  pullRequestNumber: null,
  pullRequestInitialTab: null,
};

interface RuntimeActivationProps {
  readonly threadId: ThreadId;
  readonly activePane: RightDockPane | null;
  readonly dockOpen: boolean;
}

describe("useDockPaneRuntimeActivation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores a browser pane after a route round-trip when animation frames are paused", async () => {
    let nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => nextFrameId++);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const initialProps: RuntimeActivationProps = {
      threadId: THREAD_A,
      activePane: BROWSER_PANE,
      dockOpen: true,
    };

    const hook = await renderHook(
      (props?: RuntimeActivationProps) =>
        useDockPaneRuntimeActivation({
          threadId: props?.threadId ?? THREAD_A,
          activePane: props ? props.activePane : BROWSER_PANE,
          dockOpen: props?.dockOpen ?? true,
        }),
      {
        initialProps,
      },
    );

    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    await hook.rerender({ threadId: THREAD_B, activePane: null, dockOpen: true });
    await hook.rerender({
      threadId: THREAD_A,
      activePane: { ...BROWSER_PANE },
      dockOpen: true,
    });

    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");

    await hook.unmount();
  });

  it("keeps a restored collapsed terminal asleep until the dock opens", async () => {
    const terminalPane: RightDockPane = { ...BROWSER_PANE, id: "terminal-pane", kind: "terminal" };
    const initialProps: RuntimeActivationProps = {
      threadId: THREAD_A,
      activePane: terminalPane,
      dockOpen: false,
    };
    const hook = await renderHook(
      (props?: RuntimeActivationProps) => useDockPaneRuntimeActivation(props ?? initialProps),
      {
        initialProps,
      },
    );

    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(hook.result.current.activePaneRuntimeMode).toBe("preview");

    await hook.rerender({ threadId: THREAD_A, activePane: terminalPane, dockOpen: true });
    await expect
      .poll(() => hook.result.current.activePaneRuntimeMode, { timeout: 1_000 })
      .toBe("live");
    await hook.unmount();
  });
});
