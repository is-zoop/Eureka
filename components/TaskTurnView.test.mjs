import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { TaskTurnView, phaseExpanded } = await jiti.import("./TaskTurnView.tsx");
const { buildTaskPhases } = await jiti.import("@/lib/task-phases");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const sources = [
  { messageIndex: 1, entryId: "original-entry", message: { role: "assistant", provider: "test", model: "test", content: [
    { type: "text", text: "Inspect the project." }, { type: "thinking", thinking: "Look at the project config." },
    { type: "toolCall", toolCallId: "a", toolName: "read", input: { path: "deployment.md" } },
  ] } },
];
const toolResults = new Map([["a", { role: "toolResult", toolCallId: "a", content: [], timestamp: 2000 }]]);
const render = (turn, props = {}) => renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(TaskTurnView, { turn, toolResults, ...props })));

test("a pre-compaction continuation is folded and shares its logical user turn without a false unfinished notice", () => {
  const html = render(buildTaskPhases(sources, { running: false, toolResults }), { continuation: true, archived: true, turnId: "original-user" });
  assert.match(html, /data-turn-id="original-user"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Process details/);
  assert.doesNotMatch(html, /class="task-turn-status"/);
  assert.doesNotMatch(html, /Look at the project config/);
});

test("current stages show commentary, counts, compact thinking and tool rows", () => {
  const html = render(buildTaskPhases(sources, { running: true, toolResults }));
  assert.match(html, /Inspect the project\./);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /1 tool calls/);
  assert.match(html, /1 thinking blocks/);
  assert.match(html, /thinking-activity/);
  assert.match(html, /Read file/);
  assert.doesNotMatch(html, /Message information|task-phase-message-info/);
  assert.doesNotMatch(html, /Process details/);
});

test("long process lists retain every record inside a bounded scroll region", () => {
  const content = [{ type: "thinking", thinking: "Reviewing the task" }, ...Array.from({ length: 35 }, (_, index) => ({
    type: "toolCall", toolCallId: `call-${index}`, toolName: "read", input: { path: `step-${index}.ts` },
  }))];
  const turn = buildTaskPhases([{ messageIndex: 1, message: { role: "assistant", content } }], { running: true, toolResults: new Map() });
  const html = render(turn, { toolResults: new Map() });
  assert.match(html, /class="task-process-list" role="region" tabindex="0"/);
  assert.match(html, /aria-label="Tool calls and thinking"/);
  assert.match(html, /data-running="true" data-visible-rows="12"/);
  assert.match(html, /step-0\.ts/);
  assert.match(html, /step-34\.ts/);
  assert.equal((html.match(/class="tool-activity(?: thinking-activity)?"/g) ?? []).length, 36);
});

test("unfinished history is scrollable without being treated as a live list", () => {
  const html = render(buildTaskPhases(sources, { running: false, toolResults }));
  assert.match(html, /data-running="false" data-visible-rows="12"/);
});

test("success folds all commentary and steps beneath processing details", () => {
  const final = { messageIndex: 3, message: { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "Done." }] } };
  const turn = buildTaskPhases([...sources, final], { running: false, toolResults });
  const html = render(turn);
  assert.match(html, /Process details/);
  assert.match(html, /1 stages/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Inspect the project|Read file|thinking-activity/);
  assert.equal(turn.answerSource, final);
});

test("unfinished runs keep their last stage available", () => {
  const html = render(buildTaskPhases(sources, { running: false, toolResults }));
  assert.match(html, /Not completed/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Read file/);
});

test("manual overrides apply within a state and reset on stage completion", () => {
  assert.equal(phaseExpanded("running"), true);
  assert.equal(phaseExpanded("completed"), false);
  assert.equal(phaseExpanded("running", { status: "running", expanded: false }), false);
  assert.equal(phaseExpanded("completed", { status: "running", expanded: true }), false);
  assert.equal(phaseExpanded("completed", { status: "completed", expanded: true }), true);
  for (const status of ["failed", "stopped", "incomplete"]) assert.equal(phaseExpanded(status), true);
});

test("initial and between-tool model waits keep the original pixel animation visible", () => {
  for (const turn of [buildTaskPhases([], { running: true }), buildTaskPhases(sources, { running: true, toolResults })]) {
    const html = render(turn, { agentPhase: { kind: "waiting_model" } });
    assert.match(html, /Waiting for model/);
    assert.match(html, /agent-activity-indicator/);
    assert.match(html, /class="task-phase-leading"/);
    assert.match(html, /class="task-phase-status-text">Waiting for model/);
    assert.doesNotMatch(html, /agent-activity-label/);
    assert.equal((html.match(/<i><\/i>/g) ?? []).length, 9);
  }
});

test("live thinking uses its spiral only in the thinking row while the heading stays generic", () => {
  const streaming = { ...sources[0], isStreaming: true, message: { ...sources[0].message, content: [{ type: "thinking", thinking: "Check the config" }] } };
  const html = render(buildTaskPhases([streaming], { running: true }), { agentPhase: null });
  assert.match(html, /tool-activity-label">Thinking</);
  assert.equal((html.match(/class="thinking-activity-indicator"/g) ?? []).length, 1);
  const heading = html.match(/<button[^>]*class="task-phase-toggle"[\s\S]*?<\/button>/)[0];
  assert.match(heading, /In progress/);
  assert.doesNotMatch(heading, /Thinking|thinking-activity-indicator/);
  assert.match(html, /thinking-activity" data-status="running"/);
});

test("parallel tools animate their individual rows with generic status and separate counts in the heading", () => {
  const liveSources = [{ ...sources[0], message: { ...sources[0].message, content: [
    ...sources[0].message.content, { type: "toolCall", toolCallId: "b", toolName: "bash", input: { command: "npm test" } },
  ] } }];
  const runningToolIds = new Set(["a", "b"]);
  const turn = buildTaskPhases(liveSources, { running: true, runningToolIds, toolResults: new Map() });
  const html = render(turn, { toolResults: new Map(), runningToolIds, agentPhase: { kind: "running_tools", tools: [{ id: "a", name: "read" }, { id: "b", name: "bash" }] } });
  const heading = html.match(/<button[^>]*class="task-phase-toggle"[\s\S]*?<\/button>/)[0];
  assert.match(heading, /task-phase-status">In progress/);
  assert.match(heading, /task-phase-count">· 2 tool calls/);
  assert.match(heading, /task-phase-count">· 1 thinking blocks/);
  assert.doesNotMatch(heading, /Running read|bash|agent-activity-indicator/);
  assert.equal((html.match(/class="agent-activity-indicator"/g) ?? []).length, 2);
  assert.equal((html.match(/class="tool-activity" data-status="running"/g) ?? []).length, 2);
});

test("a streaming reply completes and collapses the previous process stage without settling the logical run", () => {
  const final = { messageIndex: 3, isStreaming: true, message: { role: "assistant", provider: "test", model: "test", content: [
    { type: "thinking", thinking: "Prepare the final summary." }, { type: "text", text: "The result is ready." },
  ] } };
  const turn = buildTaskPhases([...sources, final], { running: true, toolResults });
  const html = render(turn, { agentPhase: { kind: "waiting_model" } });
  assert.equal(turn.status, "running");
  assert.match(html, /Completed/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /thinking-activity|Prepare the final summary|The result is ready|Waiting for model/);
  assert.equal(turn.answerSource, final);
});

test("settled history does not replay model or tool activity", () => {
  const final = { messageIndex: 3, message: { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "Done." }] } };
  const html = render(buildTaskPhases([...sources, final], { running: false, toolResults }), { agentPhase: { kind: "waiting_model" } });
  assert.doesNotMatch(html, /agent-activity-indicator|thinking-activity-indicator|Waiting for model/);
});
