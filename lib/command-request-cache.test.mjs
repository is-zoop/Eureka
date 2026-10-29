import assert from "node:assert/strict";
import test from "node:test";
import { CommandRequestCache } from "./command-request-cache.ts";

test("reopening a command list reuses it and concurrent reads share one request", async () => {
  const cache = new CommandRequestCache();
  let loads = 0, finish;
  const loader = () => { loads++; return new Promise((resolve) => { finish = resolve; }); };
  const first = cache.load("project-a", loader);
  const second = cache.load("project-a", loader);
  await Promise.resolve();
  assert.equal(loads, 1);
  finish(["skill:demo"]);
  assert.deepEqual(await first, await second);
  await cache.load("project-a", loader);
  assert.equal(loads, 1);
  assert.deepEqual(cache.peek("project-a"), ["skill:demo"]);
});

test("project caches are isolated and an empty successful list is cached", async () => {
  const cache = new CommandRequestCache();
  await cache.load("a", async () => []);
  await cache.load("b", async () => ["demo"]);
  assert.deepEqual(await cache.load("a", async () => { throw new Error("unexpected refetch"); }), []);
  assert.deepEqual(cache.peek("b"), ["demo"]);
});

test("failed refresh keeps the last list and remains retryable", async () => {
  const cache = new CommandRequestCache();
  await cache.load("a", async () => ["original"]);
  await assert.rejects(cache.load("a", async () => { throw new Error("offline"); }, true), /offline/);
  assert.deepEqual(cache.peek("a"), ["original"]);
  assert.deepEqual(await cache.load("a", async () => ["updated"], true), ["updated"]);
});

test("invalidated and superseded requests cannot overwrite a new command list", async () => {
  const cache = new CommandRequestCache();
  let finish;
  const pending = cache.load("a", () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve();
  cache.invalidate();
  await cache.load("a", async () => ["fresh"]);
  finish(["old"]); await pending;
  assert.deepEqual(cache.peek("a"), ["fresh"]);
  let finishForced;
  const older = cache.load("a", () => new Promise((resolve) => { finishForced = resolve; }), true);
  await Promise.resolve();
  await cache.load("a", async () => ["newest"], true);
  finishForced(["older"]); await older;
  assert.deepEqual(cache.peek("a"), ["newest"]);
});
