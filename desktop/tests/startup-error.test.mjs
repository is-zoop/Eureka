import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../ui/startup-error.js", import.meta.url), "utf8");

test("startup error identifies the failing stage and allows another retry if the host declines", async () => {
  const heading = {};
  const status = {};
  let click;
  const button = { addEventListener(_name, handler) { click = handler; } };
  const elements = {
    "startup-error": heading, "startup-retry": button, "startup-status": status,
  };
  const calls = [];
  runInNewContext(script, {
    URL,
    location: { href: "http://tauri.localhost/error.html?stage=page" },
    document: { getElementById: id => elements[id] },
    window: { __TAURI_INTERNALS__: { invoke(command) {
      calls.push(command);
      return Promise.reject(new Error("host rejected retry"));
    } } },
  });

  assert.equal(heading.textContent, "Eureka 页面加载超时");
  const attempt = click();
  assert.equal(button.disabled, true);
  assert.deepEqual(calls, ["desktop_startup_retry"]);
  await attempt;
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /无法开始重试/);
});
