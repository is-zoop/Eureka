import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./git-status.ts");
}

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1([
    " M components/App.tsx",
    "?? notes.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) => classifyGitStatus({
    path: "file.ts",
    indexStatus: pair[0],
    worktreeStatus: pair[1],
  });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

test("parses per-file line counts without confusing rename records or special path characters", async () => {
  const { parseGitNumstat } = await loadSubject();
  const stats = parseGitNumstat([
    "12\t3\tapp/file.ts",
    "4\t2\t", "old name.txt", "new name.txt",
    "1\t0\twith\ttab\nand-newline.txt",
    "-\t-\timage.png",
    "0\t0\tmode-only.sh",
    "",
  ].join("\0"));
  assert.deepEqual(stats.get("app/file.ts"), { additions: 12, deletions: 3 });
  assert.deepEqual(stats.get("new name.txt"), { additions: 4, deletions: 2 });
  assert.equal(stats.has("old name.txt"), false);
  assert.deepEqual(stats.get("with\ttab\nand-newline.txt"), { additions: 1, deletions: 0 });
  assert.deepEqual(stats.get("image.png"), { additions: null, deletions: null });
  assert.deepEqual(stats.get("mode-only.sh"), { additions: 0, deletions: 0 });
});
