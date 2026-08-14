import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCard } from "./tool-card.js";

describe("ToolCard", () => {
  afterEach(cleanup);
  it("shows an empty fallback and collapses safely", () => {
    render(<ToolCard text="" />);
    expect(screen.getByText("Waiting for output…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /tool activity/i }));
    expect(screen.queryByText("Waiting for output…")).toBeNull();
  });
  it("does not crash when clipboard is unavailable", () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<ToolCard text="log" />);
    expect(() => fireEvent.click(screen.getAllByTestId("tool-copy").at(-1)!)).not.toThrow();
  });
  it("uses Bash and generic fallbacks without assuming tool payload shape", () => {
    render(<><ToolCard tool={{ execution: { id: "bash", name: "BASH", input: { command: "echo hello" }, status: "running" }, delta: "hello\n", open: true, manuallySet: false }} /><ToolCard tool={{ execution: { id: "other", name: "Unknown", input: { value: 1 }, status: "success", output: { value: 2 } }, delta: "", open: true, manuallySet: false }} /></>);
    expect(screen.getByText("$ echo hello")).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText(/"value": 2/)).toBeTruthy();
  });
});
