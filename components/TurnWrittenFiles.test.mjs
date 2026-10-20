import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

test("renders file count, relative directories, filenames and library tooltip triggers", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    onOpenFile() {},
    cwd: "/abs",
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /Edited 2 files/);
  assert.doesNotMatch(html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "", /<button/);
  assert.equal((html.match(/class="material-file-icon"/g) ?? []).length, 2);
  assert.match(html, />out\/<\/span>/);
  assert.match(html, /aria-label="View changes to \/abs\/out\/report\.html"/);
  assert.match(html, /data-slot="tooltip-trigger"/);
  assert.doesNotMatch(html, /title=/);
});

test("limits a long turn to the first three rows and offers the remaining count", () => {
  const files = Array.from({ length: 8 }, (_, index) => ({ filePath: `/repo/${index + 1}.ts` }));
  const html = render({ files, onOpenChanges() {}, cwd: "/repo" });
  assert.equal((html.match(/aria-label="View changes to/g) ?? []).length, 3);
  assert.match(html, /Show 5 more files/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /[4-8]\.ts/);
});

test("short cards need no expansion control and unknown stats are not reported as zero", () => {
  for (const count of [1, 2, 3]) {
    const html = render({ files: Array.from({ length: count }, (_, index) => ({ filePath: `/repo/${index}.ts` })), onOpenChanges() {} });
    assert.doesNotMatch(html, /more files|aria-expanded/);
    assert.equal((html.match(/Line counts unavailable/g) ?? []).length, count);
    assert.doesNotMatch(html, />\+0<|>-0<|>Partial totals</);
  }
});

test("shows only complete file stats in a partially known total", () => {
  const html = render({ files: [
    { filePath: "/repo/a.ts", changes: [{ toolCallId: "a", patch: "patch", stats: { additions: 12, deletions: 4 } }] },
    { filePath: "/repo/b.ts" },
  ], onOpenChanges() {} });
  const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.doesNotMatch(header, /Partial totals|<button/);
  assert.match(header, /Edited 2 files/);
  assert.match(header, /\+12/);
  assert.match(header, /-4/);
  assert.match(html, /Line counts unavailable/);
});

test("distinguishes same basenames using their Windows directories without displaying the project prefix", () => {
  const html = render({ files: [{ filePath: "C:/repo/src/a/index.ts" }, { filePath: "C:/repo/src/b/index.ts" }], cwd: "C:\\repo", onOpenChanges() {} });
  assert.match(html, />src\/a\/<\/span>/);
  assert.match(html, />src\/b\/<\/span>/);
  assert.equal((html.match(/>index\.ts<\/span>/g) ?? []).length, 2);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});
