import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const { createWriteDiffTool, EUREKA_WRITE_DIFF_EXTENSION, WRITE_DIFF_MAX_BYTES, WRITE_DIFF_MAX_LINES } = await jiti.import("./write-diff.ts");
const { extractTurnWrittenFiles, getWrittenFileStats, summarizeWrittenFiles } = await jiti.import("./turn-written-files.ts");

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "eureka-write-diff-"));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("eureka-write-diff-"));
    await rm(target, { recursive: true, force: true });
  });
  return root;
}

function execute(tool, root, filePath, content, signal, id = "write") {
  return tool.execute(id, { path: filePath, content }, signal, undefined, { cwd: root });
}

function filesFromResult(root, filePath, result) {
  // Exercise the exact JSON-compatible tool-result shape used by history/SSE.
  const restored = JSON.parse(JSON.stringify(result));
  return extractTurnWrittenFiles([{ type: "toolCall", toolCallId: "write", toolName: "write", input: { path: filePath } }],
    new Map([["write", { role: "toolResult", toolCallId: "write", ...restored }]]), root);
}

test("preserves the built-in write schema, descriptions and prompt instructions", () => {
  const native = createWriteToolDefinition(process.cwd());
  const tracked = createWriteDiffTool(process.cwd());
  for (const field of ["name", "label", "description", "parameters", "promptSnippet", "promptGuidelines", "executionMode", "prepareArguments"]) {
    assert.deepEqual(tracked[field], native[field]);
  }
});

test("overwrites a file and persists a patch consumed by the existing file card", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.ts"), "keep\nold\n");
  const result = await execute(createWriteDiffTool(root), root, "a.ts", "keep\nnew\nextra\n");
  assert.equal(await readFile(join(root, "a.ts"), "utf8"), "keep\nnew\nextra\n");
  assert.match(result.content[0].text, /Successfully wrote/);
  assert.match(result.details.patch, /-old/);
  const files = filesFromResult(root, "a.ts", result);
  assert.deepEqual(getWrittenFileStats(files[0]), { additions: 2, deletions: 1 });
  assert.deepEqual(summarizeWrittenFiles(files), { additions: 2, deletions: 1, knownFiles: 1, partial: false });
});

test("new files use an empty baseline and retain recursive directory creation", async (t) => {
  const root = await workspace(t);
  const result = await execute(createWriteDiffTool(root), root, "new/nested/file.ts", "one\ntwo");
  assert.equal(await readFile(join(root, "new/nested/file.ts"), "utf8"), "one\ntwo");
  assert.deepEqual(getWrittenFileStats(filesFromResult(root, "new/nested/file.ts", result)[0]), { additions: 2, deletions: 0 });
});

test("identical writes and creation of an empty file have known zero counts", async (t) => {
  const root = await workspace(t);
  const tool = createWriteDiffTool(root);
  for (const [filePath, content] of [["same.ts", "unchanged\n"], ["empty.ts", ""]]) {
    if (content) await writeFile(join(root, filePath), content);
    const result = await execute(tool, root, filePath, content);
    assert.deepEqual(getWrittenFileStats(filesFromResult(root, filePath, result)[0]), { additions: 0, deletions: 0 });
    assert.equal(await readFile(join(root, filePath), "utf8"), content);
  }
});

test("concurrent writes snapshot the previous queued result rather than the same old baseline", async (t) => {
  const root = await workspace(t);
  const filePath = join(root, "same.ts");
  await writeFile(filePath, "original\n");
  const tool = createWriteDiffTool(root);
  const [first, second] = await Promise.all([
    execute(tool, root, "same.ts", "first\n", undefined, "first"),
    execute(tool, root, filePath, "second\n", undefined, "second"),
  ]);
  assert.match(first.details.patch, /-original/);
  assert.match(first.details.patch, /\+first/);
  assert.match(second.details.patch, /-first/);
  assert.doesNotMatch(second.details.patch, /original/);
  assert.equal(await readFile(filePath, "utf8"), "second\n");
});

test("tracked writes share the SDK mutation queue with native edits", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.ts"), "original\n");
  let beginWrite;
  const started = new Promise((resolve) => { beginWrite = resolve; });
  let finishWrite;
  const allowed = new Promise((resolve) => { finishWrite = resolve; });
  const tool = createWriteDiffTool(root, { operations: {
    mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
    writeFile: async (filePath, content) => { beginWrite(); await allowed; await writeFile(filePath, content); },
  } });
  const writing = execute(tool, root, "a.ts", "written\n");
  await started;
  const editing = createEditToolDefinition(root).execute("edit", { path: "a.ts", edits: [{ oldText: "written", newText: "edited" }] }, undefined, undefined, { cwd: root });
  finishWrite();
  const [written, edited] = await Promise.all([writing, editing]);
  assert.match(written.details.patch, /-original/);
  assert.match(edited.details.patch, /-written/);
  assert.equal(await readFile(join(root, "a.ts"), "utf8"), "edited\n");
});

test("different files remain able to write in parallel", async (t) => {
  const root = await workspace(t);
  let running = 0;
  let maximum = 0;
  let release;
  const bothStarted = new Promise((resolve) => { release = resolve; });
  const timer = setTimeout(() => release(), 2000);
  t.after(() => clearTimeout(timer));
  const tool = createWriteDiffTool(root, { operations: {
    mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
    writeFile: async (filePath, content) => {
      running++;
      maximum = Math.max(maximum, running);
      if (running === 2) release();
      await bothStarted;
      await writeFile(filePath, content);
      running--;
    },
  } });
  await Promise.all([execute(tool, root, "a.ts", "one\n"), execute(tool, root, "b.ts", "two\n")]);
  assert.equal(maximum, 2);
});

test("snapshot and diff failures do not turn successful writes into failures", async (t) => {
  const root = await workspace(t);
  for (const options of [
    { readSnapshot: async () => { throw Object.assign(new Error("Cannot read baseline"), { code: "EACCES" }); } },
    { generatePatch: () => { throw new Error("Diff failed"); } },
    { generatePatch: () => "x".repeat(WRITE_DIFF_MAX_BYTES + 1) },
  ]) {
    const result = await execute(createWriteDiffTool(root, options), root, "a.ts", "written\n");
    assert.equal(await readFile(join(root, "a.ts"), "utf8"), "written\n");
    assert.equal(result.details, undefined);
    assert.equal(getWrittenFileStats(filesFromResult(root, "a.ts", result)[0]), null);
  }
});

test("large text, binary and invalid UTF-8 baselines keep normal write behavior without stats", async (t) => {
  const root = await workspace(t);
  const filePath = join(root, "a.ts");
  for (const original of ["x".repeat(WRITE_DIFF_MAX_BYTES + 1), Buffer.from([65, 0, 66]), Buffer.from([0xff, 0xfe, 65])]) {
    await writeFile(filePath, original);
    const result = await execute(createWriteDiffTool(root), root, "a.ts", "plain\n");
    assert.equal(result.details, undefined);
    assert.equal(await readFile(filePath, "utf8"), "plain\n");
  }
});

test("oversized new content skips snapshot IO and excessive line counts skip diff computation", async (t) => {
  const root = await workspace(t);
  let snapshots = 0;
  const result = await execute(createWriteDiffTool(root, { readSnapshot: async () => { snapshots++; return ""; } }), root, "large.ts", "x".repeat(WRITE_DIFF_MAX_BYTES + 1));
  assert.equal(snapshots, 0);
  assert.equal(result.details, undefined);
  const manyLines = "line\n".repeat(WRITE_DIFF_MAX_LINES);
  let generated = false;
  const other = await execute(createWriteDiffTool(root, { generatePatch: () => { generated = true; throw new Error("Must skip"); } }), root, "lines.ts", manyLines);
  assert.equal(generated, false);
  assert.equal(other.details, undefined);
  assert.equal(await readFile(join(root, "lines.ts"), "utf8"), manyLines);
});

test("CRLF, UTF-8 BOM, Unicode and missing trailing newlines are preserved on disk", async (t) => {
  const root = await workspace(t);
  const tool = createWriteDiffTool(root);
  for (const content of ["keep\r\n中文内容\r\n", "\uFEFF含 BOM\n", "没有末尾换行", "lone surrogate: \uD800"]) {
    await writeFile(join(root, "a.ts"), "before\n");
    const result = await execute(tool, root, "a.ts", content);
    assert.equal(await readFile(join(root, "a.ts"), "utf8"), Buffer.from(content).toString("utf8"));
    assert.ok(result.details?.patch);
    assert.ok(getWrittenFileStats(filesFromResult(root, "a.ts", result)[0]));
  }
});

test("write errors and cancellation still propagate and release the queue", async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, "directory"));
  await assert.rejects(execute(createWriteDiffTool(root), root, "directory", "cannot write a directory"));
  await writeFile(join(root, "a.ts"), "original\n");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(execute(createWriteDiffTool(root), root, "a.ts", "cancelled", controller.signal), /Operation aborted/);
  assert.equal(await readFile(join(root, "a.ts"), "utf8"), "original\n");
  await execute(createWriteDiffTool(root), root, "a.ts", "recovered\n");
  assert.equal(await readFile(join(root, "a.ts"), "utf8"), "recovered\n");
});

test("abort while reading a snapshot prevents the write", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "a.ts"), "original\n");
  let started;
  const reading = new Promise((resolve) => { started = resolve; });
  let release;
  const before = new Promise((resolve) => { release = resolve; });
  const controller = new AbortController();
  const writing = execute(createWriteDiffTool(root, { readSnapshot: () => { started(); return before; } }), root, "a.ts", "cancelled", controller.signal);
  await reading;
  controller.abort();
  release("original\n");
  await assert.rejects(writing, /Operation aborted/);
  assert.equal(await readFile(join(root, "a.ts"), "utf8"), "original\n");
});

test("session startup replaces only the built-in write, leaving custom or disabled tools alone", () => {
  for (const source of ["builtin", "sdk", "package", undefined]) {
    let handler;
    const registered = [];
    EUREKA_WRITE_DIFF_EXTENSION.factory({
      on: (name, listener) => { assert.equal(name, "session_start"); handler = listener; },
      getAllTools: () => source ? [{ name: "write", sourceInfo: { source } }] : [],
      registerTool: (definition) => registered.push(definition),
    });
    handler({ reason: "startup" }, { cwd: process.cwd() });
    assert.equal(registered.length, source === "builtin" ? 1 : 0);
    if (registered.length) assert.equal(registered[0].name, "write");
  }
});
