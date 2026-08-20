import { describe, expect, it } from "vitest";

import { RIGHT_DOCK_PANE_KINDS } from "~/rightDockStore.logic";
import {
  RIGHT_DOCK_ADD_MENU_KINDS,
  getRightDockPaneMeta,
  resolveRightDockAddMenuKinds,
  resolveRightDockLauncherItems,
} from "./rightDockPaneMeta";

describe("RIGHT_DOCK_ADD_MENU_KINDS", () => {
  it("offers the explorer pane but not the chat-driven file pane", () => {
    // The "+" menu surfaces the file-tree explorer; single-file preview tabs are
    // opened by clicking a file reference in chat, not from the add menu.
    expect(RIGHT_DOCK_ADD_MENU_KINDS).toContain("explorer");
    expect(RIGHT_DOCK_ADD_MENU_KINDS).not.toContain("file");
  });

  it("keeps the canonical kind order minus context-only panes", () => {
    expect([...RIGHT_DOCK_ADD_MENU_KINDS]).toEqual(
      RIGHT_DOCK_PANE_KINDS.filter((kind) => kind !== "file" && kind !== "pullRequest"),
    );
  });

  it("uses the Codex-facing labels while preserving secondary tools", () => {
    expect(getRightDockPaneMeta("agentBrowser").label).toBe("Browser");
    expect(getRightDockPaneMeta("browser").label).toBe("Manual Browser");
    expect(getRightDockPaneMeta("explorer").label).toBe("Files");
    expect(getRightDockPaneMeta("sidechat").label).toBe("Side chat");
  });
});

describe("resolveRightDockLauncherItems", () => {
  it("keeps the canonical five destinations stable without a repository", () => {
    expect(
      resolveRightDockLauncherItems({
        hasWorkspace: true,
        hasGitRepository: false,
        hasReview: false,
        canStartSidechat: true,
        sidechatUnavailableReason: "Side chat unavailable",
      }).map(({ kind, label }) => [kind, label]),
    ).toEqual([
      ["diff", "Review"],
      ["terminal", "Terminal"],
      ["agentBrowser", "Browser"],
      ["explorer", "Files"],
      ["sidechat", "Side chat"],
    ]);
  });

  it("does not put secondary manual browser or source control in the primary launcher", () => {
    expect(
      resolveRightDockLauncherItems({
        hasWorkspace: true,
        hasGitRepository: true,
        hasReview: true,
        canStartSidechat: true,
        sidechatUnavailableReason: "Side chat unavailable",
      }).map(({ kind }) => kind),
    ).toEqual(["diff", "terminal", "agentBrowser", "explorer", "sidechat"]);
  });

  it("disables workspace-backed destinations instead of shifting the launcher", () => {
    expect(
      resolveRightDockLauncherItems({
        hasWorkspace: false,
        hasGitRepository: false,
        hasReview: false,
        canStartSidechat: false,
        sidechatUnavailableReason: "Send the first prompt before starting a Side chat",
      }).map(({ kind, disabled }) => [kind, disabled === true]),
    ).toEqual([
      ["diff", true],
      ["terminal", true],
      ["agentBrowser", false],
      ["explorer", true],
      ["sidechat", true],
    ]);
  });

  it("keeps review visible but disabled for a clean Git repository", () => {
    expect(
      resolveRightDockLauncherItems({
        hasWorkspace: true,
        hasGitRepository: true,
        hasReview: false,
        canStartSidechat: true,
        sidechatUnavailableReason: "Side chat unavailable",
      }).map(({ kind, disabled }) => [kind, disabled === true]),
    ).toEqual([
      ["diff", true],
      ["terminal", false],
      ["agentBrowser", false],
      ["explorer", false],
      ["sidechat", false],
    ]);
  });

  it("explains why Terminal and Side chat are unavailable instead of opening dead panes", () => {
    const items = resolveRightDockLauncherItems({
      hasWorkspace: false,
      hasGitRepository: false,
      hasReview: false,
      canStartSidechat: false,
      sidechatUnavailableReason: "Send the first prompt before starting a Side chat",
    });

    expect(items.find(({ kind }) => kind === "terminal")).toMatchObject({
      disabled: true,
      unavailableReason: "Terminal requires an open workspace",
    });
    expect(items.find(({ kind }) => kind === "sidechat")).toMatchObject({
      disabled: true,
      unavailableReason: "Send the first prompt before starting a Side chat",
    });
  });
});

describe("resolveRightDockAddMenuKinds", () => {
  it("omits Terminal and Side chat until their runtime prerequisites exist", () => {
    const kinds = resolveRightDockAddMenuKinds({
      hasWorkspace: false,
      hasGitRepository: false,
      hasReview: false,
      canStartSidechat: false,
    });

    expect(kinds).not.toContain("terminal");
    expect(kinds).not.toContain("sidechat");
  });

  it("includes Terminal and Side chat once the workspace and creator are ready", () => {
    const kinds = resolveRightDockAddMenuKinds({
      hasWorkspace: true,
      hasGitRepository: true,
      hasReview: true,
      canStartSidechat: true,
    });

    expect(kinds).toContain("terminal");
    expect(kinds).toContain("sidechat");
  });
});
