import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { DesktopUpdateController, updateErrorKey } = await jiti.import("./desktop-update-controller.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const state = (phase = "idle", extra = {}) => ({ enabled: true, currentVersion: "0.8.8", phase, version: null, notes: null, downloadedBytes: 0, totalBytes: null, readyToInstall: false, error: null, ...extra });
function fixture(initial = state()) {
  let listener, count = 0;
  const calls = [];
  const api = {
    isDesktopUpdaterHost: () => true,
    getDesktopUpdateState: async () => initial,
    subscribeDesktopUpdate: async next => { listener = next; return () => { count++; }; },
    checkDesktopUpdate: async () => { calls.push("check"); return state("available", { version: "0.8.9" }); },
    downloadDesktopUpdate: async version => { calls.push(["download", version]); return state("downloaded", { version, readyToInstall: true }); },
    installDesktopUpdate: async version => { calls.push(["install", version]); return state("installing", { version, readyToInstall: true }); },
  };
  const controller = new DesktopUpdateController(api, 1_000_000);
  return { api, controller, calls, emit: value => listener(value), stopped: () => count };
}

test("only explicit installation follows a download, and progress survives closing/reopening", async () => {
  const f = fixture();
  const close = f.controller.connect(); await tick();
  await f.controller.run("check"); await f.controller.run("download");
  assert.deepEqual(f.calls, ["check", ["download", "0.8.9"]]);
  assert.equal(f.controller.getSnapshot().state.readyToInstall, true);
  close();
  f.api.getDesktopUpdateState = async () => state("downloaded", { version: "0.8.9", readyToInstall: true });
  const closeAgain = f.controller.connect(); await tick();
  assert.equal(f.controller.getSnapshot().state.readyToInstall, true);
  await f.controller.run("install");
  assert.deepEqual(f.calls.at(-1), ["install", "0.8.9"]);
  closeAgain(); assert.equal(f.stopped(), 2);
});

test("late snapshots cannot replace newer progress and duplicate actions are ignored", async () => {
  const f = fixture(); const read = deferred(); f.api.getDesktopUpdateState = () => read.promise;
  const close = f.controller.connect(); await tick();
  f.emit(state("downloading", { version: "0.8.9", downloadedBytes: 50, totalBytes: 100 }));
  read.resolve(state()); await tick();
  assert.equal(f.controller.getSnapshot().state.downloadedBytes, 50);
  f.emit(state("available", { version: "0.8.9" }));
  const downloaded = deferred(); let calls = 0;
  f.api.downloadDesktopUpdate = () => { calls++; return downloaded.promise; };
  const first = f.controller.run("download"); await f.controller.run("download"); await f.controller.run("install");
  assert.equal(calls, 1);
  f.emit(state("downloaded", { version: "0.8.9", readyToInstall: true }));
  downloaded.resolve(state("available", { version: "0.8.9" })); await first;
  assert.equal(f.controller.getSnapshot().state.readyToInstall, true);
  close();
});

test("failed busy-task installation remains ready to retry without re-downloading", async () => {
  const f = fixture(state("downloaded", { version: "0.8.9", readyToInstall: true }));
  const close = f.controller.connect(); await tick();
  f.api.installDesktopUpdate = async () => { throw new Error("仍有聊天或自动化任务正在运行"); };
  await f.controller.run("install");
  const view = f.controller.getSnapshot();
  assert.equal(view.state.readyToInstall, true); assert.equal(view.failedAction, "install");
  assert.equal(updateErrorKey(view.error), "updates.errorTasks");
  close();
});

test("development builds and web sessions never check, download or install", async () => {
  for (const browser of [true, false]) {
    const f = fixture(state("disabled", { enabled: false }));
    f.api.isDesktopUpdaterHost = () => !browser;
    const close = f.controller.connect(); await tick();
    for (const action of ["check", "download", "install"]) await f.controller.run(action);
    assert.deepEqual(f.calls, []); close();
  }
});

test("unreachable services and invalid signatures give distinct recovery guidance", () => {
  assert.equal(updateErrorKey("Could not verify that local tasks are idle. Installation was not started."), "updates.errorLocalService");
  assert.equal(updateErrorKey("Signature verification failed"), "updates.errorSignature");
  assert.equal(updateErrorKey("Command desktop_update_state not found"), "updates.errorUnavailable");
});

test("help-menu checks wait for initialization and preserve verified downloads", async () => {
  const f = fixture(); const read = deferred(); f.api.getDesktopUpdateState = () => read.promise;
  const close = f.controller.connect(); await tick();
  f.controller.requestCheck(); assert.deepEqual(f.calls, []);
  read.resolve(state()); await tick();
  assert.deepEqual(f.calls, ["check"]);
  await f.controller.run("download");
  f.controller.requestCheck(); await tick();
  assert.deepEqual(f.calls, ["check", ["download", "0.8.9"]], "menu preserves a downloaded installer");
  close();
});
