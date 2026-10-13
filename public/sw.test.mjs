import assert from "node:assert/strict";
import test from "node:test";

const listeners = new Map();
globalThis.self = {
  location: {
    href: "https://pi.test/sw.js?v=test",
    origin: "https://pi.test",
  },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: null,
};

await import("./sw.js");

test("refreshes the offline page cache and retires the previous branding cache", async () => {
  const previousCaches = globalThis.caches;
  const previousSkipWaiting = self.skipWaiting;
  const previousClients = self.clients;
  const calls = [];
  let installedCache;
  globalThis.caches = {
    open: async (key) => {
      installedCache = key;
      return { addAll: async (urls) => { calls.push(["precache", urls]); } };
    },
    keys: async () => ["pi-web-static-icons-v1-test", installedCache, "other-app-cache"],
    delete: async (key) => { calls.push(["delete", key]); return true; },
  };
  self.skipWaiting = async () => { calls.push(["skipWaiting"]); };
  self.clients = { claim: async () => { calls.push(["claim"]); } };

  try {
    let pending;
    listeners.get("install")({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    assert.notEqual(installedCache, "pi-web-static-icons-v1-test");
    assert.ok(calls[0][1].includes("/offline.html"));
    assert.ok(calls[0][1].includes("/manifest.webmanifest"));
    assert.deepEqual(calls[1], ["skipWaiting"]);

    listeners.get("activate")({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    assert.deepEqual(calls.slice(2), [["delete", "pi-web-static-icons-v1-test"], ["claim"]]);
  } finally {
    globalThis.caches = previousCaches;
    self.skipWaiting = previousSkipWaiting;
    self.clients = previousClients;
  }
});

function dispatchNotificationClick(data) {
  let pending;
  let closed = false;
  listeners.get("notificationclick")({
    notification: {
      data,
      close: () => { closed = true; },
    },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, wasClosed: () => closed };
}

test("notification click focuses an existing client at the session URL", async () => {
  const calls = [];
  const focusedClient = {
    url: "https://pi.test/?session=session-1",
    focus: async () => { calls.push("focus"); },
    navigate: async () => assert.fail("exact client should not navigate"),
  };
  self.clients = {
    matchAll: async () => [focusedClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.equal(event.wasClosed(), true);
  assert.deepEqual(calls, ["focus"]);
});

test("notification click navigates an existing client to the session", async () => {
  const calls = [];
  const navigatedClient = {
    focus: async () => { calls.push("focus"); },
  };
  const existingClient = {
    url: "https://pi.test/?session=other-session",
    navigate: async (url) => {
      calls.push(["navigate", url]);
      return navigatedClient;
    },
    focus: async () => assert.fail("the navigated client should be focused"),
  };
  self.clients = {
    matchAll: async () => [existingClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.deepEqual(calls, [
    ["navigate", "https://pi.test/?session=session-1"],
    "focus",
  ]);
});

test("notification click opens a window and rejects cross-origin targets", async () => {
  const opened = [];
  self.clients = {
    matchAll: async () => [],
    openWindow: async (url) => { opened.push(url); },
  };

  const event = dispatchNotificationClick({ url: "https://example.com/redirect" });
  await event.pending;

  assert.deepEqual(opened, ["https://pi.test/"]);
});
