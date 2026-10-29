import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getRecentTraySessions } = await createJiti(import.meta.url).import("./desktop-tray.ts");

test("tray recents use latest activity across projects without mutating the sidebar list", () => {
  const sessions = [
    { id: "a", cwd: "E:/one", modified: "2026-10-27T08:00:00Z" },
    { id: "b", cwd: "E:/two", modified: "2026-10-29T08:00:00Z" },
    { id: "c", cwd: "E:/one", modified: "2026-10-28T08:00:00Z" },
    { id: "d", cwd: "E:/three", modified: "2026-10-29T09:00:00Z", transient: true },
  ];
  const before = [...sessions];
  const recent = getRecentTraySessions(sessions);
  assert.deepEqual(recent.map(s => s.id), ["d", "b", "c"]);
  assert.equal(recent[0], sessions[3], "retain full session metadata for normal navigation");
  assert.deepEqual(sessions, before);
});

test("tray recents handle duplicates, missing dates and fewer than three sessions", () => {
  assert.deepEqual(getRecentTraySessions([]), []);
  const recent = getRecentTraySessions([
    { id: "a", modified: "invalid" },
    { id: "", modified: "2026-10-29" },
    { id: "a", modified: "2026-10-28" },
    { id: "b", modified: "2026-10-29" },
  ]);
  assert.deepEqual(recent.map(s => s.id), ["b", "a"]);
  assert.equal(recent[1].modified, "2026-10-28");
});
