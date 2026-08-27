import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("opens the add command palette from the plus button", () => {
  assert.match(source, /const \[addMenuOpen, setAddMenuOpen\] = useState\(false\)/);
  assert.match(source, /aria-label=\{t\("chat\.openAddMenu"\)\}/);
  assert.match(source, /<CommandInput[\s\S]*?onValueChange=\{setAddMenuQuery\}/);
  assert.match(source, /bottom: "calc\(100% \+ 8px\)"/);
  assert.match(source, /left: 0,\s*right: 0,/);
  assert.match(source, /height: isMobile \? 280 : 320/);
});

test("groups commands into add, built-in, extension, and skill sections", () => {
  assert.match(source, /const COMMAND_PALETTE_SOURCES = \["builtin", "extension", "skill"\] as const/);
  assert.match(source, /command\.source === "builtin" \|\| command\.source === "prompt"/);
  assert.match(source, /<CommandGroup heading=\{t\("chat\.add"\)\}>/);
  assert.match(source, /<CommandPaletteIcon kind="add"/);
  assert.match(source, /<CommandPaletteIcon kind=\{group\.source\}/);
});

test("keeps the existing image-only attachment protocol", () => {
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /fileInputRef\.current\?\.click\(\)/);
  assert.match(source, /slashMenuOpen && slashQuery !== null && !addMenuOpen/);
});

test("keeps command descriptions on one truncated line with a tooltip", () => {
  assert.match(source, /title=\{description \? `\/\$\{command\.name\} · \$\{description\}`/);
  assert.match(source, /const commandDescriptionColor = "var\(--text-muted\)"/);
  assert.match(source, /className="truncate text-\[11px\]" style=\{\{ color: commandDescriptionColor \}\}/);
});

test("uses the same compact command-list treatment for slash commands", () => {
  assert.match(source, /slashMenuOpen && slashQuery !== null && !addMenuOpen/);
  assert.match(source, /height: isMobile \? 280 : 320/);
  assert.match(source, /value=\{slashQuery \?\? ""\}[\s\S]*?onValueChange=\{\(query\) =>/);
  assert.match(source, /const nextValue = `\/\$\{query\}`/);
  assert.match(source, /title=\{description \? `\/\$\{command\.name\} · \$\{description\}`/);
});
