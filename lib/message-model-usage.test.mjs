import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { messageCost, messageModelLabel } = await createJiti(import.meta.url).import("./message-model-usage.ts");

test("provider billing, explicit estimates and legacy unknowns remain distinct including zero", () => {
  assert.deepEqual(messageCost({ cost: { total: 0, totalFromProvider: true } }), { total: 0, source: "provider" });
  assert.deepEqual(messageCost({ cost: { total: 1, totalFromProvider: false } }), { total: 1, source: "estimate" });
  assert.deepEqual(messageCost({ cost: { total: 1 } }), { total: 1, source: "unknown" });
  for (const total of [undefined, NaN, Infinity, -1]) assert.equal(messageCost({ cost: { total } }), null);
  assert.equal(messageCost(undefined), null);
});

test("reported models supplement the dispatch model without rewriting it or borrowing another provider's label", () => {
  const names = { "radius:auto": "Radius Auto", auto: "Auto" };
  assert.deepEqual(messageModelLabel({ provider: "radius", model: "auto", responseModel: "actual-model" }, names), { model: "Radius Auto", responseModel: "actual-model" });
  assert.deepEqual(messageModelLabel({ provider: "radius", model: "auto", responseModel: "auto" }, names), { model: "Radius Auto", responseModel: null });
  assert.deepEqual(messageModelLabel({ provider: "old", model: "legacy" }), { model: "legacy", responseModel: null });
});
