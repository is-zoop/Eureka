import { describe, expect, it } from "vitest";
import { reconnectDelay } from "./reconnect.js";

describe("reconnectDelay", () => {
  it("uses bounded exponential backoff with jitter", () => {
    expect(reconnectDelay(0, () => 0.5)).toBe(250);
    expect(reconnectDelay(2, () => 0.5)).toBe(1000);
    expect(reconnectDelay(20, () => 0.5)).toBe(10_000);
  });
});
