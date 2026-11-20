import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildSessionCompletion, hasSessionCompletionListeners, publishSessionCompletion } = await jiti.import("../../features/sessions/server/session-completions.ts");
const { GET } = await jiti.import("../../app/api/agent/running/events/route.ts");

const user = { type: "message", message: { role: "user", content: "项目报告" } };
const assistant = (text, stopReason = "stop") => ({
  type: "message",
  message: { role: "assistant", stopReason, content: [{ type: "thinking", thinking: "private" }, { type: "text", text }] },
});

test("desktop completion uses the final reply and excludes tools, thinking and code", () => {
  const entries = [
    user, assistant("previous reply"), assistant("准备运行", "toolUse"),
    { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "private tool output" }] } },
    assistant("## **已完成**\n\n```sh\nprivate code\n```\n整理了 [报告](http://example.com)。"),
  ];
  assert.deepEqual(buildSessionCompletion(entries, 2), { title: "项目报告", summary: "已完成 整理了 报告。" });

  const capped = buildSessionCompletion([user, assistant("😀".repeat(201))], 1, "正式项目");
  assert.equal(capped.title, "正式项目");
  assert.equal(capped.summary, "😀".repeat(199) + "…");
});

test("an unsuccessful or empty run never reuses a previous successful reply", () => {
  const previous = [user, assistant("previous reply")];
  assert.equal(buildSessionCompletion(previous, previous.length), null);
  for (const reason of ["error", "aborted", "length", "toolUse"]) {
    assert.equal(buildSessionCompletion([...previous, assistant("incomplete", reason)], 1), null);
  }
});

test("the shared stream delivers completion frames without changing running snapshots", async () => {
  const response = await GET(new Request("http://localhost/api/agent/running/events"));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    assert.match(decoder.decode((await reader.read()).value), /^data: {"type":"running"/);
    assert.equal(hasSessionCompletionListeners(), true);
    const completion = { sessionId: "a9bbef30-40fe-4b88-b196-a56c83e54081", title: "项目报告", summary: "已完成" };
    publishSessionCompletion(completion);
    assert.equal(decoder.decode((await reader.read()).value), `event: completion\ndata: ${JSON.stringify(completion)}\n\n`);
  } finally {
    await reader.cancel();
  }
  assert.equal(hasSessionCompletionListeners(), false);
});
