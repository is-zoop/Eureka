import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../", import.meta.url)), "next/server": import.meta.resolve("next/server.js") } });
const { assertDesktopUpdateIdle, authorizeDesktopUpdate, setDesktopUpdateDrain, withDesktopUpdateAdmission } = await jiti.import("./desktop-update-gate.ts");
const { POST } = await jiti.import("../app/api/desktop-update/route.ts");

test("native installation preflight authenticates, blocks active work and prevents new admissions", async (t) => {
  const keys = ["__piSessions", "__piStartLocks", "__eurekaAppRuns", "__eurekaDesktopInstalling", "__eurekaDesktopAdmissions"];
  const saved = keys.map(key => globalThis[key]);
  const previousToken = process.env.EUREKA_DESKTOP_UPDATE_TOKEN;
  t.after(() => {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete globalThis[key]; else globalThis[key] = saved[i]; });
    if (previousToken === undefined) delete process.env.EUREKA_DESKTOP_UPDATE_TOKEN; else process.env.EUREKA_DESKTOP_UPDATE_TOKEN = previousToken;
  });
  const token = "a".repeat(32);
  process.env.EUREKA_DESKTOP_UPDATE_TOKEN = token;
  const request = (action, value = token) => new Request("http://127.0.0.1:8080/api/desktop-update", { method: "POST", headers: { "content-type": "application/json", "x-eureka-update-token": value }, body: JSON.stringify({ action }) });
  assert.equal(authorizeDesktopUpdate(null), false);
  assert.equal(authorizeDesktopUpdate("é".repeat(32)), false);
  assert.equal((await POST(request("prepare", "wrong"))).status, 403);
  for (const kind of ["chat", "starting", "automation"]) {
    globalThis.__piSessions = new Map(kind === "chat" ? [["chat", { isRunning: () => true }]] : []);
    globalThis.__piStartLocks = new Map(kind === "starting" ? [["session", Promise.resolve()]] : []);
    globalThis.__eurekaAppRuns = { live: new Map(kind === "automation" ? [["run", {}]] : []) };
    const response = await POST(request("prepare"));
    assert.equal(response.status, 409, kind);
    assert.doesNotThrow(assertDesktopUpdateIdle, "a refused update must not block tasks");
  }
  globalThis.__eurekaAppRuns.live.clear();
  globalThis.__piSessions = new Map([["idle", { isRunning: () => false }]]);
  assert.equal((await POST(request("prepare"))).status, 200);
  assert.throws(assertDesktopUpdateIdle, /正在安装更新/);
  assert.equal((await POST(request("cancel", "wrong"))).status, 403);
  assert.throws(assertDesktopUpdateIdle, /正在安装更新/, "unauthorized cancellation cannot reopen admission");
  assert.equal((await POST(request("cancel"))).status, 200);
  assert.doesNotThrow(assertDesktopUpdateIdle);
  let finish;
  const starting = withDesktopUpdateAdmission(() => new Promise(resolve => { finish = resolve; }));
  assert.equal((await POST(request("prepare"))).status, 409, "async task startup cannot race with installation");
  finish(); await starting;
  await assert.rejects(() => withDesktopUpdateAdmission(async () => { throw new Error("startup failed"); }), /startup failed/);
  assert.equal(globalThis.__eurekaDesktopAdmissions, 0, "failed starts release admission");
  assert.equal((await POST(request("prepare"))).status, 200);
  await assert.rejects(() => withDesktopUpdateAdmission(async () => assert.fail("a drained task must not execute")), /正在安装更新/);
  setDesktopUpdateDrain(false);
  assert.equal((await POST(request("unknown"))).status, 400);
});
