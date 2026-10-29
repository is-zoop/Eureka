import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getGitRepositoryRoot, getGitWorkspace, mutateGit } = await jiti.import("./git-operations.ts");
const { getGitFileDiff, getGitStatus } = await jiti.import("./git-changes.ts");
const { appendGitIgnore, getGitFileSnapshot } = await jiti.import("./git-file-state.ts");
const execFileAsync = promisify(execFile);
async function git(cwd, ...args) {
  return (await execFileAsync("git", ["-C", cwd, ...args], { env: { ...process.env, LC_ALL: "C" } })).stdout.trim();
}

async function fixture(t, initial = true) {
  const tempParent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(tempParent, "eureka-git-test-"));
  t.after(async () => {
    // Verify the resolved cleanup target stays inside this test's temp directory.
    const target = await realpath(root);
    assert.equal(path.dirname(target).toLowerCase(), tempParent.toLowerCase());
    assert.ok(path.basename(target).startsWith("eureka-git-test-"));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const repo = path.join(root, "repo");
  await git(root, "init", "--initial-branch=main", repo);
  await git(repo, "config", "user.name", "Eureka Test");
  await git(repo, "config", "user.email", "test@example.invalid");
  await git(repo, "config", "commit.gpgsign", "false");
  await git(repo, "config", "core.autocrlf", "false");
  if (initial) {
    await writeFile(path.join(repo, "tracked.txt"), "initial\n");
    await git(repo, "add", "--", "tracked.txt");
    await git(repo, "commit", "-m", "initial");
  }
  return { root, repo };
}

async function mutate(repo, action, rest = {}) {
  const { revision } = await getGitWorkspace(repo);
  return mutateGit(repo, { action, revision, ...rest });
}

test("stage and unstage preserve file contents, including before the first commit", async (t) => {
  const { repo } = await fixture(t, false);
  assert.deepEqual((await getGitWorkspace(repo)).commits, []);
  await writeFile(path.join(repo, "new.txt"), "first version\n");
  await mutate(repo, "stage", { paths: ["new.txt"] });
  assert.equal((await getGitWorkspace(repo)).files[0].indexStatus, "A");
  await writeFile(path.join(repo, "new.txt"), "later version\n");
  await mutate(repo, "unstage", { paths: ["new.txt"] });
  assert.equal(await readFile(path.join(repo, "new.txt"), "utf8"), "later version\n");
  assert.equal((await getGitWorkspace(repo)).files[0].status, "untracked");
});

test("history returns subject, author, date and hash for the current HEAD in newest-first order", async (t) => {
  const { repo } = await fixture(t);
  await git(repo, "-c", "user.name=测试开发者", "commit", "--allow-empty", "-m", "feat: 中文提交说明\n\nDetails on a separate line.");
  const state = await getGitWorkspace(repo);
  assert.equal(state.commits.length, 2);
  assert.equal(state.commits[0].hash, state.head);
  assert.equal(state.commits[0].subject, "feat: 中文提交说明");
  assert.equal(state.commits[0].author, "测试开发者");
  assert.ok(Number.isFinite(Date.parse(state.commits[0].date)));
  assert.equal(state.commits[1].subject, "initial");
});

test("commit records exactly the staged version and leaves other changes alone", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "tracked.txt"), "selected\n");
  await writeFile(path.join(repo, "other.txt"), "do not commit\n");
  await mutate(repo, "stage", { paths: ["tracked.txt"] });
  await writeFile(path.join(repo, "tracked.txt"), "selected\nlater edit\n");
  const result = await mutate(repo, "commit", { message: "feat: selected changes", stageAllIfEmpty: true });
  assert.match(result.commit, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(repo, "show", "HEAD:tracked.txt"), "selected");
  assert.equal(await git(repo, "diff", "--name-only"), "tracked.txt");
  assert.match(await git(repo, "status", "--short"), /\?\? other.txt/);
});

test("staged and unstaged diffs show their own versions even when the working file is absent", async (t) => {
  const { repo } = await fixture(t);
  const filePath = path.join(repo, "tracked.txt");
  await writeFile(filePath, "staged content\n");
  await mutate(repo, "stage", { paths: ["tracked.txt"] });
  await writeFile(filePath, "staged content\nunselected content\n");
  const staged = await getGitFileDiff(repo, filePath, "staged");
  const unstaged = await getGitFileDiff(repo, filePath, "unstaged");
  assert.match(staged.patch, /\+staged content/);
  assert.doesNotMatch(staged.patch, /unselected content/);
  assert.match(unstaged.patch, /\+unselected content/);
  assert.doesNotMatch(unstaged.patch, /-initial/);
  await rm(filePath);
  assert.equal((await getGitFileDiff(repo, filePath, "staged")).supported, true);
  assert.equal((await getGitFileDiff(repo, filePath, "unstaged")).status, "deleted");
});

test("stale submissions and invalid paths do not mutate the index or create a commit", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "tracked.txt"), "updated\n");
  const stale = await getGitWorkspace(repo);
  await git(repo, "add", "--", "tracked.txt");
  await assert.rejects(mutateGit(repo, { action: "commit", revision: stale.revision, message: "stale" }), { code: "stale" });
  for (const selected of ["../outside.txt", ".", ":(glob)*", "missing.txt"]) {
    await assert.rejects(mutate(repo, "stage", { paths: [selected] }), { code: "invalidPaths" });
  }
  assert.equal(await git(repo, "log", "-1", "--format=%s"), "initial");
});

test("literal file names do not expand Git pathspecs", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "[one].txt"), "one\n");
  await writeFile(path.join(repo, "o.txt"), "other\n");
  await mutate(repo, "stage", { paths: ["[one].txt"] });
  assert.equal(await git(repo, "diff", "--cached", "--name-only"), "[one].txt");
});

test("canceling a staged rename restores only the index", async (t) => {
  const { repo } = await fixture(t);
  await rename(path.join(repo, "tracked.txt"), path.join(repo, "renamed.txt"));
  await git(repo, "add", "--all");
  assert.equal((await getGitWorkspace(repo)).files[0].status, "renamed");
  await mutate(repo, "unstage", { paths: ["renamed.txt"] });
  assert.equal(await git(repo, "diff", "--cached", "--name-only"), "");
  assert.equal(await readFile(path.join(repo, "renamed.txt"), "utf8"), "initial\n");
});

test("first commit and first push establish tracking; later pushes update only the current branch", async (t) => {
  const { root, repo } = await fixture(t, false);
  const remote = path.join(root, "remote.git");
  await git(root, "init", "--bare", remote);
  await git(repo, "remote", "add", "origin", remote);
  await writeFile(path.join(repo, "first.txt"), "first\n");
  await mutate(repo, "stage", { paths: ["first.txt"] });
  assert.equal((await getGitFileDiff(repo, path.join(repo, "first.txt"), "staged")).supported, true);
  await mutate(repo, "commit", { message: "first commit" });
  await mutate(repo, "push", { remote: "origin" });
  let state = await getGitWorkspace(repo);
  assert.equal(state.upstream, "origin/main");
  assert.equal(state.ahead, 0);
  await writeFile(path.join(repo, "first.txt"), "second\n");
  await mutate(repo, "stage", { paths: ["first.txt"] });
  await mutate(repo, "commit", { message: "second commit" });
  state = await getGitWorkspace(repo);
  assert.equal(state.ahead, 1);
  await mutate(repo, "push");
  assert.equal(await git(remote, "rev-parse", "refs/heads/main"), await git(repo, "rev-parse", "HEAD"));
});

test("linked worktree commits leave the main branch untouched", async (t) => {
  const { root, repo } = await fixture(t);
  const linked = path.join(root, "linked");
  const original = await git(repo, "rev-parse", "HEAD");
  await git(repo, "worktree", "add", "-b", "feature/panel", linked);
  await mkdir(path.join(linked, "sub"));
  assert.equal(await getGitRepositoryRoot(path.join(linked, "sub")), await realpath(linked));
  await writeFile(path.join(linked, "tracked.txt"), "worktree change\n");
  await mutate(linked, "stage", { paths: ["tracked.txt"] });
  await mutate(linked, "commit", { message: "worktree commit" });
  assert.equal((await getGitWorkspace(linked)).commits[0].subject, "worktree commit");
  assert.equal((await getGitWorkspace(repo)).commits[0].subject, "initial");
  assert.equal(await git(repo, "rev-parse", "HEAD"), original);
  assert.notEqual(await git(linked, "rev-parse", "HEAD"), original);
});

test("incoming and outgoing counts reflect fetched remote history, including diverged branches", async (t) => {
  const { root, repo } = await fixture(t);
  const remote = path.join(root, "counter-remote.git");
  const peer = path.join(root, "peer");
  await git(root, "init", "--bare", remote);
  await git(repo, "remote", "add", "origin", remote);
  await git(repo, "push", "--set-upstream", "origin", "main");
  await git(root, "clone", "--branch", "main", remote, peer);
  await git(peer, "config", "user.name", "Peer Test");
  await git(peer, "config", "user.email", "peer@example.invalid");
  await git(peer, "config", "commit.gpgsign", "false");
  await git(peer, "commit", "--allow-empty", "-m", "remote change");
  await git(peer, "push", "origin", "main");
  // Before fetch, comparisons intentionally use the locally known remote tip.
  assert.equal((await getGitWorkspace(repo)).behind, 0);
  await git(repo, "fetch", "origin");
  let state = await getGitWorkspace(repo);
  assert.equal(state.ahead, 0);
  assert.equal(state.behind, 1);
  await git(repo, "commit", "--allow-empty", "-m", "local change");
  state = await getGitWorkspace(repo);
  assert.equal(state.ahead, 1);
  assert.equal(state.behind, 1);
});

test("missing tracking refs are unknown rather than falsely reported as synchronized", async (t) => {
  const { root, repo } = await fixture(t);
  await git(repo, "remote", "add", "origin", path.join(root, "unavailable.git"));
  await git(repo, "config", "branch.main.remote", "origin");
  await git(repo, "config", "branch.main.merge", "refs/heads/missing");
  const state = await getGitWorkspace(repo);
  assert.equal(state.upstream, "origin/missing");
  assert.equal(state.ahead, null);
  assert.equal(state.behind, null);
});

test("failed push preserves the local commit, and detached HEAD blocks commit", async (t) => {
  const { root, repo } = await fixture(t);
  const head = await git(repo, "rev-parse", "HEAD");
  await git(repo, "remote", "add", "origin", path.join(root, "missing.git"));
  await assert.rejects(mutate(repo, "push", { remote: "origin" }), { code: "gitFailed" });
  assert.equal(await git(repo, "rev-parse", "HEAD"), head);
  await git(repo, "checkout", "--detach");
  await assert.rejects(mutate(repo, "commit", { message: "invalid" }), { code: "detached" });
});

test("automatic staging is opt-in and commits all non-ignored changes, including a first commit", async (t) => {
  const { repo } = await fixture(t, false);
  await writeFile(path.join(repo, ".gitignore"), "secret.txt\n");
  await writeFile(path.join(repo, "secret.txt"), "ignored\n");
  await writeFile(path.join(repo, "first.txt"), "first\n");
  await assert.rejects(mutate(repo, "commit", { message: "legacy" }), { code: "nothingStaged" });
  assert.equal(await git(repo, "diff", "--cached", "--name-only"), "");
  await mutate(repo, "commit", { message: "first automatic commit", stageAllIfEmpty: true });
  assert.equal(await git(repo, "ls-tree", "--name-only", "HEAD"), ".gitignore\nfirst.txt");
  assert.equal(await readFile(path.join(repo, "secret.txt"), "utf8"), "ignored\n");
  await writeFile(path.join(repo, "new.txt"), "new\n");
  await rm(path.join(repo, "first.txt"));
  await mutate(repo, "commit", { message: "add and delete", stageAllIfEmpty: true });
  assert.equal(await git(repo, "ls-tree", "--name-only", "HEAD"), ".gitignore\nnew.txt");
  await assert.rejects(mutate(repo, "commit", { message: "empty", stageAllIfEmpty: true }), { code: "nothingStaged" });
});

test("content edits and changes to the file list invalidate old submissions", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "tracked.txt"), "version one\n");
  const before = await getGitWorkspace(repo);
  await writeFile(path.join(repo, "tracked.txt"), "version two\n");
  await assert.rejects(mutateGit(repo, { action: "stage", revision: before.revision, paths: ["tracked.txt"] }), { code: "stale", status: 409 });
  const next = await getGitWorkspace(repo);
  assert.notEqual(next.revision, before.revision);
  await writeFile(path.join(repo, "new.txt"), "new\n");
  await assert.rejects(mutateGit(repo, { action: "commit", revision: next.revision, message: "old", stageAllIfEmpty: true }), { code: "stale", status: 409 });
  assert.equal(await git(repo, "diff", "--cached", "--name-only"), "");
});

test("discard restores only unstaged contents and requires a matching content digest", async (t) => {
  const { repo } = await fixture(t);
  const filePath = path.join(repo, "tracked.txt");
  await writeFile(filePath, "staged version\n");
  await mutate(repo, "stage", { paths: ["tracked.txt"] });
  await writeFile(filePath, "staged version\nlater edit\n");
  let state = await getGitWorkspace(repo);
  const stagedDiff = await git(repo, "diff", "--cached");
  assert.equal(state.files[0].canDiscard, true);
  await assert.rejects(mutateGit(repo, { action: "discard", paths: ["tracked.txt"], revision: state.revision, expectedContentHash: "wrong" }), { code: "stale", status: 409 });
  await mutateGit(repo, { action: "discard", paths: ["tracked.txt"], revision: state.revision, expectedContentHash: state.files[0].contentHash });
  assert.equal(await readFile(filePath, "utf8"), "staged version\n");
  assert.equal(await git(repo, "diff", "--cached"), stagedDiff);
  state = await getGitWorkspace(repo);
  assert.equal(state.files[0].canDiscard, false);
  await assert.rejects(mutate(repo, "discard", { paths: ["tracked.txt"], expectedContentHash: state.files[0].contentHash }), { code: "cannotDiscard" });
  await rm(filePath);
  state = await getGitWorkspace(repo);
  await mutateGit(repo, { action: "discard", paths: ["tracked.txt"], revision: state.revision, expectedContentHash: state.files[0].contentHash });
  assert.equal(await readFile(filePath, "utf8"), "staged version\n");
  assert.equal(await git(repo, "diff", "--cached"), stagedDiff);
  await writeFile(path.join(repo, "new.txt"), "keep me\n");
  await assert.rejects(mutate(repo, "discard", { paths: ["new.txt"], expectedContentHash: "irrelevant" }), { code: "cannotDiscard" });
  assert.equal(await readFile(path.join(repo, "new.txt"), "utf8"), "keep me\n");
});

test("discard refuses the stale file originally shown in its confirmation dialog", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "tracked.txt"), "before confirmation\n");
  const state = await getGitWorkspace(repo);
  await writeFile(path.join(repo, "tracked.txt"), "after confirmation\n");
  await assert.rejects(mutateGit(repo, { action: "discard", revision: state.revision, paths: ["tracked.txt"], expectedContentHash: state.files[0].contentHash }), { code: "stale", status: 409 });
  assert.equal(await readFile(path.join(repo, "tracked.txt"), "utf8"), "after confirmation\n");
});

test("ignore appends an exact escaped rule preserving BOM, CRLF and existing bytes, without staging", async (t) => {
  const { repo } = await fixture(t);
  const original = "\uFEFF# existing rules\r\nkeep.txt";
  await writeFile(path.join(repo, ".gitignore"), original);
  await mkdir(path.join(repo, "nested"));
  const relativePath = "nested/a[1] #!.txt";
  await writeFile(path.join(repo, relativePath), "untracked\n");
  await mutate(repo, "ignore", { paths: [relativePath] });
  assert.equal(await readFile(path.join(repo, ".gitignore"), "utf8"), original + "\r\n/nested/a\\[1\\]\\ \\#\\!.txt\r\n");
  assert.equal(await git(repo, "check-ignore", "--", relativePath), relativePath);
  await assert.rejects(git(repo, "check-ignore", "--", "nested/a1 #!.txt"));
  assert.equal(await git(repo, "diff", "--cached", "--name-only"), "");
  assert.ok(!(await getGitWorkspace(repo)).files.some((file) => file.relativePath === relativePath));
});

test("ignore escapes wildcard rules, skips duplicates and rejects tracked files and itself", async (t) => {
  const { repo } = await fixture(t);
  await appendGitIgnore(repo, "literal*?.txt", await getGitFileSnapshot(repo, ".gitignore"));
  assert.equal(await readFile(path.join(repo, ".gitignore"), "utf8"), "/literal\\*\\?.txt\n");
  assert.equal(await git(repo, "check-ignore", "--", "literal*?.txt"), "literal*?.txt");
  await assert.rejects(git(repo, "check-ignore", "--", "literalAB.txt"));
  const original = "/duplicate.txt\n!/duplicate.txt\n";
  await writeFile(path.join(repo, ".gitignore"), original);
  await writeFile(path.join(repo, "duplicate.txt"), "untracked via negation\n");
  await mutate(repo, "ignore", { paths: ["duplicate.txt"] });
  assert.equal(await readFile(path.join(repo, ".gitignore"), "utf8"), original);
  await writeFile(path.join(repo, "tracked.txt"), "modified\n");
  await assert.rejects(mutate(repo, "ignore", { paths: ["tracked.txt"] }), { code: "cannotIgnore" });
  await assert.rejects(mutate(repo, "ignore", { paths: [".gitignore"] }), { code: "cannotIgnore" });
  for (const relativePath of ["../outside", ".", ":(glob)*"]) {
    await assert.rejects(mutate(repo, "ignore", { paths: [relativePath] }), { code: "stale" });
  }
});

test("an externally edited ignore file invalidates a pending operation", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "new.txt"), "new\n");
  const state = await getGitWorkspace(repo);
  await writeFile(path.join(repo, ".gitignore"), "# external edit\n");
  await assert.rejects(mutateGit(repo, { action: "ignore", paths: ["new.txt"], revision: state.revision }), { code: "stale", status: 409 });
  assert.equal(await readFile(path.join(repo, ".gitignore"), "utf8"), "# external edit\n");
});

test("directory junctions cannot expose outside contents or be used to discard outside files", async (t) => {
  const { root, repo } = await fixture(t);
  const inside = path.join(repo, "nested");
  const outside = path.join(root, "outside");
  await mkdir(inside);
  await writeFile(path.join(inside, "file.txt"), "tracked\n");
  await git(repo, "add", "--", "nested/file.txt");
  await git(repo, "commit", "-m", "tracked directory");
  await rename(inside, outside);
  await writeFile(path.join(outside, "file.txt"), "outside contents\n");
  try { await symlink(outside, inside, process.platform === "win32" ? "junction" : "dir"); } catch (error) {
    if (error.code === "EPERM") { t.skip("Directory links are unavailable for this account"); return; }
    throw error;
  }
  const state = await getGitWorkspace(repo);
  const file = state.files.find((file) => file.relativePath === "nested/file.txt");
  assert.ok(file);
  assert.equal(file.contentHash, null);
  assert.equal(file.canDiscard, false);
  assert.equal(file.canStage, false);
  await assert.rejects(mutate(repo, "discard", { paths: [file.relativePath], expectedContentHash: "invalid" }), { code: "cannotDiscard" });
  await assert.rejects(mutate(repo, "stage", { paths: [file.relativePath] }), { code: "invalidPaths" });
  assert.equal(await readFile(path.join(outside, "file.txt"), "utf8"), "outside contents\n");
});

test("failed commit keeps the index and message retryable; a later failed push preserves the new commit", async (t) => {
  const { root, repo } = await fixture(t);
  await writeFile(path.join(repo, "tracked.txt"), "change\n");
  const hook = path.join(repo, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\necho 'test rejection' >&2\nexit 1\n");
  await chmod(hook, 0o755);
  await assert.rejects(mutate(repo, "commit", { message: "retry message", stageAllIfEmpty: true }), { code: "gitFailed" });
  assert.equal(await git(repo, "log", "-1", "--format=%s"), "initial");
  assert.equal(await git(repo, "diff", "--cached", "--name-only"), "tracked.txt");
  await rm(hook);
  const result = await mutate(repo, "commit", { message: "retry message", stageAllIfEmpty: true });
  await git(repo, "remote", "add", "origin", path.join(root, "missing.git"));
  await assert.rejects(mutate(repo, "push", { remote: "origin" }), { code: "gitFailed" });
  assert.equal(await git(repo, "rev-parse", "HEAD"), result.commit);
});

test("conflicts and in-progress merges block automatic commit and discard", async (t) => {
  const { repo } = await fixture(t);
  await git(repo, "checkout", "-b", "other");
  await writeFile(path.join(repo, "tracked.txt"), "other\n");
  await git(repo, "add", "tracked.txt");
  await git(repo, "commit", "-m", "other");
  await git(repo, "checkout", "main");
  await writeFile(path.join(repo, "tracked.txt"), "main\n");
  await git(repo, "add", "tracked.txt");
  await git(repo, "commit", "-m", "main");
  await assert.rejects(git(repo, "merge", "other"));
  const state = await getGitWorkspace(repo);
  assert.equal(state.operationInProgress, true);
  assert.equal(state.files[0].status, "conflict");
  assert.equal(state.files[0].canDiscard, false);
  await assert.rejects(mutate(repo, "commit", { message: "blocked", stageAllIfEmpty: true }), { code: "inProgress" });
  await assert.rejects(mutate(repo, "discard", { paths: ["tracked.txt"], expectedContentHash: state.files[0].contentHash }), { code: "inProgress" });
});

test("simultaneous writes share the worktree lock and reject duplicate execution", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "tracked.txt"), "modified\n");
  const { revision } = await getGitWorkspace(repo);
  const requests = await Promise.allSettled([
    mutateGit(repo, { action: "stage", paths: ["tracked.txt"], revision }),
    mutateGit(repo, { action: "stage", paths: ["tracked.txt"], revision }),
  ]);
  assert.equal(requests.filter((request) => request.status === "fulfilled").length, 1);
  const rejected = requests.find((request) => request.status === "rejected");
  assert.equal(rejected.reason.code, "busy");
  assert.equal(rejected.reason.status, 409);
});

test("file change counts match the total HEAD diff, including partially staged, renamed, deleted and binary files", async (t) => {
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, "deleted.txt"), "one\ntwo\nthree\n");
  await writeFile(path.join(repo, "old name.txt"), "a\nb\nc\nd\ne\nf\n");
  await writeFile(path.join(repo, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  await git(repo, "add", "--all");
  await git(repo, "commit", "-m", "prepare file counts");
  await writeFile(path.join(repo, "tracked.txt"), "staged\n");
  await git(repo, "add", "tracked.txt");
  await writeFile(path.join(repo, "tracked.txt"), "final\nextra\n");
  await writeFile(path.join(repo, "new.txt"), "one\ntwo");
  await writeFile(path.join(repo, "empty.txt"), "");
  await rm(path.join(repo, "deleted.txt"));
  await rename(path.join(repo, "old name.txt"), path.join(repo, "renamed 文件.txt"));
  await git(repo, "add", "--", "old name.txt", "renamed 文件.txt");
  await writeFile(path.join(repo, "renamed 文件.txt"), "a\nb\nc\nd\ne\nf\nnew\n");
  await writeFile(path.join(repo, "binary.bin"), Buffer.from([0, 9, 8, 7]));
  const status = await getGitStatus(repo);
  const find = (name) => status.files.find((file) => path.basename(file.filePath) === name);
  assert.equal(find("tracked.txt").additions, 2);
  assert.equal(find("tracked.txt").deletions, 1);
  assert.equal(find("deleted.txt").additions, 0);
  assert.equal(find("deleted.txt").deletions, 3);
  assert.equal(find("new.txt").additions, 2);
  assert.equal(find("empty.txt").additions, 0);
  assert.equal(find("renamed 文件.txt").additions, 1);
  assert.equal(find("renamed 文件.txt").deletions, 0);
  assert.equal(find("binary.bin").additions, null);
  assert.equal(find("binary.bin").deletions, null);
  assert.equal(status.additions, 5);
  assert.equal(status.deletions, 4);
  await writeFile(path.join(repo, "renamed 文件.txt"), "replacement\nentirely different\n");
  const rewritten = await getGitStatus(repo);
  const renamed = rewritten.files.find((file) => path.basename(file.filePath) === "renamed 文件.txt");
  assert.equal(renamed.additions, 2);
  assert.equal(renamed.deletions, 6);
  assert.equal(rewritten.additions, 6);
  assert.equal(rewritten.deletions, 10);
});

test("first-commit and subdirectory lists count only the visible files", async (t) => {
  const { repo } = await fixture(t, false);
  await mkdir(path.join(repo, "nested"));
  await writeFile(path.join(repo, "nested", "first.txt"), "first\n");
  await git(repo, "add", "--", "nested/first.txt");
  await writeFile(path.join(repo, "nested", "first.txt"), "first\nsecond\n");
  await writeFile(path.join(repo, "outside.txt"), "outside\n");
  let status = await getGitStatus(path.join(repo, "nested"));
  assert.equal(status.files.length, 1);
  assert.equal(status.files[0].additions, 2);
  assert.equal(status.files[0].deletions, 0);
  assert.equal(status.additions, 2);
  await git(repo, "add", "--all");
  await git(repo, "commit", "-m", "first");
  await writeFile(path.join(repo, "nested", "first.txt"), "replacement\n");
  await writeFile(path.join(repo, "outside.txt"), "changed outside\nextra\n");
  status = await getGitStatus(path.join(repo, "nested"));
  assert.equal(status.files.length, 1);
  assert.equal(status.files[0].additions, 1);
  assert.equal(status.files[0].deletions, 2);
  assert.equal(status.additions, 1);
  assert.equal(status.deletions, 2);
});
