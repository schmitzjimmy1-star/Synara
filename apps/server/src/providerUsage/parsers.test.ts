import type { ServerProviderUsageSnapshot } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { parseCodexUsage } from "./providers/codex.ts";

const NOW_MS = 1_738_000_000_000;

function limit(snapshot: ServerProviderUsageSnapshot, window: string) {
  return snapshot.limits.find((entry) => entry.window === window);
}

function usageLine(snapshot: ServerProviderUsageSnapshot, label: string) {
  return snapshot.usageLines.find((entry) => entry.label === label);
}

describe("parseCodexUsage", () => {
  const json = {
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 6, reset_at: 1_738_300_000 },
      secondary_window: {
        used_percent: 24,
        reset_at: 1_738_900_000,
        limit_window_seconds: 604_800,
      },
    },
    credits: { has_credits: true, balance: 5.39 },
  };

  it("maps rate-limit windows, credits, and plan", () => {
    const snapshot = parseCodexUsage({ json, nowMs: NOW_MS });
    expect(snapshot.status).toBe("ok");
    expect(snapshot.planName).toBe("Plus");
    expect(limit(snapshot, "5h")?.usedPercent).toBe(6);
    expect(limit(snapshot, "5h")?.windowDurationMins).toBe(300);
    expect(limit(snapshot, "Weekly")?.usedPercent).toBe(24);
    expect(limit(snapshot, "Weekly")?.windowDurationMins).toBe(10_080);
    expect(usageLine(snapshot, "Credits")?.value).toContain("5.39");
  });

  it("prefers the response headers over the body for used percent", () => {
    const snapshot = parseCodexUsage({
      json,
      headers: { "x-codex-primary-used-percent": "12" },
      nowMs: NOW_MS,
    });
    expect(limit(snapshot, "5h")?.usedPercent).toBe(12);
  });
});
