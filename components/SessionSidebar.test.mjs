import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the server session-list cache without a manual refresh control", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.doesNotMatch(source, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("offers an in-memory task search and sidebar hide callback", () => {
  assert.match(source, /onRequestHide\?: \(\) => void/);
  assert.match(source, /onClick=\{\(\) => onRequestHide\?\.\(\)\}/);
  assert.match(source, /const projectSessions = selectedProject/);
  assert.match(source, /const title = session\.name \|\| firstMessage \|\| session\.id/);
  assert.match(source, /title\.toLocaleLowerCase\(\)\.includes\(normalizedSessionSearch\)/);
  assert.match(source, /onKeyDown=\{\(e\) => \{ if \(e\.key === "Escape"\)/);
  assert.match(source, /sidebar\.noMatchingTasks/);
});

test("uses official dropdown menus for the project and worktree selectors", () => {
  assert.match(source, /<DropdownMenu open=\{dropdownOpen\} onOpenChange=\{handleProjectMenuOpenChange\}>/);
  assert.match(source, /<DropdownMenuContent\s+align="start"\s+side="bottom"/);
  assert.match(source, /<DropdownMenu open=\{wtDropdownOpen\} onOpenChange=\{handleWorktreeMenuOpenChange\}>/);
  assert.match(source, /<DropdownMenuContent\s+align="end"\s+side="bottom"/);
  assert.match(source, /const handleProjectMenuOpenChange = useCallback/);
  assert.match(source, /const handleWorktreeMenuOpenChange = useCallback/);
  assert.doesNotMatch(source, /AnimatedDropdown/);
  assert.doesNotMatch(source, /dropdownRef/);
  assert.doesNotMatch(source, /wtDropdownRef/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{!session\.transient && \(/);
  assert.match(sessionItemSource, /pointerEvents: metaHovered \|\| actionMenuOpen \? "auto" : "none"/);
  assert.match(sessionItemSource, /<DropdownMenuTrigger/);
  assert.match(sessionItemSource, /data-session-menu-trigger/);
  assert.match(sessionItemSource, /closest\("\[data-session-menu-trigger\]"\)/);
});
