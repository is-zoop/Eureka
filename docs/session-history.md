# Session history and compaction

Chat history and model context are separate projections of the same JSONL
branch. The SDK's compaction-aware context remains the only context used by
the agent and context-usage inspector. Browsing old messages never restores
them to the agent or rewrites the session file.

## Reading history

- `GET /api/sessions/[id]?includeHistory=1` adds the newest history page to the
  existing response. Its context and history share the captured entries/leaf.
- `GET /api/sessions/[id]/context?leafId=…&includeHistory=1` selects a branch and
  returns its context and history together.
- `GET /api/sessions/[id]/history?leafId=…&before=…` reads an earlier page of ten
  complete user turns. A cursor outside the selected branch returns 409.

History items carry entry IDs, original UI messages, and a read-only flag for
records preceding the latest compaction on that branch. The small ancestry
index and covered entry ranges let the client retain loaded pages, reject
sibling-branch data, and fill gaps after a reconnect. Pagination bounds message
transmission/rendering; the SDK still parses the session file when opening a
dormant session. Existing live managers are reused without starting an agent.

## Presentation and reconciliation

`useSessionHistory` owns persisted display pages separately from the runtime
message list. Optimistic/SSE messages form a temporary tail until a shared
snapshot replaces them. Session/branch generations and request ordering reject
late snapshots; snapshots racing new messages retry rather than overwriting
the live tail. Keys use entry IDs or temporary object IDs, never message text.

Compaction entries remain at their recorded positions, split display segments
of the same logical user turn, and render as collapsed separators. Markdown
and file details mount on expansion inside a 320px scrolling panel. Archived
messages retain viewing/copying but do not expose edit/fork actions. Loading
older records restores the viewport before paint; context usage and model
selection continue to derive from the runtime context.

## Checks

Run the history reader/merge tests, session route tests, context-usage tests,
message/turn rendering tests and hook regressions. In the browser, inspect a
multi-compaction session, load earlier pages, check archived controls, toggle
the separator by pointer and keyboard, and confirm its panel stays bounded.
Do not send prompts or trigger compaction in an existing user session merely
to test historical rendering.
