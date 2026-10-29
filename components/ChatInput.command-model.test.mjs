import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("./ComposerSelectors.module.css", import.meta.url), "utf8");

test("renders the model picker with the shared command components", () => {
  assert.match(source, /<Command shouldFilter=\{false\}/);
  assert.match(source, /<CommandInput[\s\S]*?onValueChange=\{setModelFilter\}/);
  assert.match(source, /<CommandList style=\{\{ flex: 1, minHeight: 0, maxHeight: "none" \}\}>/);
  assert.match(source, /<CommandGroup key=\{group\.provider\}/);
  assert.match(source, /<CommandItem[\s\S]*?onSelect=\{\(\) =>/);
});

test("keeps the searchable picker anchored and inside the available viewport", () => {
  assert.match(source, /<Popover\.Positioner side="top" align="start" sideOffset=\{6\} collisionPadding=\{8\}/);
  assert.match(styles, /max-height: min\(360px, var\(--available-height\)\)/);
  assert.match(styles, /width: min\(280px, calc\(100vw - 16px\)\)/);
  assert.match(source, /<CommandList style=\{\{ flex: 1, minHeight: 0, maxHeight: "none" \}\}>/);
});
