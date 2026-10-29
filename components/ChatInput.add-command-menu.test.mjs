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

test("groups commands into add, built-in, plugin, extension, and skill sections", () => {
  assert.match(source, /const COMMAND_PALETTE_SOURCES = \["builtin", "plugin", "extension", "skill"\] as const/);
  assert.match(source, /command\.source === "builtin" \|\| command\.source === "prompt"/);
  assert.match(source, /<CommandGroup heading=\{t\("chat\.add"\)\}>/);
  assert.match(source, /<CommandPaletteIcon kind="add"/);
  assert.match(source, /<SlashCommandPaletteIcon command=\{command\} source=\{group\.source\}/);
});

test("offers files and folders while retaining the image attachment pipeline", () => {
  assert.doesNotMatch(source, /accept="image\/\*"/);
  assert.doesNotMatch(source, /<AttachmentPicker/);
  assert.match(source, /invoke<string\[\]>\("desktop_select_attachments", \{ cwd: cwd \?\? null \}\)/);
  assert.match(source, /void openAttachmentPicker\(\)/);
  assert.match(source, /await processImageFiles\(files\)/);
  assert.match(source, /fileInputRef\.current\?\.click\(\)/);
  assert.match(source, /slashMenuOpen && slashQuery !== null && !addMenuOpen/);
});

test("keeps command descriptions on one truncated line with a tooltip", () => {
  assert.match(source, /tooltip=\{description \? `\$\{label\} · \$\{description\}` : label\}/);
  assert.match(source, /data-command-description className=\{paletteStyles.description\}/);
  assert.match(source, /element.scrollWidth > element.clientWidth/);
});

test("uses the same compact command-list treatment for slash commands", () => {
  assert.match(source, /slashMenuOpen && slashQuery !== null && !addMenuOpen/);
  assert.match(source, /height: isMobile \? 280 : 320/);
  assert.doesNotMatch(source, /<CommandInput\s+value=\{slashQuery \?\? ""\}/);
  assert.match(source, /tooltip=\{description \? `\$\{label\} · \$\{description\}` : label\}/);
});

test("keeps @ file filtering in the composer instead of adding a second search field", () => {
  assert.match(source, /const atQueryText = atQuery\?\.query \?\? null/);
  assert.match(source, /atMenuOpen && atQuery !== null/);
  assert.match(source, /background: commandPaletteBackground/);
});


test("both command menus display plain names while retaining canonical command selection", () => {
  assert.equal(source.split('const label = command.source === "plugin" ? command.name : composerCommandLabel(command.name);').length - 1, 2);
  assert.equal(source.split('onSelect={() => applySlashCommand(command)}').length - 1, 2);
  assert.doesNotMatch(source, /command\.source === "plugin" \? "" : "\/"/);
});
