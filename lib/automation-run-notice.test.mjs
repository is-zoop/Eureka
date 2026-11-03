// User-run regression sources only. No worker, browser or model execution.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { automationRunFailureNotice } = await jiti.import("./automation-run-notice.ts");
const { createNotificationStore } = await jiti.import("./notification-store.ts");
const running = { id: "run-one", status: "running" };
const failed = { id: "run-one", status: "failed", error: "query failed" };

test("opening, switching back to, or refreshing a historical failure is silent", () => {
  assert.equal(automationRunFailureNotice("user:app", null, failed), null);
  assert.equal(automationRunFailureNotice("user:app", failed, failed), null);
  assert.equal(automationRunFailureNotice("user:app", running, { ...failed, id: "old-run" }), null);
});

test("live failure notifies once across views, dismissal and repeated observations", () => {
  const store = createNotificationStore();
  const notice = automationRunFailureNotice("user:app", running, failed);
  assert.equal(notice.message, "query failed");
  store.notify(notice); store.dismiss(notice.id); store.notify(notice);
  assert.equal(store.getSnapshot().length, 0);
  const next = automationRunFailureNotice("user:app", { ...running, id: "run-two" }, { ...failed, id: "run-two" });
  store.notify(next);
  assert.equal(store.getSnapshot().length, 1);
});

test("intentional stopping is not an error; unexpected live interruption still is", () => {
  assert.equal(automationRunFailureNotice("user:app", running, { ...failed, status: "cancelled" }), null);
  assert.equal(automationRunFailureNotice("user:app", running, { ...failed, status: "interrupted" }).type, "error");
});
