import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { userMessageKey, appendDeliveredUserMessage } = await createJiti(import.meta.url).import("./prompt-recovery.ts");

function textMessage(content) {
  return { role: "user", content, timestamp: 1 };
}

test("builds stable keys for matching optimistic text messages", () => {
  assert.equal(userMessageKey(textMessage("repeat this")), userMessageKey(textMessage("repeat this")));
  assert.notEqual(userMessageKey(textMessage("first")), userMessageKey(textMessage("second")));
});

test("includes attached images in optimistic message keys", () => {
  const submitted = {
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
    timestamp: 1,
  };
  const differentImage = {
    ...submitted,
    content: [
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "BAUG" } },
    ],
  };
  assert.notEqual(userMessageKey(submitted), userMessageKey(differentImage));
});

test("a string optimistic message and its SDK text-block echo make one bubble", () => {
  const submitted = textMessage("hello");
  const delivered = { ...submitted, content: [{ type: "text", text: "hello" }], timestamp: 2 };
  const messages = [submitted];
  assert.equal(appendDeliveredUserMessage(messages, delivered, userMessageKey(submitted)), messages);
});

test("same-text follow-up messages still render once the optimistic echo was consumed", () => {
  const submitted = textMessage("hello");
  const delivered = { ...submitted, timestamp: 2 };
  assert.equal(appendDeliveredUserMessage([submitted], delivered, null).length, 2);
  const reply = { role: "assistant", content: [] };
  assert.deepEqual(appendDeliveredUserMessage([submitted, reply], delivered, userMessageKey(submitted)), [submitted, reply, delivered]);
});

test("SDK-normalized images replace the optimistic bubble without duplicating it", () => {
  const submitted = { role: "user", content: [{ type: "text", text: "inspect" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "original" } }] };
  const normalized = { role: "user", content: [{ type: "text", text: "inspect" }, { type: "image", data: "resized", mimeType: "image/png" }] };
  assert.deepEqual(appendDeliveredUserMessage([submitted], normalized, userMessageKey(submitted)), [normalized]);
});
