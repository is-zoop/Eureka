import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { AutomationAppStore } = await jiti.import("./automation-app-store.ts");
const { fileAutomationExample } = await jiti.import("./automation-app-example.ts");
const { parseAutomationAppArchive, inspectAutomationFiles } = await jiti.import("./automation-app-package.ts");
const { appParameters } = await jiti.import("./automation-app-run.ts");
const { appHasLease, assertAppIdle } = await jiti.import("./automation-app-lease.ts");
const { startAppRun, stopAppRun, getAppRun, grantAppFile, appRunValue, appRunArtifact, listAppRuns, advanceAppRun, readAppConfiguration } = await jiti.import("./automation-app-runtime.ts");

async function until(read, accept) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await delay(40); }
  throw new Error("timed out waiting for worker");
}
async function fixture(work, modify) {
  const root = await mkdtemp(join(tmpdir(), "eureka-a03-")), source = join(root, "selected"), base = join(root, "agent");
  await mkdir(source); await writeFile(join(source, "empty.txt"), ""); await writeFile(join(source, "report.txt"), "source-data");
  const owner = "a".repeat(64), store = new AutomationAppStore(base, owner, () => {});
  let pkg = parseAutomationAppArchive(fileAutomationExample());
  if (modify) { modify(pkg.files); pkg = inspectAutomationFiles(pkg.files); }
  const install = await store.install(pkg, 0), auth = { ownerKey: owner, runtimeId: "test-login", store, assertIdentity: () => {} };
  const ref = await grantAppFile(auth, install.id, install.revision, "source", source, "read");
  try { await work({ root, source, store, install, auth, values: { source: ref, delayMs: 0 } }); }
  finally {
    // Only fixture-created paths are removed; no user folders are used.
    for (const record of await listAppRuns(auth, install.id)) if (["running", "waiting-user", "cancelling"].includes(record.status)) await stopAppRun(auth, install.id, record.id);
    await until(() => appHasLease(store.dataDirectory(install.id)), value => value === false);
    await rm(root, { recursive: true, force: true });
  }
}
test("real worker reports actual nodes and artifacts; duplicate start does not execute twice", async () => fixture(async ({ auth, install, store, source, values }) => {
  const id = randomUUID(); await startAppRun(auth, install.id, install.revision, id, values, 0);
  const record = await until(() => getAppRun(auth, install.id, id), value => value.status === "completed" || value.status === "failed");
  assert.equal(record.status, "completed", record.error);
  assert.equal(record.events.filter(e => e.kind === "node" && e.nodeId === "inspect" && e.status === "completed").length, 2);
  assert(record.events.every((event, i) => event.seq === i + 1));
  const result = await appRunValue(auth, install.id, id, record.resultRef);
  assert.equal(result.find(row => row.name === "empty.txt").size, 0);
  const artifact = await appRunArtifact(auth, install.id, id, record.artifacts[0].id);
  assert(artifact.bytes.toString("utf8").startsWith("\uFEFF"));
  assert.equal(await readFile(join(source, "report.txt"), "utf8"), "source-data");
  const retry = await startAppRun(auth, install.id, install.revision, id, values, 0);
  assert.equal(retry.id, id); assert.equal(retry.artifacts.length, 1);
  const exported = parseAutomationAppArchive((await store.export(install.id)).bytes);
  assert.equal(exported.files.has("config.json"), false); assert(![...exported.files.keys()].some(name => name.includes("logs/")));
}));
test("conversation steps wait for tool authorization, preserve script data and do not save temporary config", async () => fixture(async ({ auth, install, values }) => {
  const id = randomUUID(), options = { conversationSteps: true, persistConfiguration: false };
  await startAppRun(auth, install.id, install.revision, id, values, 0, "run", options);
  let record = await until(() => getAppRun(auth, install.id, id), value => value.stepControl?.pending.length);
  assert.equal(record.events.filter(event => event.kind === "node").length, 0);
  const first = record.stepControl.pending[0];
  assert.equal(first.nodeId, "read");
  assert.equal((await appRunValue(auth, install.id, id, first.inputRef)).source, values.source.label);
  await advanceAppRun(auth, install.id, id, first.token);
  await advanceAppRun(auth, install.id, id, first.token);
  record = await until(() => getAppRun(auth, install.id, id), value => value.stepControl?.pending.length && !value.stepControl.current);
  assert.equal(record.events.filter(event => event.kind === "node" && event.nodeId === "read" && event.status === "completed").length, 1);
  assert.equal(record.events.some(event => event.kind === "node" && event.nodeId === "inspect"), false);
  for (let count = 0; count < 10 && !["completed", "failed"].includes(record.status); count++) {
    if (record.stepControl?.pending.length) await advanceAppRun(auth, install.id, id, record.stepControl.pending[0].token);
    record = await until(() => getAppRun(auth, install.id, id), value => ["completed", "failed"].includes(value.status) || value.stepControl?.pending.length && !value.stepControl.current);
  }
  assert.equal(record.status, "completed", record.error);
  assert.equal((await appRunValue(auth, install.id, id, record.resultRef)).length, 2);
  assert.equal(record.artifacts.length, 1);
  assert.equal((await readAppConfiguration(auth, install.id)).revision, 0);
}));
test("separate conversations can run the same app with independent workspaces and leases", async () => fixture(async ({ auth, install, store, values }) => {
  const ids=[randomUUID(),randomUUID()],options={conversationSteps:true,persistConfiguration:false,isolatedWorkspace:true};
  for(let n=0;n<ids.length;n++) {
    await startAppRun(auth,install.id,install.revision,ids[n],{...values,delayMs:n+1},0,"run",options);
    await until(()=>getAppRun(auth,install.id,ids[n]),record=>record.stepControl?.pending.length);
  }
  const data=store.dataDirectory(install.id);
  for(let n=0;n<ids.length;n++) {
    const pending=await getAppRun(auth,install.id,ids[n]);
    assert.equal(pending.isolation,"run");
    await advanceAppRun(auth,install.id,ids[n],pending.stepControl.pending[0].token);
    const done=await until(()=>getAppRun(auth,install.id,ids[n]),record=>["completed","failed"].includes(record.status));
    assert.equal(done.status,"completed",done.error);
    assert.equal(await appRunValue(auth,install.id,ids[n],done.resultRef),String(n+1));
    assert.equal(await readFile(join(data,"logs","runs",ids[n],"workspace","marker.txt"),"utf8"),String(n+1));
    await until(()=>appHasLease(data,ids[n]),held=>!held);
    if(n===0){assert.equal(await appHasLease(data),true);await assert.rejects(()=>assertAppIdle(data),/运行/);}
  }
  assert.equal((await readAppConfiguration(auth,install.id)).revision,0);
},files=>{
  const manifest=JSON.parse(files.get("plugin.json").toString("utf8"));
  manifest.extensions["com.eureka"].automation.capabilities.push("files.write");
  files.set("plugin.json",Buffer.from(JSON.stringify(manifest)));
  files.set("scripts/main.mjs",Buffer.from('export default async ctx => ctx.step("read", null, async () => { const file=ctx.files.child(ctx.files.workspace,"marker.txt"); await ctx.files.writeText(file,String(ctx.params.delayMs)); return ctx.files.readText(file); });'));
}));

test("cancellation ends a non-responsive worker and prevents removal until it has stopped", async () => fixture(async ({ auth, install, store, values }) => {
  const id = randomUUID(); await startAppRun(auth, install.id, install.revision, id, values, 0);
  await until(() => getAppRun(auth, install.id, id), record => record.events.some(e => e.kind === "node" && e.status === "running"));
  await assert.rejects(store.uninstall(install.id, install.revision), /运行/);
  await assert.rejects(store.uninstall(install.id, install.revision, undefined, true), /运行/);
  await stopAppRun(auth, install.id, id);
  const stopped = await until(() => getAppRun(auth, install.id, id), record => record.status === "cancelled");
  assert.equal(stopped.resultRef, undefined);
  assert(!stopped.events.some(e => e.kind === "node" && e.status === "completed"));
}, files => files.set("scripts/main.mjs", Buffer.from('export default async ctx => ctx.step("read", null, async () => { while (true) {} });'))));
test("worker cannot directly write a read-only selection through Node fs", async () => fixture(async ({ auth, install, source, values }) => {
  const id = randomUUID(); await startAppRun(auth, install.id, install.revision, id, values, 0);
  const stopped = await until(() => getAppRun(auth, install.id, id), record => record.status === "failed");
  assert.match(stopped.error, /restricted|denied|permission/i);
  await assert.rejects(readFile(join(source, "forbidden.txt")), { code: "ENOENT" });
}, files => files.set("scripts/main.mjs", Buffer.from('import {writeFile} from "node:fs/promises"; export default async ctx => ctx.step("read", null, () => writeFile(ctx.params.source.label + "/forbidden.txt", "bad"));'))));
test("parameter types retain long text IDs, zero, false, null, percentages and JSON values", () => {
  const fields = [{ id: "id", label: "编号", type: "text", required: true }, { id: "zero", label: "零", type: "number", required: true }, { id: "flag", label: "开关", type: "boolean", required: true }, { id: "empty", label: "空值", type: "text" }, { id: "rate", label: "比例", type: "percentage" }, { id: "rows", label: "列表", type: "list" }, { id: "date", label: "日期", type: "date" }];
  const ui = { fields }, values = { id: "999999999999999999999", zero: 0, flag: false, empty: null, rate: 12.5, rows: [{ name: "A", value: 0 }], date: "2026-10-31" };
  assert.deepEqual(appParameters(ui, values, true), values);
  assert.throws(() => appParameters(ui, { ...values, date: "2026-02-30" }, true));
  assert.throws(() => appParameters(ui, { ...values, zero: NaN }, true));
});
