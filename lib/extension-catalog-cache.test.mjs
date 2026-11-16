import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { ExtensionCatalogCache } = await createJiti(import.meta.url).import("./extension-catalog-cache.ts");

test("parallel catalog reads share one upstream request; returned objects stay independent", async () => {
  const cache = new ExtensionCatalogCache(); let reads = 0, finish;
  const load = () => { reads++; return new Promise(resolve => { finish = resolve; }); };
  const a = cache.read("login-a:skill", 30, load), b = cache.read("login-a:skill", 30, load);
  await Promise.resolve(); finish([{ name: "original" }]);
  const [one, two] = await Promise.all([a, b]); one[0].name = "changed";
  assert.equal(two[0].name, "original"); assert.equal(reads, 1);
  assert.equal((await cache.read("login-a:skill", 30, load))[0].name, "original");
});

test("expiry, explicit reload, and account keys fetch fresh data", async () => {
  let now = 0, reads = 0; const cache = new ExtensionCatalogCache(32, () => now), load = async () => ++reads;
  assert.equal(await cache.read("a:skill", 10, load), 1);
  assert.equal(await cache.read("b:skill", 10, load), 2);
  assert.equal(await cache.read("a:skill", 10, load, true), 3);
  now = 11; assert.equal(await cache.read("a:skill", 10, load), 4);
});

test("failed reads do not poison retries, and invalidation fences an older pending read", async () => {
  const cache = new ExtensionCatalogCache();
  await assert.rejects(cache.read("a:skill", 10, async () => { throw Error("offline"); }), /offline/);
  let finish; const old = cache.read("a:skill", 1000, () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); cache.invalidate("a:");
  await cache.read("a:skill", 1000, async () => "fresh"); finish("old"); await old;
  assert.equal(await cache.read("a:skill", 1000, async () => "wrong"), "fresh");
});

test("entry and byte budgets evict cached display data", async () => {
  const cache = new ExtensionCatalogCache(2, Date.now, 32); let reads = 0;
  await cache.read("a", 10000, async () => "one"); await cache.read("b", 10000, async () => "two");
  await cache.read("c", 10000, async () => "three");
  await cache.read("a", 10000, async () => { reads++; return "one"; }); assert.equal(reads, 1);
  const large = async () => { reads++; return "x".repeat(100); };
  await cache.read("large", 10000, large); await cache.read("large", 10000, large); assert.equal(reads, 3);
});

test("zero TTL shares only in-flight checks and never reuses a completed permission result", async () => {
  const cache = new ExtensionCatalogCache(); let checks = 0, finish;
  const load = () => { checks++; return new Promise(resolve => { finish = resolve; }); };
  const a = cache.read("auth:login", 0, load), b = cache.read("auth:login", 0, load);
  await Promise.resolve(); finish({ permissions: ["market"] }); await Promise.all([a, b]);
  assert.equal(checks, 1);
  assert.deepEqual(await cache.read("auth:login", 0, async () => { checks++; return { permissions: [] }; }), { permissions: [] });
  assert.equal(checks, 2);
});
