import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { HazeLoginActions } = await jiti.import("./HazeLoginButton.tsx");
const render = (props = {}) => renderToStaticMarkup(React.createElement(HazeLoginActions, {
  onLogin() {}, onCancel() {}, onSkip() {}, ...props,
}));

test("the initial page has an underlined skip link aligned right", () => {
  const html = render();
  assert.match(html, /使用 Haze 登录/);
  assert.match(html, /justify-end/);
  assert.match(html, /<button[^>]*class="[^"]*underline[^>]*>跳过登录<\/button>/);
  assert.doesNotMatch(html, /取消授权|密码仅在|请在浏览器中完成/);
});

test("waiting and cancel controls share a row and have matching sizes; skip remains available", () => {
  const html = render({ waiting: true, desktop: true });
  const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
  assert.equal(buttons[0][2], "等待浏览器授权…");
  assert.equal(buttons[1][2], "取消授权");
  for (const button of buttons.slice(0, 2)) {
    assert.match(button[1], /h-10/);
    assert.match(button[1], /text-sm/);
    assert.match(button[1], /font-medium/);
  }
  assert.match(html, /<div class="flex w-full items-center gap-2"><button[^]*取消授权<\/button><\/div>/);
  assert.match(buttons[0][1], /disabled=""/);
  assert.doesNotMatch(buttons[1][1], /disabled=""/);
  assert.doesNotMatch(buttons[2][1], /disabled=""/);
});

test("cancellation and guest entry prevent duplicate actions", () => {
  for (const props of [{ waiting: true, cancelling: true }, { waiting: true, skipping: true }]) {
    const buttons = [...render(props).matchAll(/<button([^>]*)>(.*?)<\/button>/g)];
    assert.ok(buttons.every(button => button[1].includes("disabled=")));
  }
});

test("authorization errors remain accessible and retry controls remain available", () => {
  const html = render({ error: "授权等待已过期，请重新登录。" });
  assert.match(html, /role="alert"/);
  assert.match(html, /授权等待已过期，请重新登录。/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /取消授权/);
});
