import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { readAutomationResponse, AutomationRequestError, automationRequestErrorKey } = await createJiti(import.meta.url).import("./automation-response.ts");

test("only a submitted start timeout warns about an unconfirmed start", () => {
  const timeout = new DOMException("signal timed out", "TimeoutError");
  assert.equal(automationRequestErrorKey(timeout, "read"), "automationUi.reconnecting");
  assert.equal(automationRequestErrorKey(timeout, "write"), "automationUi.operationTimeout");
  assert.equal(automationRequestErrorKey(timeout, "start"), "automationUi.startTimeout");
  assert.equal(automationRequestErrorKey(new TypeError("connection closed"), "read"), "automationUi.reconnecting");
  assert.equal(automationRequestErrorKey(new AutomationRequestError("workspace changed", 409), "read"), null);
});
test("automation JSON succeeds; rejected requests preserve HTTP status and message", async () => {
  assert.deepEqual(await readAutomationResponse(Response.json({ revision: 3 }), "fallback", "invalid"), { revision: 3 });
  await assert.rejects(() => readAutomationResponse(Response.json({error:"revision changed"}, {status:409}), "fallback", "invalid"), e => e instanceof AutomationRequestError && e.status === 409 && e.message === "revision changed");
});
test("HTML route failures, redirects and malformed JSON never expose HTML/parser text", async () => {
  for (const status of [200,404,500]) {
    const response = new Response("<!DOCTYPE html><html>internal server path</html>", {status,headers:{"content-type":"text/html"}});
    await assert.rejects(() => readAutomationResponse(response, "fallback", "Reload automation service"), e => e.status === status && e.message === "Reload automation service");
  }
  await assert.rejects(() => readAutomationResponse(new Response("{broken", {headers:{"content-type":"application/json"}}), "fallback", "invalid"), e => e instanceof AutomationRequestError && e.message === "invalid");
  assert.deepEqual(await readAutomationResponse(new Response('{"ok":true}',{headers:{"content-type":"application/problem+json; charset=utf-8"}}),"fallback","invalid"),{ok:true});
});
test("cancellation is preserved rather than misclassified as a rejected start", async () => {
  const error = new DOMException("cancelled", "AbortError");
  const response = {status:200,ok:true,headers:new Headers({"content-type":"application/json"}),json:async()=>{throw error;}};
  await assert.rejects(() => readAutomationResponse(response,"fallback","invalid"), e => e === error);
});
