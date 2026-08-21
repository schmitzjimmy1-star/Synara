import { describe, expect, it, vi } from "vitest";
import { ThreadId } from "@synara/contracts";

import {
  getSidechatCreator,
  registerSidechatCreator,
  subscribeSidechatCreator,
} from "./sidechatCreatorRegistry";

const THREAD_ID = ThreadId.makeUnsafe("thread-sidechat-host");

describe("sidechat creator capability", () => {
  it("publishes registration and unregistration as observable capability changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSidechatCreator(THREAD_ID, listener);
    const creator = vi.fn().mockResolvedValue(true);

    const unregister = registerSidechatCreator(THREAD_ID, creator);
    expect(getSidechatCreator(THREAD_ID)).toBe(creator);
    expect(listener).toHaveBeenCalledTimes(1);

    unregister();
    expect(getSidechatCreator(THREAD_ID)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
