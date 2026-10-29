import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getSessionDisplayTitle, sessionTitleText } = await jiti.import("./session-display-title.ts");
const { selectionEnvelope } = await jiti.import("./plugin-selection.ts");
const plugin = { source: "https://example.test", capabilityId: "66", digest: "a".repeat(64), name: "销售助手" };
const skill = '<skill name="atlas-ask" location="/skills/atlas-ask/SKILL.md">\nReferences are relative to /skills/atlas-ask.\n\nRead these private skill instructions.\n</skill>';

test("removes selected-plugin metadata from a first-message title", () => {
  const message = selectionEnvelope("帮我查下昨日的天猫销售数据", [plugin], "plugin instructions");
  assert.equal(getSessionDisplayTitle({ firstMessage: message }, "新任务"), "帮我查下昨日的天猫销售数据");
});

test("cleans flattened and truncated metadata in existing names and previews", () => {
  const flattened = selectionEnvelope("查询销售数据", [plugin]).replace(/\n/g, " ");
  assert.equal(getSessionDisplayTitle({ name: flattened }, "新任务"), "查询销售数据");
  assert.equal(sessionTitleText('查询销售数据 <eureka-selected-plugins>{"plugins":[{"source":"https://'), "查询销售数据");
});

test("skill titles contain the arguments, without the command or expanded instructions", () => {
  assert.equal(sessionTitleText("/skill:atlas-ask 查询昨日销量"), "查询昨日销量");
  assert.equal(sessionTitleText(`${skill}\n\n查询昨日销量`), "查询昨日销量");
  assert.equal(sessionTitleText(selectionEnvelope(`${skill}\n\n查询昨日销量`, [plugin])), "查询昨日销量");
  assert.equal(sessionTitleText(`${skill}\n\n查询昨日销量`.replace(/\n/g, " ")), "查询昨日销量");
});

test("metadata-only and argument-free invocations use the supplied fallback", () => {
  for (const firstMessage of [skill, "/skill:atlas-ask", selectionEnvelope("", [plugin]), skill.slice(0, -8)]) {
    assert.equal(getSessionDisplayTitle({ firstMessage }, "新任务"), "新任务");
  }
});

test("preserves ordinary text, custom names and literal skill/plugin discussions", () => {
  assert.equal(sessionTitleText("讨论 skill 与插件的区别"), "讨论 skill 与插件的区别");
  assert.equal(sessionTitleText("/help"), "/help");
  assert.equal(getSessionDisplayTitle({ name: "自定义标题", firstMessage: "原始问题" }, "新任务", 3), "自定义标题");
});

test("truncates fallback text after removing metadata and normalizing whitespace", () => {
  assert.equal(getSessionDisplayTitle({ firstMessage: selectionEnvelope("查询\n昨日\t销量", [plugin]) }, "新任务", 5), "查询 昨日");
  assert.equal(getSessionDisplayTitle(null, "新任务"), "新任务");
  assert.equal(getSessionDisplayTitle({ name: selectionEnvelope("", [plugin]), firstMessage: "用户正文" }, "新任务"), "用户正文");
});
