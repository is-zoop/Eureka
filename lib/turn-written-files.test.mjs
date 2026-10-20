import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { extractTurnWrittenFiles, getWrittenFileStats, summarizeWrittenFiles, haveSameWrittenFiles } = await jiti.import("./turn-written-files.ts");

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function okResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }] };
}

function errorResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "boom" }], isError: true };
}

function results(...entries) {
  return new Map(entries.map((r) => [r.toolCallId, r]));
}

function paths(content, toolResults, cwd) {
  return extractTurnWrittenFiles(content, toolResults, cwd).map((f) => f.filePath);
}

test("extracts a file from a successful write tool call", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/report.html"]);
});

test("extracts a file from a successful edit tool call using input.path", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/src/a.ts"]);
});

test("accepts namespaced write/edit tool names from MCP servers", () => {
  const content = [
    toolCall("1", "write_file", { file_path: "/abs/a.txt" }),
    toolCall("2", "fs.edit", { file_path: "/abs/b.txt" }),
    toolCall("3", "str_replace_editor", { file_path: "/abs/c.txt" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2"), okResult("3"))),
    ["/abs/a.txt", "/abs/b.txt", "/abs/c.txt"],
  );
});

test("skips a tool call whose result errored", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(errorResult("1"))), []);
});

test("skips a tool call whose result has not arrived (streaming)", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results()), []);
  assert.deepEqual(paths(content, undefined), []);
});

test("deduplicates the same file written then edited", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/report.html" }),
    toolCall("2", "edit", { path: "/abs/out/report.html" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), ["/abs/out/report.html"]);
});

test("resolves a relative path against cwd", () => {
  const content = [toolCall("1", "write", { file_path: "out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1")), "/abs"), ["/abs/out/report.html"]);
});

test("resolves extensionless and dot-prefixed filenames against cwd", () => {
  const content = [
    toolCall("1", "write", { path: "LICENSE" }),
    toolCall("2", "write", { path: ".env" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2")), "/repo"),
    ["/repo/LICENSE", "/repo/.env"],
  );
});

test("preserves path characters that have special meaning in hrefs", () => {
  const content = [
    toolCall("1", "write", { path: "release#1.md" }),
    toolCall("2", "write", { path: "query?.json" }),
    toolCall("3", "write", { path: "report.md:42" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2"), okResult("3")), "/repo"),
    ["/repo/release#1.md", "/repo/query?.json", "/repo/report.md:42"],
  );
});

test("normalizes Windows-relative tool paths against a Windows cwd", () => {
  const content = [toolCall("1", "write", { path: "src\\report.html" })];
  assert.deepEqual(
    paths(content, results(okResult("1")), "C:\\repo"),
    ["C:/repo/src/report.html"],
  );
});

test("skips non-writing tools like read and bash", () => {
  const content = [
    toolCall("1", "read", { file_path: "/abs/a.ts" }),
    toolCall("2", "bash", { command: "echo hi > /abs/a.txt" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), []);
});

test("ignores paths that only appear in the reply text", () => {
  // A path the assistant merely writes in prose is not evidence of a write.
  const content = [
    { type: "text", text: "I saved the report to /abs/out/report.html for you." },
  ];
  assert.deepEqual(paths(content, results()), []);
});

test("lists only the file actually written, not others named in the text", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/real.html" }),
    { type: "text", text: "See also /abs/out/imagined.html and /etc/passwd" },
  ];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/real.html"]);
});

test("skips a write call missing both file_path and path", () => {
  const content = [toolCall("1", "write", { content: "hi" })];
  assert.deepEqual(paths(content, results(okResult("1"))), []);
});

test("returns an empty array for an empty or text-only turn", () => {
  assert.deepEqual(paths([], results()), []);
  assert.deepEqual(paths([{ type: "text", text: "hi" }], results()), []);
});

const PATCH = "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+extra\n";
function patchedResult(id, patch = PATCH) {
  return { ...okResult(id), details: { patch, diff: "legacy display must not override the patch" } };
}

test("groups ordered edits and accumulates only the successful operations in this turn", () => {
  const content = [toolCall("1", "edit", { path: "/repo/a.ts" }), toolCall("2", "edit", { path: "/repo/b.ts" }), toolCall("3", "edit", { path: "/repo/a.ts" }), toolCall("4", "edit", { path: "/repo/a.ts" })];
  const files = extractTurnWrittenFiles(content, results(patchedResult("1"), patchedResult("2"), patchedResult("3"), errorResult("4")));
  assert.deepEqual(files.map((file) => file.filePath), ["/repo/a.ts", "/repo/b.ts"]);
  assert.deepEqual(files[0].changes.map((change) => change.toolCallId), ["1", "3"]);
  assert.equal(files[0].changes[0].patch, PATCH);
  assert.deepEqual(getWrittenFileStats(files[0]), { additions: 4, deletions: 2 });
  assert.deepEqual(summarizeWrittenFiles(files), { additions: 6, deletions: 3, knownFiles: 2, partial: false });
});

test("missing write snapshots make a file unknown and exclude it from partial totals", () => {
  const files = extractTurnWrittenFiles([
    toolCall("write", "write", { path: "/repo/a.ts", content: "cannot infer the old content" }),
    toolCall("edit", "edit", { path: "/repo/a.ts" }),
    toolCall("known", "edit", { path: "/repo/b.ts" }),
  ], results(okResult("write"), patchedResult("edit"), patchedResult("known")));
  assert.equal(getWrittenFileStats(files[0]), null);
  assert.deepEqual(summarizeWrittenFiles(files), { additions: 2, deletions: 1, knownFiles: 1, partial: true });
  assert.equal(getWrittenFileStats({ filePath: "/repo/legacy.ts" }), null);
});

test("retains legacy and unavailable diffs without inventing line counts", () => {
  const legacy = "+12 legacy new line\n-12 legacy old line";
  const files = extractTurnWrittenFiles([
    toolCall("1", "edit", { path: "/repo/legacy.ts" }),
    toolCall("2", "edit", { path: "/repo/no-snapshot.ts" }),
  ], results({ ...okResult("1"), details: { diff: legacy } }, okResult("2")));
  assert.equal(files[0].changes[0].patch, legacy);
  assert.equal(files[1].changes[0].patch, null);
  assert.equal(getWrittenFileStats(files[0]), null);
  assert.deepEqual(summarizeWrittenFiles(files), { additions: 0, deletions: 0, knownFiles: 0, partial: true });
});

test("deduplicates Windows case variants and repeated tool events while preserving POSIX identity", () => {
  const duplicate = toolCall("1", "edit", { path: "C:\\Repo\\a.ts" });
  const files = extractTurnWrittenFiles([duplicate, duplicate, toolCall("2", "edit", { path: "c:/repo/A.ts" })], results(patchedResult("1"), patchedResult("2")));
  assert.equal(files.length, 1);
  assert.equal(files[0].changes.length, 2);
  assert.deepEqual(getWrittenFileStats(files[0]), { additions: 4, deletions: 2 });
  assert.equal(extractTurnWrittenFiles([toolCall("1", "edit", { path: "/repo/a.ts" }), toolCall("2", "edit", { path: "/repo/A.ts" })], results(patchedResult("1"), patchedResult("2"))).length, 2);
});

test("patch hunk content that resembles file headers is counted as edits", () => {
  const patch = "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n--- actual removed content\n+++ actual added content\n";
  const files = extractTurnWrittenFiles([toolCall("1", "edit", { path: "/repo/demo.ts" })], results(patchedResult("1", patch)));
  assert.deepEqual(getWrittenFileStats(files[0]), { additions: 1, deletions: 1 });
});

test("does not count multi-file or malformed patches against a single tool path", () => {
  for (const patch of [PATCH + PATCH, "--- a/demo.ts\n+++ b/demo.ts\n+not a hunk"]) {
    const files = extractTurnWrittenFiles([toolCall("1", "edit", { path: "/repo/demo.ts" })], results(patchedResult("1", patch)));
    assert.equal(getWrittenFileStats(files[0]), null);
    assert.equal(files[0].changes[0].patch, patch);
  }
});

test("memo comparison keeps historical cards stable but notices late results and stats changes", () => {
  const content = [toolCall("1", "edit", { path: "/repo/demo.ts" })];
  const before = extractTurnWrittenFiles(content, results(okResult("1")));
  const after = extractTurnWrittenFiles(content, results(patchedResult("1")));
  assert.equal(haveSameWrittenFiles(before, structuredClone(before)), true);
  assert.equal(haveSameWrittenFiles(before, after), false);
  assert.equal(haveSameWrittenFiles(undefined, after), false);
  assert.equal(haveSameWrittenFiles(after, []), false);
  const changedStats = structuredClone(after);
  changedStats[0].changes[0].stats.additions++;
  assert.equal(haveSameWrittenFiles(after, changedStats), false);
});
