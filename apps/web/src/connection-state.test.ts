import { describe, expect, it } from "vitest";
import { applySnapshot, applyUsage, connectionClosed } from "./connection-state.js";

const snapshot = { sessionId: "s", cwd: "E:/work", phase: "idle" as const, thinkingLevel: "low", messages: [] };
describe("connection state", () => {
  it("uses a reconnect snapshot as authoritative state", () => {
    const connected = applySnapshot({ connection: "reconnecting", error: { code: "x", message: "x", recoverable: true } }, snapshot);
    expect(connected).toMatchObject({ connection: "connected", snapshot, error: undefined });
  });
  it("merges usage without losing a snapshot", () => {
    expect(applyUsage({ connection: "connected", snapshot }, { inputTokens: 3 }, { percentage: 2 }).snapshot).toMatchObject({ usage: { inputTokens: 3 }, context: { percentage: 2 } });
    expect(connectionClosed({ connection: "connected", snapshot }).connection).toBe("reconnecting");
  });
});
