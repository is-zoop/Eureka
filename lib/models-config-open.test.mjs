import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { openModelsConfigFile } = await jiti.import("./models-config-open.ts");

async function temporaryConfig(t) {
  const directory = await mkdtemp(join(tmpdir(), "eureka-open-models-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "agent with spaces", "models.json");
}

function fakeEditor(calls, failure) {
  return (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => {
      if (failure) child.emit("error", failure);
      else { child.emit("spawn"); child.emit("exit", 0); }
    });
    return child;
  };
}

test("opening an absent configuration creates a private empty file and passes its path as one argument", async t => {
  const path = await temporaryConfig(t);
  const calls = [];
  await openModelsConfigFile(path, fakeEditor(calls));
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { providers: {} });
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, process.platform === "win32" ? "notepad.exe" : process.platform === "darwin" ? "open" : "xdg-open");
  assert.deepEqual(args, process.platform === "darwin" ? ["-t", path] : [path]);
  assert.equal(options.shell, false);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("opening existing hand-edited JSON preserves every byte, including invalid drafts", async t => {
  const path = await temporaryConfig(t);
  await mkdir(join(path, ".."), { recursive: true });
  const contents = '{\n  "providers": { "work in progress": ';
  await writeFile(path, contents);
  await openModelsConfigFile(path, fakeEditor([]));
  assert.equal(await readFile(path, "utf8"), contents);
});

test("a directory in place of models.json is rejected before starting an editor", async t => {
  const path = await temporaryConfig(t);
  await mkdir(path, { recursive: true });
  const calls = [];
  await assert.rejects(openModelsConfigFile(path, fakeEditor(calls)), /not a file/);
  assert.equal(calls.length, 0);
});

test("an unavailable editor reports an error while leaving the configuration intact", async t => {
  const path = await temporaryConfig(t);
  await assert.rejects(openModelsConfigFile(path, fakeEditor([], new Error("Editor missing"))), /Editor missing/);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { providers: {} });
});

test("cross-site file-open requests are rejected without launching an editor", async () => {
  const { POST } = await jiti.import("../app/api/models-config/open/route.ts");
  const response = await POST(new Request("http://localhost/api/models-config/open", {
    method: "POST", headers: { host: "localhost", origin: "https://elsewhere.test" },
  }));
  assert.equal(response.status, 403);
});
