import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readSessionArchives, summarizeArchivedBranch, updateSessionArchive } = await jiti.import("../../features/sessions/server/session-archives.ts");
const { getRecentTraySessions } = await jiti.import("../../features/workspace/platform/desktop-tray.ts");

test("archived conversation details count user turns and ignore trailing tools and metadata", () => {
  const message = (role, content, date) => ({
    type: "message", message: { role, content }, timestamp: `2026-11-${date}T00:00:00.000Z`,
  });
  const stats = summarizeArchivedBranch([
    message("user", "first question", "01"),
    message("assistant", [{ type: "text", text: "first answer" }], "02"),
    message("user", "follow-up", "03"),
    message("assistant", [{ type: "text", text: "second answer" }], "04"),
    message("assistant", [{ type: "toolCall" }], "05"),
    message("toolResult", [], "06"),
    { type: "session_info", timestamp: "2026-11-07T00:00:00.000Z" },
  ]);
  assert.deepEqual(stats, { turnCount: 2, lastConversationAt: "2026-11-04T00:00:00.000Z" });
});

test("archive, restore and concurrent updates preserve each session independently", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "eureka-archive-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "archives.json");
  const archive = { archivedAt: "2026-11-19T00:00:00.000Z", turnCount: 1, lastConversationAt: null };

  assert.equal(readSessionArchives(path).size, 0);
  await Promise.all(["first", "second"].map((id) => updateSessionArchive(id, (current) => current ?? archive, path)));
  assert.deepEqual(readSessionArchives(path).get("first"), archive);
  assert.deepEqual(readSessionArchives(path).get("second"), archive);

  const duplicate = await updateSessionArchive("first", (current) => current ?? { ...archive, turnCount: 2 }, path);
  assert.deepEqual(duplicate, archive);
  await updateSessionArchive("first", () => null, path);
  assert.deepEqual([...readSessionArchives(path).keys()], ["second"]);

  const sessions = [
    { id: "first", modified: archive.archivedAt },
    { id: "second", modified: archive.archivedAt, archivedAt: archive.archivedAt },
  ];
  assert.deepEqual(getRecentTraySessions(sessions).map(({ id }) => id), ["first"]);
});
