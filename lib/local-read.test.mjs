import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { fetchLocalRead } = await createJiti(import.meta.url).import("./local-read.ts");

async function fixture(work) { const old = globalThis.fetch, env = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try { await work(); } finally { globalThis.fetch = old; if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; } }

test("a dropped local connection recovers through GET only", () => fixture(async () => {
  let calls = 0; globalThis.fetch = async (_url, options) => { assert.equal(options.method, "GET"); if (++calls === 1) throw new TypeError("connection lost"); return Response.json({ ok: true }); };
  assert.equal((await fetchLocalRead("/api/automation/tasks", { timeoutMs: 1000 })).status, 200); assert.equal(calls, 2);
}));
test("a gateway restart recovers, while auth and application conflicts never retry", () => fixture(async () => {
  let calls = 0; globalThis.fetch = async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({});
  assert.equal((await fetchLocalRead("/api/automation/authoring", { timeoutMs: 1000 })).status, 200);
  for (const status of [401, 403, 404, 409, 500]) { calls = 0; globalThis.fetch = async () => { calls++; return new Response(null, { status }); };
    assert.equal((await fetchLocalRead("/api/automation/tasks", { timeoutMs: 1000 })).status, status); assert.equal(calls, 1); }
}));
test("navigation cancels recovery and cannot issue a stale second request", () => fixture(async () => {
  const abort = new AbortController(); let calls = 0;
  globalThis.fetch = async () => { calls++; abort.abort(); throw new TypeError("closed"); };
  await assert.rejects(fetchLocalRead("/api/automation/tasks", { timeoutMs: 1000, signal: abort.signal }), error => error.name === "AbortError"); assert.equal(calls, 1);
  await assert.rejects(fetchLocalRead("https://provider.test/api", { timeoutMs: 1000 }), /application API/);
}));
test("a read deadline retries once and then propagates the timeout", () => fixture(async () => {
  let calls = 0; globalThis.fetch = async (_url, { signal }) => { calls++; return new Promise((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); }); };
  const keepAlive = setTimeout(() => {}, 1500);
  try { await assert.rejects(fetchLocalRead("/api/automation/tasks", { timeoutMs: 5 }), error => error.name === "TimeoutError"); assert.equal(calls, 2); } finally { clearTimeout(keepAlive); }
}));

test("runtime reads allow cold development compilation without increasing production deadlines", () => fixture(async () => {
  const originalTimeout = AbortSignal.timeout, deadlines = [];
  AbortSignal.timeout = ms => { deadlines.push(ms); return new AbortController().signal; };
  globalThis.fetch = async () => Response.json({});
  try {
    process.env.NODE_ENV = "development";
    await fetchLocalRead("/api/automation/apps/fixture/runtime?mode=config", { timeoutMs: 15000 });
    process.env.NODE_ENV = "production";
    await fetchLocalRead("/api/automation/apps/fixture/runtime?mode=runs", { timeoutMs: 15000 });
    assert.deepEqual(deadlines, [45000, 15000]);
  } finally { AbortSignal.timeout = originalTimeout; }
}));
