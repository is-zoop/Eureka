import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Import the emitted runtime in isolation: a value import of rpc-manager or the
// SDK would make this fail (bare package imports cannot resolve from data URLs).
const source = await readFile(new URL("./rpc-session-registry.ts", import.meta.url), "utf8");
const emitted = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const registry = await import(`data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`);

function isolate(t) {
  const sessions = globalThis.__piSessions;
  const listeners = globalThis.__piRunningListeners;
  globalThis.__piSessions = undefined;
  globalThis.__piRunningListeners = undefined;
  t.after(() => {
    globalThis.__piSessions = sessions;
    globalThis.__piRunningListeners = listeners;
  });
}

test("cold status reads do not initialize an agent registry or process cleanup hooks", (t) => {
  isolate(t);
  const hooks = ["exit", "SIGINT", "SIGTERM"].map(event => process.listenerCount(event));
  assert.deepEqual(registry.getRunningRpcSessionIds(), []);
  assert.deepEqual(registry.getRpcSessionInfos(), []);
  assert.equal(globalThis.__piSessions, undefined);
  assert.deepEqual(["exit", "SIGINT", "SIGTERM"].map(event => process.listenerCount(event)), hooks);
});

test("status follows the shared registry across replacement and in-place forks", (t) => {
  isolate(t);
  const session = { sessionId: "forked", isRunning: () => true };
  globalThis.__piSessions = new Map([
    ["original", session],
    ["alias", session],
    ["idle", { sessionId: "idle", isRunning: () => false }],
  ]);
  assert.deepEqual(registry.getRunningRpcSessionIds(), ["forked"]);
  globalThis.__piSessions = new Map([["replacement", { sessionId: "", isRunning: () => true }]]);
  assert.deepEqual(registry.getRunningRpcSessionIds(), ["replacement"]);
});

test("broadcasts starts and completions once and stops notifying unsubscribed listeners", (t) => {
  isolate(t);
  const received = [];
  const unsubscribe = registry.subscribeRunningSessions(ids => received.push(ids));
  globalThis.__piSessions = new Map([["running", { sessionId: "running", isRunning: () => true }]]);
  registry.notifyRunningChange();
  registry.notifyRunningChange();
  globalThis.__piSessions.clear();
  registry.notifyRunningChange();
  assert.deepEqual(received, [["running"], []]);
  unsubscribe();
  registry.notifyRunningChange();
  assert.deepEqual(received, [["running"], []]);

  const later = [];
  const stop = registry.subscribeRunningSessions(ids => later.push(ids));
  registry.notifyRunningChange();
  assert.deepEqual(later, [[]]);
  stop();
});
