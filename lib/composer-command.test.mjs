import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { composerCommandLabel, parseComposerCommand, restoreComposerCommand } = await jiti.import("./composer-command.ts");
const drafts = await jiti.import("./draft-store.ts");

test("command display names omit invocation syntax without changing identities", () => {
  for (const [name, label] of [["skill:atlas-ask", "atlas-ask"], ["/skill:atlas-menu", "atlas-menu"], ["mcp", "mcp"], ["/mcp-auth", "mcp-auth"], ["/reload", "reload"]]) {
    assert.equal(composerCommandLabel(name), label);
  }
});

test("completed command chips preserve the exact invocation and multiline Chinese arguments", () => {
  for (const value of ["/skill:atlas-ask ", "/skill:atlas-ask 查询昨日销售额", "/skill:atlas-ask\n查询昨日\n销售额", "/skill:atlas-ask\r\n  保留缩进", "/mcp status"]) {
    const command = parseComposerCommand(value, ["mcp"]);
    assert.ok(command);
    assert.equal(command.prefix + command.arguments, value);
  }
  const command = parseComposerCommand("/skill:atlas-ask 查询");
  assert.equal(command.label, "atlas-ask");
  assert.equal(command.name, "skill:atlas-ask");
  assert.equal(command.arguments, "查询");
  assert.equal(command.prefix + "补充中文请求\n第二行", "/skill:atlas-ask 补充中文请求\n第二行");
});

test("incomplete commands, paths and ordinary text stay editable instead of becoming chips", () => {
  for (const value of ["/skill:atlas-ask", "/skill:atlas-", "/tmp/file text", "普通文本 /skill:atlas-ask 请求", "!/skill:atlas-ask 请求", "/unknown text"])
    assert.equal(parseComposerCommand(value), null);
  assert.equal(parseComposerCommand("/reload ", ["reload"]).name, "reload");
});

test("command-only failures and history recover as chips without changing the submitted invocation", () => {
  for (const command of ["/skill:atlas-ask", "/reload"]) {
    const restored = restoreComposerCommand(command, ["reload"]);
    assert.equal(restored.trim(), command);
    assert.equal(parseComposerCommand(restored, ["reload"]).arguments, "");
  }
  assert.equal(restoreComposerCommand("普通请求"), "普通请求");
  drafts.setDraft("command-chip", { value: "/skill:atlas-ask 查询", images: [], references: [{ path: "/project/report.txt", isDir: false }] });
  const restored = drafts.getDraft("command-chip");
  assert.equal(parseComposerCommand(restored.value).arguments, "查询");
  assert.equal(restored.value.trim(), "/skill:atlas-ask 查询");
  assert.equal(restored.references[0].path, "/project/report.txt");
  drafts.clearDraft("command-chip");
});
