import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { RunObservability } = await jiti.import("./run-observability.ts");
const { readPackageChangelog } = await jiti.import("./package-changelog.ts");
test("tool updates never expose raw text, cookies, structured results or nested calls", () => {
  const run = new RunObservability();
  run.observe({ type: "tool_execution_update", toolCallId: "one", toolName: "codemode", partialResult: { content: [{ text: "Cookie: private" }], structuredContent: { token: "private" }, progress: 3, total: 8 } }, 5);
  assert.deepEqual(run.tools.one, { updates: 1, text: "3 / 8", at: 5 });
  assert.ok(!JSON.stringify(run).includes("private"));
  run.observe({ type: "tool_execution_end", toolCallId: "one" }); assert.deepEqual(run.tools, {});
});
test("bounded progress and request buffers, first delta and fresh run isolation", () => {
  const run = new RunObservability();
  for (let i = 0; i < 1000; i++) { run.observe({ type: "tool_execution_update", toolCallId: String(i) }); run.observe({ type: "request_start" }, i); }
  assert.equal(Object.keys(run.tools).length, 64); assert.equal(run.requests.length, 64);
  run.observe({ type: "agent_start" });
  run.observe({ type: "request_start" }, 100);
  run.observe({ type: "message_update" }, 120); run.observe({ type: "message_update" }, 130);
  run.observe({ type: "auto_retry_start" });
  run.observe({ type: "message_end", message: { role: "assistant", stopReason: "stop" } }, 200);
  assert.deepEqual(run.requests, [{ startedAt: 100, firstEventMs: 20, durationMs: 100, status: "stop", retries: 1 }]);
  run.observe({ type: "agent_start" }); assert.deepEqual(run.requests, []);
});
test("package changelog default/custom/disabled paths, traversal and oversized files", () => {
  const root = mkdtempSync(join(tmpdir(), "eureka-notes-"));
  try {
    const pkg = join(root, "package"); mkdirSync(pkg);
    const manifest = value => writeFileSync(join(pkg, "package.json"), JSON.stringify({ pi: value }));
    manifest({}); writeFileSync(join(pkg, "CHANGELOG.md"), "## 1.2.0\nUpdated");
    assert.match(readPackageChangelog(pkg), /Updated/);
    manifest({ changelogPath: "" }); assert.equal(readPackageChangelog(pkg), undefined);
    writeFileSync(join(root, "private.md"), "private"); manifest({ changelogPath: "../private.md" }); assert.equal(readPackageChangelog(pkg), undefined);
    manifest({ changelogPath: "custom.md" }); writeFileSync(join(pkg, "custom.md"), "x".repeat(300000)); assert.equal(readPackageChangelog(pkg), undefined);
    writeFileSync(join(pkg, "custom.md"), "Custom"); assert.equal(readPackageChangelog(pkg), "Custom");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
