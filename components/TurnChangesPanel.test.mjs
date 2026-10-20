import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { TurnChangesPanel } = await jiti.import("./TurnChangesPanel.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { MessageView } = await jiti.import("./MessageView.tsx");
const patch = (before, after) => `--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
const change = (id, before, after) => ({ toolCallId: id, patch: patch(before, after), stats: { additions: 1, deletions: 1 } });
const file = (name, id) => ({ filePath: `/repo/${name}`, changes: [change(id, `${id}-before`, `${id}-after`)] });
function render(request) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TurnChangesPanel, { request, onClose() {}, onOpenFile() {} })));
}

test("opens the requested file and leaves unrelated file patches collapsed", () => {
  const html = render({ files: [file("a.ts", "first"), file("b.ts", "target"), file("c.ts", "last")], selectedFilePath: "/repo/b.ts", cwd: "/repo" });
  assert.match(html, /target-before/);
  assert.match(html, /target-after/);
  assert.doesNotMatch(html, /first-before|last-before/);
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 2);
  assert.match(html, /Open current file/);
});

test("defaults to the first file and preserves the order of multiple recorded edits", () => {
  const html = render({ files: [{ filePath: "/repo/a.ts", changes: [change("1", "old-one", "new-one"), change("2", "new-one", "new-two")] }, file("b.ts", "hidden")] });
  assert.ok(html.indexOf("Edit 1") < html.indexOf("Edit 2"));
  assert.ok(html.indexOf("old-one") < html.indexOf("new-two"));
  assert.doesNotMatch(html, /hidden-before/);
  assert.match(html, /not final net changes/);
});

test("legacy diffs remain readable and absent snapshots offer the current file", () => {
  const legacy = render({ files: [{ filePath: "/repo/a.ts", changes: [{ toolCallId: "1", patch: "+12 legacy result <script>", stats: null }] }] });
  assert.match(legacy, /legacy result &lt;script&gt;/);
  assert.doesNotMatch(legacy, /<script>/);
  for (const changes of [undefined, [{ toolCallId: "1", patch: null, stats: null }]]) {
    const html = render({ files: [{ filePath: "/repo/a.ts", changes }] });
    assert.match(html, /No diff record for this turn/);
    assert.match(html, /Open current file/);
    assert.match(html, /Line counts unavailable/);
  }
});

test("rendering a turn's history never fetches the current workspace Git diff", () => {
  const previousFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => { fetched = true; throw new Error("Must not replace recorded changes with current Git state"); };
  try { render({ files: [file("a.ts", "history")] }); }
  finally { globalThis.fetch = previousFetch; }
  assert.equal(fetched, false);
});

test("the final reply renders a single file summary before usage metadata", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(MessageView, {
      message: { role: "assistant", model: "test", timestamp: 1000, content: [{ type: "text", text: "Completed" }] },
      writtenFiles: [file("a.ts", "1")], cwd: "/repo", onOpenChanges() {},
    })));
  assert.equal((html.match(/Edited 1 file</g) ?? []).length, 1);
  assert.match(html, /View changes/);
  assert.match(html, /aria-label="View changes to \/repo\/a.ts"/);
});

test("card actions reach the dedicated panel and session changes discard its snapshot without clearing file tabs", async () => {
  const [shell, chat, message] = await Promise.all(["AppShell", "ChatWindow", "MessageView"].map((name) => readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8")));
  assert.match(shell, /onOpenChanges=\{handleOpenTurnChanges\}/);
  assert.match(chat, /onOpenChanges=\{onOpenChanges\}/);
  assert.match(message, /haveSameWrittenFiles\(prev\.writtenFiles, next\.writtenFiles\)/);
  assert.match(shell, /key=\{turnChanges\.revision\}/);
  const reset = shell.slice(shell.indexOf("if (!turnChanges ||"), shell.indexOf("}, [selectedSession?.id, selectedSession?.cwd, newSessionCwd, turnChanges, rightPanelMode]"));
  assert.match(reset, /turnChanges\.sessionId === selectedSession\?\.id/);
  assert.match(reset, /setTurnChanges\(null\)/);
  assert.doesNotMatch(reset, /setFileTabs/);
});

test("an interrupted turn can still show its successful writes without a final assistant reply", async () => {
  const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const extraction = chat.indexOf("const writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd)");
  const finalAnswer = chat.indexOf("if (turn.answerSource)", extraction);
  assert.ok(extraction >= 0 && finalAnswer > extraction);
  assert.match(chat.slice(finalAnswer), /else if \(writtenFiles\.length > 0\)[\s\S]*?<TurnWrittenFiles/);
});
