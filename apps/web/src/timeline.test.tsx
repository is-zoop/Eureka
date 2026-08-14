import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline } from "./timeline.js";
describe("Timeline", () => { it("renders thinking, system and tool rows", () => { render(<Timeline rows={[{ id: "a", kind: "thinking", text: "reason" }, { id: "s", kind: "system", text: "done" }, { id: "t", kind: "tool", text: "log" }]} />); expect(screen.getByText("reason")).toBeTruthy(); expect(screen.getByText("done")).toBeTruthy(); expect(screen.getByText("log")).toBeTruthy(); }); });
