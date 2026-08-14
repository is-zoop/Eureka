# Pi SDK event mapping record

`npm run spike` is the source of truth for this document's next revision. It writes the observed runtime event shape to `reports/pi-event-shape.json`; the report intentionally stores only event names and field names, never prompt content, tool output, or credentials.

Use `npm run spike:dry-run` to validate local Runtime creation, Session replacement, and subscription reattachment without sending workspace content to a model provider. It deliberately does not validate streaming, tools, or abort.

## Verified integration boundary

- The service creates `AgentSessionRuntime` with `createAgentSessionRuntime()`.
- The active `AgentSession` is the sole event source through `session.subscribe()`.
- After `runtime.newSession()`, the old subscription is disposed and a new subscription is attached to `runtime.session`.
- The future WebSocket adapter must consume the report, not expose raw Pi events to the browser.

## Observed against the configured local Provider (2026-08-11)

The live runs emitted `agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `turn_end`, `agent_end`, and `agent_settled`.

| Pi event | Observed fields relevant to the adapter |
| --- | --- |
| `message_update` | `assistantMessageEvent.type`, `delta`, `content`, `contentIndex`, `partial`, `toolCall`; plus the evolving `message` |
| `tool_execution_start` | `toolCallId`, `toolName`, `args` |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, `partialResult` |
| `tool_execution_end` | `toolCallId`, `toolName`, `isError`, `result` |
| `message_start` / `message_end` | `message` with `role`, `content`, provider/model metadata, usage, error state, and tool identifiers when applicable |
| `agent_end` | `messages`, `willRetry` |

The abort run requested `session.abort()` while thinking deltas were still arriving, then emitted `agent_end` followed by `agent_settled`. The recorded assertions for runtime creation, prompt event delivery, session replacement, subscription reattachment, abort request, and abort settlement all passed.

## Expected event families to observe

| Pi event | Web concern |
| --- | --- |
| `message_update` with `text_delta` | Incremental assistant text |
| `message_update` with `thinking_delta` | Collapsed thinking item |
| `tool_execution_start` / `update` / `end` | Tool timeline card and streamed output |
| `agent_start` / `agent_end` | Agent phase |
| `compaction_*`, `auto_retry_*` | System status |

Thinking and tool-output events depend on the selected provider/model and prompt. The JSON report captures what the configured local account actually emits and is the input to Milestone 2's `PiEventNormalizer` contract.
