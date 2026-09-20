import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationStore } from "./notification-store.ts";

test("notifications retain every severity newest first without timed or capacity eviction", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createNotificationStore();
  for (let i = 0; i < 12; i++) store.notify({ id: `operation-${i}`, type: ["info", "success", "warning", "error"][i % 4], message: `Result ${i}` });
  t.mock.timers.tick(600_000);
  assert.equal(store.getSnapshot().length, 12);
  assert.equal(store.getSnapshot()[0].id, "operation-11");
  assert.deepEqual(new Set(store.getSnapshot().map((item) => item.type)), new Set(["info", "success", "warning", "error"]));
});

test("closing only removes the requested notification and prevents replay from resurrecting it", () => {
  const store = createNotificationStore();
  store.notify({ id: "sse-event-1", type: "error", message: "Failed" });
  const other = store.notify({ message: "Other result" });
  store.dismiss("sse-event-1");
  store.notify({ id: "sse-event-1", type: "error", message: "Failed" });
  assert.deepEqual(store.getSnapshot().map((item) => item.id), [other]);
  store.notify({ id: "sse-event-2", type: "error", message: "Failed" });
  assert.equal(store.getSnapshot().length, 2, "a new operation with the same error must still notify");
});

test("repeated renders/events do not duplicate active notices and empty feedback is ignored", () => {
  const store = createNotificationStore();
  store.notify({ id: "load:file-a", message: "Cannot read file" });
  const snapshot = store.getSnapshot();
  store.notify({ id: "load:file-a", message: "Cannot read file" });
  store.notify({ message: "  " });
  assert.equal(store.getSnapshot(), snapshot);
});

test("subscribers receive additions and explicit dismissals, preserving recovery actions", () => {
  const store = createNotificationStore();
  let renders = 0, actions = 0;
  const unsubscribe = store.subscribe(() => renders++);
  const id = store.notify({ message: "Uploaded", action: { label: "Add to chat", onClick: () => actions++ } });
  store.getSnapshot()[0].action.onClick();
  assert.equal(actions, 1);
  assert.equal(store.getSnapshot().length, 1, "actions must not implicitly dismiss notifications");
  store.dismiss(id);
  assert.equal(renders, 2);
  unsubscribe();
  store.notify({ message: "Next" });
  assert.equal(renders, 2);
});
