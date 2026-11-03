import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const updater = await jiti.import("./desktop-updater.ts");
test("browser sessions cannot invoke native update or installation commands", async () => {
  assert.equal(updater.isDesktopUpdaterHost(), false);
  for (const action of [updater.getDesktopUpdateState, updater.checkDesktopUpdate, () => updater.downloadDesktopUpdate("0.8.9"), () => updater.installDesktopUpdate("0.8.9")]) {
    await assert.rejects(action, /仅支持 Eureka 桌面端/);
  }
  const stop = await updater.subscribeDesktopUpdate(() => assert.fail("browser sessions cannot receive native events"));
  assert.equal(typeof stop, "function");
  stop();
});
