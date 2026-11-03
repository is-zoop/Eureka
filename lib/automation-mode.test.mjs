import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { parseAutomationTaskRef, readAutomationMode, sameAutomationTask, AUTOMATION_MODE_ENTRY, AUTOMATION_INTAKE_TOOLS } = await jiti.import("./automation-mode.ts");
const task = { id: "01a18fb3-cc87-7aa3-b742-074834197d2b", ownerKey: "a".repeat(64), runtimeId: "login-1" };
test("composer references discard user data and require a bounded identity", () => {
  assert.deepEqual(parseAutomationTaskRef({ ...task, goal: "private requirement", password: "secret" }), task);
  for (const patch of [{ id: "../task" }, { id: "-".repeat(36) }, { ownerKey: "other" }, { runtimeId: "" }, { baseTool: { id: "../app", revision: 1 } }, { baseTool: { id: task.id, revision: 0 } }, { baseTool: { id: task.id, revision: 1 } }]) assert.throws(() => parseAutomationTaskRef({ ...task, ...patch }));
});
test("mode recovery follows the current branch's latest exit instead of an earlier active entry", () => {
  const record = { task, sessionId: "session", status: "active", updatedAt: "2026-10-31T03:00:00Z" };
  const entry = data => ({ type: "custom", customType: AUTOMATION_MODE_ENTRY, data });
  assert.equal(readAutomationMode([entry(record)]).status, "active");
  assert.equal(readAutomationMode([entry(record), entry({ ...record, status: "exited" })]).status, "exited");
  assert.equal(readAutomationMode([entry(record), entry({ ...record, task: null })]), null);
  assert.equal(readAutomationMode([{ ...entry(record), customType: "other" }]), null);
});

test("application modification retains the exact base identity/version, without treating UI metadata as task authority", () => {
  const baseApp = { id: "f338650c-430a-4ade-9bc4-360849e83b8a", revision: 3, version: "1.0.1" };
  const selected = { ...task, baseApp };
  assert.deepEqual(parseAutomationTaskRef({ ...selected, displayName: "UI-only name", cwd: "private directory" }), selected);
  assert.deepEqual(parseAutomationTaskRef({ ...task, baseApp: { ...baseApp, displayName: "ignored" } }), selected);
  for (const patch of [{ id: "../app" }, { revision: 0 }, { version: "latest" }]) assert.throws(() => parseAutomationTaskRef({ ...task, baseApp: { ...baseApp, ...patch } }));
});
test("cancellation matches task, owner and login generation; authoring uses only scoped host capabilities", () => {
  assert.equal(sameAutomationTask(task, { ...task }), true);
  assert.equal(sameAutomationTask(task, { ...task, runtimeId: "login-2" }), false);
  assert.equal(sameAutomationTask(task, { ...task, ownerKey: "b".repeat(64) }), false);
  assert.deepEqual(AUTOMATION_INTAKE_TOOLS, ["eureka_automation_task","eureka_app_browser","eureka_app_file","eureka_app_write","eureka_app_test","eureka_app_validate","request_user_input"]);
});
