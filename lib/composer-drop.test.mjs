import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { containsPhysicalDrop, bindNativeFileDrop } = await jiti.import("./composer-drop.ts");
test("native drop coordinates honor display scaling and reject hidden composers", () => {
  const rect = { left: 100, top: 200, right: 400, bottom: 300, width: 300, height: 100 };
  assert.equal(containsPhysicalDrop(rect, { x: 300, y: 375 }, 1.5), true);
  assert.equal(containsPhysicalDrop(rect, { x: 150, y: 300 }, 1.5), true);
  assert.equal(containsPhysicalDrop(rect, { x: 600, y: 450 }, 1.5), false);
  assert.equal(containsPhysicalDrop({ ...rect, width: 0 }, { x: 300, y: 450 }, 1.5), false);
});
test("only a drop over the active composer attaches native paths, and leaving clears hover", async () => {
  let handler, stopped = 0; const drops = [], hovering = [];
  const cleanup = bindNativeFileDrop(async callback => { handler = callback; return () => stopped++; }, {
    contains: position => position.y > 100, hover: active => hovering.push(active), drop: paths => drops.push(paths),
  });
  handler({ payload: { type: "enter", position: { x: 0, y: 150 }, paths: ["C:/sheet.xlsx"] } });
  handler({ payload: { type: "drop", position: { x: 0, y: 0 }, paths: ["C:/ignored.xlsx"] } });
  handler({ payload: { type: "drop", position: { x: 0, y: 150 }, paths: ["C:/sheet.xlsx", "C:/photo.png", "C:/folder"] } });
  handler({ payload: { type: "leave" } });
  assert.deepEqual(drops, [["C:/sheet.xlsx", "C:/photo.png", "C:/folder"]]);
  assert.deepEqual(hovering, [true, false, false, false]);
  await Promise.resolve(); cleanup(); assert.equal(stopped, 1);
  handler({ payload: { type: "drop", position: { x: 0, y: 150 }, paths: ["late"] } });
  assert.equal(drops.length, 1);
});
test("late native registration is cleaned up after navigation", async () => {
  let finish, handler, stopped = 0;
  const cleanup = bindNativeFileDrop(callback => { handler = callback; return new Promise(resolve => { finish = resolve; }); }, {
    contains: () => true, hover: () => assert.fail("late callback"), drop: () => assert.fail("late drop"),
  });
  cleanup(); finish(() => stopped++); await Promise.resolve(); assert.equal(stopped, 1);
  handler({ payload: { type: "drop", paths: ["late"], position: { x: 0, y: 0 } } });
});
