import { describe, expect, it } from "vitest";

import { isAmbiguousOrchestrationDispatchFailure } from "./orchestrationDispatchRecovery";

describe("isAmbiguousOrchestrationDispatchFailure", () => {
  it("recognizes a reconnect rejection with an unknown server outcome", () => {
    expect(
      isAmbiguousOrchestrationDispatchFailure({
        code: "WS_REQUEST_RECONNECTED",
        retryable: true,
      }),
    ).toBe(true);
  });

  it.each([
    new Error("server rejected the command"),
    { code: "WS_REQUEST_RECONNECTED", retryable: false },
    { code: "SOME_OTHER_ERROR", retryable: true },
    null,
  ])("does not classify a definite failure as ambiguous", (error) => {
    expect(isAmbiguousOrchestrationDispatchFailure(error)).toBe(false);
  });
});
