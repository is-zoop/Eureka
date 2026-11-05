// User-run regression sources only. These fixtures never invoke an app, browser or model.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AutomationAppStore } = await jiti.import("./automation-app-store.ts");
const { parseAutomationAppArchive } = await jiti.import("./automation-app-package.ts");
const { fileAutomationExample } = await jiti.import("./automation-app-example.ts");
const { listAppRuns, readAppConfiguration } = await jiti.import("./automation-app-runtime.ts");
const { bindChatAutomations, chatAutomations, prepareChatInvocation, listChatInvocations, startChatInvocation, prepareChatRestart, chatInvocationSnapshot, configureChatInvocation, chatInvocationResult } = await jiti.import("./automation-chat.ts");

async function fixture(work) {
  const root = await mkdtemp(join(tmpdir(), "eureka-chat-automation-")), ownerKey = "a".repeat(64);
  try {
    const store = new AutomationAppStore(root, ownerKey, () => {}), pkg = parseAutomationAppArchive(fileAutomationExample()), install = await store.install(pkg, 0);
    const auth = { store, ownerKey, runtimeId: "login-one", issuer: "https://example.test", subject: "user-one", assertIdentity: () => {} };
    const app = { source: auth.issuer, subject: auth.subject, capabilityId: `automation:${install.id}`, digest: pkg.digest, name: install.displayName,
      automation: { id: install.id, revision: install.revision, version: install.activeVersion } };
    await work({ root, auth, app, install, sessionId: randomUUID(), taskId: randomUUID() });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("selected automation tools are scoped to a manager and disappear when unbound", () => {
  const first = {}, other = {}, app = { automation: { id: randomUUID() } };
  const unbind = bindChatAutomations(first, [app]);
  assert.deepEqual(chatAutomations(first), [app]); assert.deepEqual(chatAutomations(other), []);
  unbind(); assert.deepEqual(chatAutomations(first), []);
});

test("preparing a conversation invocation does not execute code and is idempotent within its task", () => fixture(async ({ auth, app, install, sessionId, taskId }) => {
  const one = await prepareChatInvocation(auth, sessionId, taskId, app, { delayMs: 0 });
  const repeated = await prepareChatInvocation(auth, sessionId, taskId, app, { delayMs: 10 });
  assert.equal(repeated.id, one.id); assert.equal(repeated.runId, one.runId); assert.deepEqual(repeated.values, { delayMs: 0 });
  assert.deepEqual(await listAppRuns(auth, install.id), []);
  assert.equal((await listChatInvocations(auth, sessionId)).length, 1);
  assert.deepEqual(await listChatInvocations(auth, randomUUID()), []);
  const another = { ...auth, ownerKey: "b".repeat(64), store: new AutomationAppStore(auth.store.base, "b".repeat(64), () => {}) };
  assert.deepEqual(await listChatInvocations(another, sessionId), []);
  await assert.rejects(startChatInvocation({ ...auth, runtimeId: "login-two" }, one), /登录或应用版本已变化/);
  assert.deepEqual(await listAppRuns(auth, install.id), []);
}));

test("the model cannot inject file paths, file grants or undeclared inputs", () => fixture(async ({ auth, app, sessionId, taskId }) => {
  for (const values of [{ source: "C:/private" }, { source: { grantId: "invented" } }, { undeclared: "x" }]) {
    await assert.rejects(prepareChatInvocation(auth, sessionId, taskId, app, values), /文件和目录|未声明/);
  }
  assert.deepEqual(await listChatInvocations(auth, sessionId), []);
}));

test("explicit restart reserves one new run, retains the failure, and survives a lost preparation response", () => fixture(async ({ auth, app, install, sessionId, taskId }) => {
  const invocation = await prepareChatInvocation(auth, sessionId, taskId, app, { delayMs: 0 });
  const path = join(auth.store.dataDirectory(install.id), "logs", "runs", invocation.runId, "run.json");
  // A terminal fixture only: never start a worker, model or browser.
  await auth.store.privateJson(path, { schemaVersion: 1, id: invocation.runId, appId: install.id, runtimeId: auth.runtimeId,
    status: "failed", artifacts: [], events: [], startedAt: new Date().toISOString(), error: "fixture failure" });
  const proposed = randomUUID();
  const [first, duplicate] = await Promise.all([
    prepareChatRestart(auth, sessionId, invocation.id, invocation.runId, proposed),
    prepareChatRestart(auth, sessionId, invocation.id, invocation.runId, randomUUID()),
  ]);
  assert.equal(first.runId, duplicate.runId);
  assert.notEqual(first.runId, invocation.runId);
  assert.deepEqual(first.previousRunIds, [invocation.runId]);
  assert.equal((await prepareChatRestart(auth, sessionId, invocation.id, invocation.runId, randomUUID())).runId, first.runId);
  // A stale object from an earlier tool call resolves the new durable pointer.
  const snapshot = await chatInvocationSnapshot(auth, invocation);
  assert.equal(snapshot.invocation.runId, first.runId); assert.equal(snapshot.run, null);
  const runs = await listAppRuns(auth, install.id);
  assert.equal(runs.length, 1); assert.equal(runs[0].status, "failed");
  await assert.rejects(prepareChatRestart({ ...auth, runtimeId: "another-login" }, sessionId, invocation.id, invocation.runId, randomUUID()), /登录或应用版本/);
}));

test("a prepared but unstarted invocation cannot be retried as a failed run", () => fixture(async ({ auth, app, sessionId, taskId }) => {
  const invocation = await prepareChatInvocation(auth, sessionId, taskId, app);
  await assert.rejects(prepareChatRestart(auth, sessionId, invocation.id, invocation.runId, randomUUID()), /尚未结束/);
  assert.equal((await listChatInvocations(auth, sessionId))[0].runId, invocation.runId);
}));

test("chat configuration separates temporary overrides from saved defaults and rejects invented grants", () => fixture(async ({ auth, app, sessionId, taskId, install }) => {
  const invocation = await prepareChatInvocation(auth, sessionId, taskId, app);
  await configureChatInvocation(auth, invocation, { delayMs: 7 });
  assert.deepEqual((await readAppConfiguration(auth, install.id)).values, {});
  assert.equal((await chatInvocationResult(auth, invocation)).configuration.delayMs, 7);
  await configureChatInvocation(auth, invocation, { delayMs: 12 }, true, 0);
  assert.equal((await readAppConfiguration(auth, install.id)).values.delayMs, 12);
  await configureChatInvocation(auth, invocation, { delayMs: 3 });
  const value = await chatInvocationResult(auth, invocation);
  assert.equal(value.configuration.delayMs, 3); assert.equal(value.savedConfiguration.delayMs, 12);
  await assert.rejects(configureChatInvocation(auth, invocation, { source: { grantId: randomUUID() } }), /choose_file/);
  await assert.rejects(configureChatInvocation(auth, invocation, { delayMs: 5 }, true, 0), /配置已变化/);
  assert.deepEqual(await listAppRuns(auth, install.id), []);
}));
