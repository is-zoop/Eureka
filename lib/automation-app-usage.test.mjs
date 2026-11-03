import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getFrequentAutomationApps, readAutomationAppUsage, recordAutomationAppOpen } = await createJiti(import.meta.url).import("./automation-app-usage.ts");
const app = (id, extra = {}) => ({ id, disabled: false, ...extra });
function storage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("frequent apps rank by visits, then recency, and cap at three without mutating the directory", () => {
  const apps = [app("a"), app("b"), app("c"), app("d")];
  const usage = { a: { opens: 1, lastOpenedAt: 9 }, b: { opens: 3, lastOpenedAt: 2 }, c: { opens: 3, lastOpenedAt: 5 }, d: { opens: 2, lastOpenedAt: 7 } };
  assert.deepEqual(getFrequentAutomationApps(apps, usage).map(a => a.id), ["c", "b", "d"]);
  assert.deepEqual(apps.map(a => a.id), ["a", "b", "c", "d"]);
});

test("only currently installed usable apps appear; one app stays one and an empty directory stays empty", () => {
  const usage = { removed: { opens: 99, lastOpenedAt: 9 } };
  assert.deepEqual(getFrequentAutomationApps([app("a"), app("disabled", { disabled: true }), app("broken", { error: "invalid" })], usage).map(a => a.id), ["a"]);
  assert.deepEqual(getFrequentAutomationApps([], usage), []);
});

test("fresh installs without usage keep their directory order", () => {
  assert.deepEqual(getFrequentAutomationApps([app("b"), app("a")], {}).map(a => a.id), ["b", "a"]);
});

test("visits persist for the current account without crossing account boundaries", () => {
  const s = storage();
  recordAutomationAppOpen("alice", "a", 10, s);
  recordAutomationAppOpen("alice", "a", 20, s);
  recordAutomationAppOpen("bob", "b", 30, s);
  assert.deepEqual(readAutomationAppUsage("alice", s), { a: { opens: 2, lastOpenedAt: 20 } });
  assert.deepEqual(readAutomationAppUsage("bob", s), { b: { opens: 1, lastOpenedAt: 30 } });
  assert.deepEqual(readAutomationAppUsage("", s), {});
});

test("corrupt or unavailable storage never blocks navigation and malformed counts are ignored", () => {
  const s = storage();
  s.setItem("eureka:automation-app-usage:alice", "{invalid");
  assert.deepEqual(readAutomationAppUsage("alice", s), {});
  s.setItem("eureka:automation-app-usage:alice", JSON.stringify({ a: { opens: -1, lastOpenedAt: 1 }, b: null, c: { opens: 2, lastOpenedAt: 3 } }));
  assert.deepEqual(readAutomationAppUsage("alice", s), { c: { opens: 2, lastOpenedAt: 3 } });
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.doesNotThrow(() => recordAutomationAppOpen("alice", "a", 10, blocked));
  assert.deepEqual(readAutomationAppUsage("alice", null), {});
});
