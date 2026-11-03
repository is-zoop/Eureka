import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { parsePageObservation, observationText } = await jiti.import("./automation-observation.ts");
const sample = () => ({ id: "view:1:hash", capturedAt: Date.now(), title: "Products", url: "https://example.com/items?token=secret#private", text: "Price 10", elements: [{ ref: "e1", role: "button", label: "Search", type: "", disabled: false, bounds: { x: 0, y: 2, width: 30, height: 20 } }], viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 }, limitations: ["viewport-only"] });

test("observation boundary removes unknown fields and URL secrets", () => {
  const raw = sample(); raw.cookie = "secret"; raw.elements[0].value = "password";
  const page = parsePageObservation(raw);
  assert.equal(page.url, "https://example.com/items");
  assert.equal("cookie" in page, false);
  assert.equal("value" in page.elements[0], false);
  assert.ok(!observationText(page).includes("secret"));
});
test("observation rejects executable URLs, oversized text and invalid image payloads", () => {
  for (const url of ["file:///C:/private", "javascript:alert(1)", "https://user:password@example.com"]) {
    assert.throws(() => parsePageObservation({ ...sample(), url }));
  }
  assert.throws(() => parsePageObservation({ ...sample(), text: "x".repeat(16001) }));
  assert.throws(() => parsePageObservation({ ...sample(), elements: Array(121).fill(sample().elements[0]) }));
  assert.throws(() => parsePageObservation({ ...sample(), image: { mimeType: "image/svg+xml", data: "PHN2Zz4=" } }));
  assert.throws(() => parsePageObservation({ ...sample(), viewport: { width: NaN, height: 1, scrollX: 0, scrollY: 0 } }));
});
test("model text contains structure and limits, never duplicates screenshot bytes", () => {
  const page = parsePageObservation({ ...sample(), image: { mimeType: "image/jpeg", data: "/9j/AA==" } });
  const text = observationText(page);
  assert.ok(text.includes("viewport-only"));
  assert.ok(text.includes('"screenshotIncluded": true'));
  assert.ok(!text.includes("/9j/AA=="));
});
