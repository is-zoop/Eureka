import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { resolve } from "node:path";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd(), "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") }, moduleCache: false, interopDefault: true });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { GET: detail } = await jiti.import("./[id]/route.ts");
const { GET: context } = await jiti.import("./[id]/context/route.ts");
const { GET: history } = await jiti.import("./[id]/history/route.ts");

function fixture(t) {
  const manager = SessionManager.inMemory("E:/Eureka");
  for (let index = 0; index < 15; index++) manager.appendMessage({ role: "user", content: `request ${index}`, timestamp: index });
  const kept = manager.getLeafId();
  manager.appendCompaction("COMPRESSED_SUMMARY", kept, 10000);
  manager.appendMessage({ role: "user", content: "latest request", timestamp: 16 });
  const previous = globalThis.__piSessions;
  const id = manager.getSessionId();
  let runtimeCalls = 0;
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true, isRunning: () => false, inner: { sessionManager: manager },
    sessionFile: "", sessionId: id, cwd: "E:/Eureka", send: () => { runtimeCalls++; throw new Error("History must never start or command an agent."); },
  }]]);
  t.after(() => { globalThis.__piSessions = previous; });
  return { manager, id, params: { params: Promise.resolve({ id }) }, calls: () => runtimeCalls };
}

test("detail opt-in returns one consistent snapshot and leaves the default context contract intact", async t => {
  const f = fixture(t);
  const original = f.manager.buildSessionContext();
  const response = await detail(new Request(`http://localhost/api/sessions/${f.id}?includeHistory=1&deferThinking=1&deferMedia=1`), f.params);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.history.leafId, data.leafId);
  assert.equal(data.history.items.filter(item => item.message.role === "user").length, 10);
  assert.equal(data.context.messages.length, 3);
  assert.equal(data.history.hasMore, true);
  const legacy = await (await detail(new Request(`http://localhost/api/sessions/${f.id}`), f.params)).json();
  assert.equal("history" in legacy, false);
  assert.deepEqual(f.manager.buildSessionContext(), original);
  assert.equal(f.calls(), 0);
});

test("context and earlier history honor the selected branch and reject foreign cursors", async t => {
  const f = fixture(t);
  const entries = f.manager.getEntries();
  const selected = entries[2].id;
  const response = await context(new Request(`http://localhost/api/sessions/${f.id}/context?leafId=${selected}&includeHistory=1`), f.params);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.history.leafId, selected);
  assert.equal(data.history.items.length, 3);
  assert.equal(data.history.latestCompactionId, null);
  const invalid = await history(new Request(`http://localhost/api/sessions/${f.id}/history?leafId=${selected}&before=${entries.at(-1).id}`), f.params);
  assert.equal(invalid.status, 409);
  const page = await (await history(new Request(`http://localhost/api/sessions/${f.id}/history`), f.params)).json();
  const earlier = await (await history(new Request(`http://localhost/api/sessions/${f.id}/history?leafId=${page.history.leafId}&before=${page.history.before}`), f.params)).json();
  assert.equal(earlier.history.hasMore, false);
  assert.ok(earlier.history.items.every(item => item.readOnly));
  assert.equal(f.calls(), 0);
});
