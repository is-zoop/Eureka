import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

test("a failed direct browser launch releases its process exit handler and redacts paths", async () => {
  const jiti = createJiti(import.meta.url);
  const { launchBrowserWindow } = await jiti.import("./browser-window-launcher.ts");
  const before = process.listenerCount("exit");
  await assert.rejects(launchBrowserWindow(join(tmpdir(), `missing-browser-${randomUUID()}.exe`)), error => {
    assert.equal(error.message, "浏览器窗口启动失败，请检查本机桌面环境");
    return true;
  });
  assert.equal(process.listenerCount("exit"), before);
});
