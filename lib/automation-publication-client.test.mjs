import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { loadPublicationView } = await createJiti(import.meta.url).import("./automation-publication-client.ts");

test("replayed mount reads share a request, but later refreshes load fresh data", async () => {
  let requests = 0, finish;
  const fetcher = async () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const url = "/publication?ownerKey=one&runtimeId=login-one";
  const first = loadPublicationView(url, fetcher), replay = loadPublicationView(url, fetcher);
  assert.equal(first, replay);
  await Promise.resolve(); assert.equal(requests, 1);
  finish(Response.json({ draft: { name: "First" } }));
  assert.equal((await replay).draft.name, "First");
  const refresh = loadPublicationView(url, async () => { requests++; return Response.json({ draft: { name: "Changed" } }); });
  assert.notEqual(refresh, first); assert.equal((await refresh).draft.name, "Changed"); assert.equal(requests, 2);
});

test("different applications/logins do not share reads, and failed reads can be retried", async () => {
  let requests = 0;
  const fetcher = async url => { requests++; return Response.json({ url }); };
  const one = loadPublicationView("/apps/one/publication?runtimeId=one", fetcher);
  const two = loadPublicationView("/apps/two/publication?runtimeId=one", fetcher);
  const otherLogin = loadPublicationView("/apps/one/publication?runtimeId=two", fetcher);
  await Promise.all([one, two, otherLogin]); assert.equal(requests, 3);
  const url = "/apps/failed/publication";
  await assert.rejects(loadPublicationView(url, async () => Response.json({ error: "Haze unavailable" }, { status: 502 })), /Haze unavailable/);
  assert.deepEqual(await loadPublicationView(url, async () => Response.json({ recovered: true })), { recovered: true });
});
