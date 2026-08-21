import { describe, expect, it } from "vitest";

import { resolveAgentBrowserPointerCoordinates } from "./AgentBrowserPanel";

describe("resolveAgentBrowserPointerCoordinates", () => {
  const viewport = {
    bounds: { left: 100, top: 50, width: 800, height: 800 },
    viewportWidth: 800,
    viewportHeight: 400,
  };

  it("maps the visible frame corners and center into browser coordinates", () => {
    expect(
      resolveAgentBrowserPointerCoordinates({ ...viewport, clientX: 100, clientY: 250 }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      resolveAgentBrowserPointerCoordinates({ ...viewport, clientX: 500, clientY: 450 }),
    ).toEqual({ x: 400, y: 200 });
    expect(
      resolveAgentBrowserPointerCoordinates({ ...viewport, clientX: 900, clientY: 650 }),
    ).toEqual({ x: 800, y: 400 });
  });

  it("rejects pointer input in temporary letterbox space", () => {
    expect(
      resolveAgentBrowserPointerCoordinates({ ...viewport, clientX: 500, clientY: 100 }),
    ).toBeNull();
    expect(
      resolveAgentBrowserPointerCoordinates({ ...viewport, clientX: 500, clientY: 700 }),
    ).toBeNull();
  });
});
