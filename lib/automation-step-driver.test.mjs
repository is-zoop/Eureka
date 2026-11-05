// User-run only; exercises scheduling promises without a worker or website.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { AutomationStepDriver } = await createJiti(import.meta.url).import("./automation-step-driver.ts");

test("one tool authorization releases one real closure, including parallel script branches", async () => {
  let pending = [], current, first = 0, second = 0;
  const driver = new AutomationStepDriver(async (queue, active) => { pending = queue; current = active; });
  const one = driver.wait("read", 1, "input-one").then(() => first++);
  const two = driver.wait("export", 2, "input-two").then(() => second++);
  assert.equal(first + second, 0); assert.equal(pending.length, 2);
  const firstToken = pending[0].token;
  await driver.advance(firstToken); await one;
  assert.equal(first, 1); assert.equal(second, 0); assert.equal(current.execution, 1);
  await driver.advance(firstToken); assert.equal(first, 1);
  await assert.rejects(driver.advance(pending[0].token), /上一步尚未结束/);
  await driver.complete(1); await driver.advance(pending[0].token); await two;
  assert.equal(second, 1); await driver.complete(2);
  // A late duplicate receipt never executes the old closure again.
  await driver.advance(firstToken); assert.equal(first, 1);
});

test("a stale token cannot jump ahead and stopping rejects queued work", async () => {
  let pending = [];
  const driver = new AutomationStepDriver(async queue => { pending = queue; });
  const work = driver.wait("read", 1, "input-one");
  await assert.rejects(driver.advance("invented-token"), /引用已变化/);
  assert.equal(pending.length, 1);
  driver.close("user stopped");
  await assert.rejects(work, /user stopped/);
  await assert.rejects(driver.advance(pending[0].token), /调度已停止/);
});
