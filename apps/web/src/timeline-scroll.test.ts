import { describe, expect, it } from "vitest";
import { isAtLatest, scrollToLatest } from "./timeline-scroll.js";

describe("timeline scrolling", () => {
  it("treats the final 48px as the latest position", () => {
    expect(isAtLatest({ scrollHeight: 1000, scrollTop: 552, clientHeight: 400 })).toBe(false);
    expect(isAtLatest({ scrollHeight: 1000, scrollTop: 553, clientHeight: 400 })).toBe(true);
  });

  it("jumps directly to the latest content", () => {
    const target = { scrollHeight: 1000, scrollTop: 120 };
    scrollToLatest(target);
    expect(target.scrollTop).toBe(1000);
  });
});
