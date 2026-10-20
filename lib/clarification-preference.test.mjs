import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const preference = await jiti.import("./clarification-preference.ts");

test("clarification defaults off and syncs explicit changes without changing captured failed submissions", () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget(), values = new Map();
  target.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  let updates = 0;
  const unsubscribe = preference.subscribeClarificationPreference(() => updates++);
  try {
    assert.equal(preference.getClarificationPreference(), false);
    preference.setClarificationPreference(true);
    assert.equal(updates, 1);
    assert.equal(preference.getClarificationPreference(), true);
    preference.rememberClarificationSubmission("draft", "查询", true);
    preference.setClarificationPreference(false);
    assert.equal(preference.submissionClarificationPreference("draft", "查询"), true);
    assert.equal(preference.submissionClarificationPreference("draft", "修改后的查询"), false);
    const event = new Event("storage"); Object.defineProperty(event, "key", { value: "eureka-clarification-enabled" }); target.dispatchEvent(event);
    assert.equal(updates, 3);
    preference.forgetClarificationSubmission("draft");
    assert.equal(preference.submissionClarificationPreference("draft", "查询"), false);
    unsubscribe(); preference.setClarificationPreference(true);
    assert.equal(updates, 3);
    target.localStorage.getItem = () => { throw new Error("storage blocked"); };
    assert.equal(preference.getClarificationPreference(), false);
  } finally { unsubscribe(); if (old) Object.defineProperty(globalThis, "window", old); else delete globalThis.window; }
});
