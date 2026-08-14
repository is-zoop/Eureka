import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "./session-list.js";
const sessions = [{ id: "a", name: "Current", createdAt: 1, modifiedAt: 1, messageCount: 0, preview: "" }, { id: "b", createdAt: 1, modifiedAt: 1, messageCount: 0, preview: "Old" }];
describe("SessionList", () => { it("highlights current and switches only when enabled", () => { const onSwitch = vi.fn(); render(<SessionList sessions={sessions} currentId="a" disabled={false} onNew={vi.fn()} onSwitch={onSwitch} />); expect(screen.getByText("Current").closest("button")?.disabled).toBe(true); fireEvent.click(screen.getByText("Old")); expect(onSwitch).toHaveBeenCalledWith("b"); }); });
