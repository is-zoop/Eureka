import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("uses the shared dropdown menu for the upward reasoning selector", () => {
  assert.match(
    source,
    /<DropdownMenu open=\{thinkingDropdownOpen\} onOpenChange=\{setThinkingDropdownOpen\}>[\s\S]*?<DropdownMenuContent[\s\S]*?align=\{isMobile \? "start" : "end"\}[\s\S]*?side="top"/,
  );
  assert.match(source, /<DropdownMenuCheckboxItem[\s\S]*?onCheckedChange/);
});
