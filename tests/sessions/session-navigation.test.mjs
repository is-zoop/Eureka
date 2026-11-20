import assert from "node:assert/strict";
import test from "node:test";
import { replaceSessionUrl } from "../../features/sessions/shared/session-navigation.ts";

function browser(t, href) {
  const previous = globalThis.window;
  const location = new URL(href);
  const calls = [];
  globalThis.window = {
    location,
    history: {
      replaceState(data, title, url) {
        calls.push({ data, title, url });
        location.href = new URL(url, location).href;
      },
      pushState() { assert.fail("session selection must not add browser history entries"); },
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  return { location, calls };
}

test("selecting history updates the address in place and preserves the app pathname", (t) => {
  const { location, calls } = browser(t, "http://localhost/eureka/?session=old");
  replaceSessionUrl("selected");
  assert.equal(location.href, "http://localhost/eureka/?session=selected");
  assert.deepEqual(calls, [{ data: null, title: "", url: "/eureka/?session=selected" }]);
});

test("reselecting the same session leaves the current history entry untouched", (t) => {
  const { calls } = browser(t, "http://localhost/?session=current");
  replaceSessionUrl("current");
  assert.deepEqual(calls, []);
});

test("new chats clear the old session, startup cwd and hash", (t) => {
  const { location } = browser(t, "http://localhost/?session=old&cwd=C%3A%5Cproject#entry");
  replaceSessionUrl(null);
  assert.equal(location.href, "http://localhost/");
});

test("session addresses safely encode IDs and do not duplicate startup parameters", (t) => {
  const { location } = browser(t, "http://localhost/?cwd=C%3A%5Cproject#entry");
  replaceSessionUrl("fork/id?value=1");
  assert.equal(location.searchParams.get("session"), "fork/id?value=1");
  assert.deepEqual([...location.searchParams.keys()], ["session"]);
  assert.equal(location.hash, "");
});
