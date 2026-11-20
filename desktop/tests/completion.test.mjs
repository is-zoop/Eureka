import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../ui/completion.js", import.meta.url), "utf8");
const notification = {
  title: "项目报告", summary: "<b>literal text</b>", closeLabel: "关闭", locale: "zh-CN",
  replyPlaceholder: "快速回复…", sendLabel: "发送", sendingLabel: "正在发送…", sentLabel: "回复已发送。",
  failureLabel: "发送失败", unconfirmedLabel: "暂时无法确认发送结果",
};

async function setup(reply = async () => true, dismiss = async () => {}) {
  const calls = [];
  const elements = Object.fromEntries(["card", "task-title", "summary", "dismiss", "reply-form", "reply", "send", "reply-status"].map((id) => [
    id, { value: "", dataset: {}, hidden: true, addEventListener(event, handler) { this[event] = handler; }, setAttribute(key, value) { this[key] = value; } },
  ]));
  let render;
  const documentElement = { classList: { toggle(key, value) { documentElement[key] = value; } } };
  runInNewContext(source, {
    console,
    document: { getElementById: (id) => elements[id], documentElement },
    window: { __TAURI__: {
      event: { async listen(name, handler) { calls.push(name); render = handler; } },
      core: { async invoke(command, args) {
        calls.push({ command, ...args });
        if (command === "desktop_completion_reply") return reply();
        if (command === "desktop_completion_dismiss") return dismiss();
      } },
    } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["desktop-completion-card", { command: "desktop_completion_ready" }]);
  return { calls, elements, documentElement, show: (id) => render({ payload: { id, dark: true, notification } }) };
}

test("a desktop card shows the title and plain-text summary and closes on request", async () => {
  const { calls, elements, documentElement, show } = await setup();
  show(7);
  assert.equal(elements.card.hidden, false);
  assert.equal(elements["task-title"].textContent, "项目报告");
  assert.equal(elements.summary.textContent, "<b>literal text</b>");
  assert.equal(documentElement.dark, true);
  assert.equal(elements.dismiss["aria-label"], "关闭");
  assert.equal(elements.reply["aria-label"], "快速回复…");
  assert.equal(elements.send.disabled, true);
  elements.dismiss.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), { command: "desktop_completion_dismiss", id: 7 });
  assert.equal(elements.card.hidden, true);
});

test("a quick reply submits once and dismisses the card after confirmation", async () => {
  let accept;
  const { calls, elements, show } = await setup(() => new Promise((resolve) => { accept = resolve; }));
  show(7);
  elements.reply.value = "  补充结论  ";
  elements.reply.input();
  assert.equal(elements.send.disabled, false);
  let composingEnterPrevented = false;
  elements.reply.keydown({ key: "Enter", isComposing: true, preventDefault() { composingEnterPrevented = true; } });
  assert.equal(composingEnterPrevented, true);

  const form = elements["reply-form"];
  const submit = form.submit({ preventDefault() {} });
  await form.submit({ preventDefault() {} });
  assert.equal(elements["reply-status"].textContent, "正在发送…");
  assert.equal(elements.reply.readOnly, true);
  assert.deepEqual(calls.slice(2), [{ command: "desktop_completion_reply", id: 7, message: "补充结论" }]);
  accept(true);
  await submit;
  assert.deepEqual(calls.at(-1), { command: "desktop_completion_dismiss", id: 7 });
  assert.equal(elements.card.hidden, true);
  assert.equal(elements.reply.value, "");
});

test("closing after a successful reply leaves the next queued card visible", async () => {
  const { elements, show } = await setup(undefined, () => show(8));
  show(7);
  elements.reply.value = "补充结论";
  await elements["reply-form"].submit({ preventDefault() {} });
  assert.equal(elements.card.hidden, false);
  assert.equal(elements.reply.value, "");
  assert.equal(elements["reply-status"].textContent, "");
});

test("failed or unconfirmed replies retain the draft and stale results cannot update the next card", async () => {
  let resolveReply;
  const { calls, elements, show } = await setup(() => new Promise((resolve) => { resolveReply = resolve; }));
  const form = elements["reply-form"];
  show(7);
  elements.reply.value = "草稿";
  const failed = form.submit({ preventDefault() {} });
  resolveReply(false);
  await failed;
  assert.equal(elements.reply.value, "草稿");
  assert.equal(elements["reply-status"].textContent, "发送失败");
  assert.equal(elements.send.disabled, false);

  const unconfirmed = form.submit({ preventDefault() {} });
  resolveReply(null);
  await unconfirmed;
  assert.equal(elements.reply.value, "草稿");
  assert.equal(elements["reply-status"].textContent, "暂时无法确认发送结果");

  const pending = form.submit({ preventDefault() {} });
  show(8);
  elements.reply.value = "下一条草稿";
  resolveReply(true);
  await pending;
  assert.equal(elements.reply.value, "下一条草稿");
  assert.equal(elements["reply-status"].textContent, "");
  assert.equal(elements.card.hidden, false);
  assert.ok(calls.slice(2).every(({ command }) => command === "desktop_completion_reply"));
});
