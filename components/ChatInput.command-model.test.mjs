import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("renders the model picker with the shared command components", () => {
  assert.match(source, /<Command shouldFilter=\{false\}/);
  assert.match(source, /<CommandInput[\s\S]*?onValueChange=\{setModelFilter\}/);
  assert.match(source, /<CommandList style=\{\{ flex: 1, minHeight: 0, maxHeight: "none" \}\}>/);
  assert.match(source, /<CommandGroup key=\{group\.provider\}/);
  assert.match(source, /<CommandItem[\s\S]*?onSelect=\{\(\) =>/);
});

test("caps the model picker at a fixed desktop height with a scrollable list", () => {
  assert.match(source, /Math\.min\(360, modelDropdownRect\.top - 8, viewportHeight - 16\)/);
  assert.match(source, /height: menuHeight/);
  assert.match(source, /<CommandList style=\{\{ flex: 1, minHeight: 0, maxHeight: "none" \}\}>/);
});
