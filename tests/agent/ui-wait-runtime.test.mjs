import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { subscribeUiWait, setHostUiWait, clearUiWait, installUiWaitRuntime } = await jiti.import("../../server/agent/ui-wait-runtime.ts");
const { computeSessionTotalActiveMs } = await jiti.import("../../features/sessions/shared/session-timing.ts");

test("overlapping host and SDK prompts form one wait span and release all listeners on disposal", () => {
  const manager = {}, changes = [], handlers = new Map();
  installUiWaitRuntime({ on: (name, fn) => handlers.set(name, fn) });
  const unsubscribe = subscribeUiWait(manager, waiting => changes.push(waiting));
  setHostUiWait(manager, "a", true); setHostUiWait(manager, "b", true);
  handlers.get("ui_prompt_start")({}, { sessionManager: manager });
  setHostUiWait(manager, "a", false); setHostUiWait(manager, "b", false);
  assert.deepEqual(changes, [false, true]);
  handlers.get("ui_prompt_end")({}, { sessionManager: manager });
  assert.deepEqual(changes, [false, true, false]);
  setHostUiWait(manager, "custom", true);
  clearUiWait(manager); unsubscribe();
  assert.deepEqual(changes, [false, true, false, true, false]);
  setHostUiWait(manager, "new", true);
  assert.equal(changes.length, 5);
});

test("active session timing excludes persisted user waits but retains execution on either side", () => {
  const entry = (type, ms, data = {}) => ({ type, timestamp: new Date(ms).toISOString(), ...data });
  assert.equal(computeSessionTotalActiveMs([
    entry("message", 1000, { message: { role: "user" } }),
    entry("custom", 3000, { customType: "eureka_ui_wait", data: { waiting: true } }),
    entry("message", 4000, { message: { role: "assistant" } }),
    entry("custom", 13000, { customType: "eureka_ui_wait", data: { waiting: false } }),
    entry("message", 16000, { message: { role: "assistant" } }),
  ]), 5000);
});

test("an idle extension dialog does not turn earlier human idle into active execution", () => {
  const entry = (type, ms, data = {}) => ({ type, timestamp: new Date(ms).toISOString(), ...data });
  assert.equal(computeSessionTotalActiveMs([
    entry("message", 1000, { message: { role: "user" } }), entry("message", 2000, { message: { role: "assistant" } }),
    entry("custom", 50000, { customType: "eureka_ui_wait", data: { waiting: true, active: false } }),
    entry("custom", 60000, { customType: "eureka_ui_wait", data: { waiting: false, active: false } }),
  ]), 1000);
});
