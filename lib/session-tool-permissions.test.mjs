import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, tsconfigPaths: true, alias: { "@": process.cwd(), "server-only": resolve("node_modules/next/dist/compiled/server-only/empty.js") } });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { sendSessionToolCommand } = await jiti.import("./rpc-manager.ts");
const { readSessionToolNames, saveSessionToolNames } = await jiti.import("./session-tool-permissions.ts");
const { EMPTY_PLAN_STATE } = await jiti.import("./plan-mode.ts");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "eureka-permissions-"));
  const manager = SessionManager.create(dir, dir);
  manager.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "test" }], timestamp: Date.now() });
  const id = manager.getSessionId();
  const file = manager.getSessionFile();
  const registry = globalThis.__piSessions;
  const locks = globalThis.__piStartLocks;
  globalThis.__piSessions = new Map();
  globalThis.__piStartLocks = new Map();
  t.after(() => {
    globalThis.__piSessions = registry;
    globalThis.__piStartLocks = locks;
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  });
  return { manager, id, file };
}

test("reading an idle session does not start an agent or modify the session file", async (t) => {
  const { id, file } = fixture(t);
  const before = readFileSync(file, "utf8");
  const tools = await sendSessionToolCommand(id, file, { type: "get_tools" });
  assert.deepEqual(tools.filter((tool) => tool.active).map((tool) => tool.name).sort(), ["bash", "edit", "read", "write"]);
  assert.equal(globalThis.__piSessions.size, 0);
  assert.equal(globalThis.__piStartLocks.size, 0);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("idle selections are saved per session and all-off survives a reopen", async (t) => {
  const { id, file } = fixture(t);
  await sendSessionToolCommand(id, file, { type: "set_tools", toolNames: [] });
  assert.deepEqual(readSessionToolNames(SessionManager.open(file).getEntries()), []);
  assert.equal((await sendSessionToolCommand(id, file, { type: "get_tools" })).filter((tool) => tool.active).length, 0);
  const before = readFileSync(file, "utf8");
  await sendSessionToolCommand(id, file, { type: "set_tools", toolNames: [] });
  assert.equal(readFileSync(file, "utf8"), before, "same preset does not append duplicate entries");
  await sendSessionToolCommand(id, file, { type: "set_tools", toolNames: ["read", "grep", "find", "ls"] });
  assert.deepEqual(readSessionToolNames(SessionManager.open(file).getEntries()), ["read", "grep", "find", "ls"]);
  assert.equal(globalThis.__piSessions.size, 0);
});

test("plans still lock permissions and invalid input is rejected", async (t) => {
  const { id, file, manager } = fixture(t);
  manager.appendCustomEntry("eureka_plan", { ...EMPTY_PLAN_STATE, phase: "planning", planModeActive: true });
  await assert.rejects(sendSessionToolCommand(id, file, { type: "set_tools", toolNames: [] }), /plan is active/);
  await assert.rejects(sendSessionToolCommand(id, file, { type: "set_tools", toolNames: "full" }), /Invalid tool permissions/);
  await assert.rejects(sendSessionToolCommand(id, file, { type: "set_tools", toolNames: ["arbitrary"] }), /Invalid tool permissions/);
});

test("a concurrent prompt startup receives the selection through its live manager", async (t) => {
  const { id, file } = fixture(t);
  const before = readFileSync(file, "utf8");
  let finish;
  const calls = [];
  globalThis.__piStartLocks.set(id, new Promise((resolve) => { finish = resolve; }));
  const changing = sendSessionToolCommand(id, file, { type: "set_tools", toolNames: [] });
  const session = { isAlive: () => true, send: async (command) => { calls.push(command); return null; } };
  globalThis.__piSessions.set(id, session);
  finish({ session, realSessionId: id });
  await changing;
  assert.deepEqual(calls, [{ type: "set_tools", toolNames: [] }]);
  assert.equal(readFileSync(file, "utf8"), before, "no writes through a second SessionManager");
});

test("session permission metadata ignores malformed entries", () => {
  const entries = [{ type: "custom", customType: "eureka_tool_permissions", data: { toolNames: ["read"] } }, { type: "custom", customType: "eureka_tool_permissions", data: { toolNames: false } }];
  assert.deepEqual(readSessionToolNames(entries), ["read"]);
  let calls = 0;
  saveSessionToolNames({ getEntries: () => entries, appendCustomEntry: () => calls++ }, ["read"]);
  assert.equal(calls, 0);
});
