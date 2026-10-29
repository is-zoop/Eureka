import assert from "node:assert/strict";
import test from "node:test";
import { NavigationHistory } from "./navigation-history.ts";

const create = () => new NavigationHistory((entry) => entry.id);

test("back and forward traverse visits without adding duplicate history", () => {
  const history = create();
  history.record({ id: "chat-a" });
  assert.deepEqual(history.availability, { canGoBack: false, canGoForward: false });
  history.record({ id: "extensions" });
  history.record({ id: "chat-b" });
  assert.equal(history.move(-1).id, "extensions");
  history.record({ id: "extensions", label: "updated" });
  assert.equal(history.move(-1).id, "chat-a");
  assert.equal(history.move(-1), null);
  assert.equal(history.move(1).label, "updated");
  assert.equal(history.move(1).id, "chat-b");
  assert.equal(history.move(1), null);
});

test("a new visit after going back discards the old forward branch", () => {
  const history = create();
  history.record({ id: "a" });
  history.record({ id: "b" });
  history.move(-1);
  history.record({ id: "c" });
  assert.equal(history.move(1), null);
  assert.equal(history.move(-1).id, "a");
  assert.equal(history.move(1).id, "c");
});

test("assigning a real session id replaces its draft visit", () => {
  const history = create();
  history.record({ id: "a" });
  history.record({ id: "draft" });
  history.replace({ id: "created-session" });
  assert.equal(history.move(-1).id, "a");
  assert.equal(history.move(1).id, "created-session");
});

test("deleted sessions are removed from both navigation directions", () => {
  const history = create();
  for (const id of ["a", "deleted", "b", "deleted-again", "c"]) history.record({ id });
  history.move(-1);
  history.move(-1);
  history.remove((entry) => entry.id.startsWith("deleted"));
  assert.equal(history.move(-1).id, "a");
  assert.equal(history.move(1).id, "b");
  assert.equal(history.move(1).id, "c");
});
