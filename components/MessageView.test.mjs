import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView, ProcessBlockView, replaceUserMessageText, formatPlanCompletionMarkers } = await jiti.import("./MessageView.tsx");
const { observeThinkingEvent, rememberThinkingDuration } = await jiti.import("@/lib/thinking-timing");
const { observeThinkingPreviewEvent, rememberMessageThinkingPreviews } = await jiti.import("@/lib/thinking-preview-cache");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

function renderThinkingRecord(message, blockIndex, props = {}) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(ProcessBlockView, {
      reference: { block: message.content[blockIndex], blockIndex,
        source: { message, entryId: "thought-entry", completedAt: props.completedAt, isStreaming: props.isStreaming } },
      sessionId: props.sessionId,
    })));
}

test("reopened thinking uses original entry completion without a navigation tree timestamp", () => {
  const message = { role: "assistant", model: "test", timestamp: 1791875229811,
    generationCompletedAt: 1791875232152, content: [{ type: "thinking", thinking: "", deferred: true,
      preview: "Formulating query for shop and category metrics" }] };
  for (let reopen = 0; reopen < 2; reopen++) {
    const html = renderThinkingRecord(message, 0, { sessionId: "original-completion" });
    assert.match(html, /class="tool-activity-duration"[^>]*>~2s/);
    assert.match(html, /Formulating query for shop and category metrics/);
    assert.doesNotMatch(html, /Time not recorded/);
  }
});

test("thinking records display completed wording and the measured original block duration", () => {
  const message = { role: "assistant", model: "test", timestamp: 123,
    content: [{ type: "text", text: "phase" }, { type: "thinking", thinking: "private detail" }] };
  observeThinkingEvent("render-exact", 123, { type: "thinking_start", contentIndex: 1 }, 1000);
  observeThinkingEvent("render-exact", 123, { type: "thinking_end", contentIndex: 1 }, 6200);
  const html = renderThinkingRecord(message, 1, { sessionId: "render-exact", isStreaming: true });
  assert.match(html, /Thinking complete/);
  assert.match(html, /data-status="completed"/);
  assert.match(html, /class="tool-activity-duration">5s/);
  assert.doesNotMatch(html, /thinking-activity-content|task-phase-message-info/);
});

test("historical thinking duration is approximate and missing timing is explicit", () => {
  const message = { role: "assistant", model: "test", timestamp: 1000,
    content: [{ type: "thinking", thinking: "one" }] };
  const estimated = renderThinkingRecord(message, 0, { completedAt: 4900 });
  assert.match(estimated, /~4s/);
  assert.match(estimated, /class="tool-activity-duration"[^>]*data-slot="tooltip-trigger"/);
  assert.doesNotMatch(estimated, /title=/);
  const multi = renderThinkingRecord({ ...message, content: [...message.content, { type: "thinking", thinking: "two" }] }, 1, { completedAt: 4900 });
  assert.match(multi, /Time not recorded/);
  assert.doesNotMatch(multi, /~4s/);
});

test("remounted deferred thinking retains its summary and completed duration without loading full content", () => {
  const sessionId = "remounted-thought";
  const message = { role: "assistant", model: "test", timestamp: 1500,
    content: [{ type: "thinking", thinking: "**Querying 2025 platform category data**" }] };
  observeThinkingEvent(sessionId, 1500, { type: "thinking_start", contentIndex: 0 }, 1000);
  observeThinkingEvent(sessionId, 1500, { type: "thinking_end", contentIndex: 0 }, 8200);
  const first = renderThinkingRecord(message, 0, { sessionId });
  const remounted = renderThinkingRecord({ ...message, content: [{ type: "thinking", thinking: "", deferred: true,
    preview: "Querying 2025 platform category data" }] }, 0, { sessionId });
  for (const html of [first, remounted]) {
    assert.match(html, /tool-activity-duration">7s/);
    assert.match(html, /tool-activity-preview">Querying 2025 platform category data/);
    assert.match(html, /class="tool-activity-summary"[^>]*data-slot="tooltip-trigger"/);
    assert.doesNotMatch(html, /title=/);
    assert.doesNotMatch(html, /\*\*|Time not recorded|thinking-activity-content/);
  }
  rememberThinkingDuration("estimate-retained:1500:0", 4);
  assert.match(renderThinkingRecord(message, 0, { sessionId: "estimate-retained" }), /~4s/);
});

test("reopening a stage restores streamed summaries when history has no preview or contains an empty preview", () => {
  const sessionId = "fold-without-detail";
  observeThinkingPreviewEvent(sessionId, 2500, { type: "thinking_start", contentIndex: 0 });
  observeThinkingPreviewEvent(sessionId, 2500, { type: "thinking_delta", contentIndex: 0, delta: "**Formulating query for shop and category metrics**" });
  observeThinkingPreviewEvent(sessionId, 2500, { type: "thinking_end", contentIndex: 0, content: "**Formulating query for shop and category metrics**" });
  const message = { role: "assistant", model: "test", timestamp: 2500,
    content: [{ type: "thinking", thinking: "", deferred: true }] };
  const previousFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => { fetched = true; throw new Error("Summary must not load full thinking"); };
  try {
    for (const block of [message.content[0], { ...message.content[0], preview: "" }]) {
      const saved = { ...message, content: [block] };
      rememberMessageThinkingPreviews(sessionId, saved, "thought-entry");
      for (let reopen = 0; reopen < 2; reopen++) {
        const html = renderThinkingRecord(saved, 0, { sessionId });
        assert.match(html, /tool-activity-preview">Formulating query for shop and category metrics/);
        assert.match(html, /class="tool-activity-summary"[^>]*data-slot="tooltip-trigger"/);
        assert.doesNotMatch(html, /thinking-activity-content|\*\*/);
      }
    }
    assert.equal(fetched, false);
  } finally { globalThis.fetch = previousFetch; }
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

function renderTool(toolName, input, { result = true, isError = false, isStreaming = false, runningToolIds } = {}) {
  const toolCallId = "test-tool";
  return renderMessage({
    role: "assistant", provider: "test", model: "test", timestamp: 1000,
    content: [{ type: "toolCall", toolCallId, toolName, input }],
  }, {
    isStreaming,
    runningToolIds,
    toolResults: result ? new Map([[toolCallId, {
      role: "toolResult", toolCallId, content: [{ type: "text", text: "Detailed output stays collapsed" }], isError, timestamp: 2000,
    }]]) : new Map(),
  });
}

test("completed file tools render a compact summary with basename chips and library tooltip triggers", () => {
  for (const [tool, input, label] of [
    ["read", { path: "C:\\work\\deployment.md" }, "Read file"],
    ["edit", { path: "/work/deployment.md", oldText: "old", newText: "new" }, "Edit file"],
    ["write", { file_path: "/work/deployment.md", content: "hello" }, "Write file"],
  ]) {
    const html = renderTool(tool, input);
    assert.match(html, /class="tool-activity" data-status="completed"/);
    assert.match(html, /class="tool-activity-file"[^>]*>deployment\.md<\/span>/);
    assert.match(html, new RegExp(label));
    assert.match(html, /class="tool-activity-summary"[^>]*data-slot="tooltip-trigger"/);
    assert.doesNotMatch(html, /title=/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /class="tool-activity-duration">1s/);
    assert.doesNotMatch(html, /Detailed output stays collapsed|tool-activity-details|rgba\(34,197,94/);
  }
});

test("terminal and MCP summaries preserve their command or tool identity", () => {
  const command = "python -c 'print(1)' " + "argument ".repeat(30);
  const terminal = renderTool("bash", { command });
  assert.match(terminal, /Terminal command/);
  assert.ok(terminal.includes("argument ".repeat(30)));
  assert.match(terminal, /class="tool-activity-preview"/);
  const mcp = renderTool("plugin_site.prepare_site", { slug: "my-site" });
  assert.match(mcp, /Use tool/);
  assert.match(mcp, /plugin_site\.prepare_site · my-site/);
});

test("running, failed, and missing-result calls have distinct accessible statuses", () => {
  const running = renderTool("bash", { command: "npm test" }, { result: false, isStreaming: true });
  assert.match(running, /data-status="running"/);
  assert.match(running, /Running: /);
  const failed = renderTool("bash", { command: "npm test" }, { isError: true });
  assert.match(failed, /data-status="error"/);
  assert.match(failed, /Failed: /);
  const missing = renderTool("read", { path: "README.md" }, { result: false });
  assert.match(missing, /data-status="unknown"/);
  assert.match(missing, /No result yet: /);
  assert.doesNotMatch(missing, /data-status="completed"/);
});

test("execution events keep committed tool calls running after model streaming ends", () => {
  const running = renderTool("read", { path: "README.md" }, { result: false, runningToolIds: new Set(["test-tool"]) });
  assert.match(running, /data-status="running"/);
  const unrelated = renderTool("read", { path: "README.md" }, { result: false, runningToolIds: new Set(["other-tool"]) });
  assert.match(unrelated, /data-status="unknown"/);
  const completed = renderTool("read", { path: "README.md" }, { runningToolIds: new Set(["test-tool"]) });
  assert.match(completed, /data-status="completed"/);
});

test("user-run terminal commands use the same compact rows and statuses", () => {
  const completed = renderMessage({ role: "bashExecution", command: "pwd", output: "/work", exitCode: 0 });
  assert.match(completed, /data-status="completed"/);
  assert.match(completed, /Terminal command/);
  const running = renderMessage({ role: "bashExecution", command: "pwd", output: "" });
  assert.match(running, /data-status="running"/);
});

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("renders plan completion markers as checked numbered tasks without altering stored protocol text", () => {
  const source = "Completed work:\n- [DONE:1] Update the component\n- [DONE:12] Verify the result";
  const display = formatPlanCompletionMarkers(source);

  assert.equal(source.includes("[DONE:1]"), true);
  assert.equal(display, "Completed work:\n- [x] 1. Update the component\n- [x] 12. Verify the result");

  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: source }],
  });
  assert.match(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /1\. Update the component/);
  assert.doesNotMatch(html, /\[DONE:1\]|<del>/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});
