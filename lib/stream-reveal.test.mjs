import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { advanceStreamReveal, rehypeStreamReveal } = await jiti.import("./stream-reveal.ts");
const { markdownRehypePlugins, markdownRemarkPlugins } = await jiti.import("./markdown.ts");

function reveal(source, previous = "") {
  return advanceStreamReveal(advanceStreamReveal(null, previous, true, 1000), source, true, 1010);
}
function render(state) {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: markdownRemarkPlugins,
    rehypePlugins: [...markdownRehypePlugins, [rehypeStreamReveal, state]],
  }, state.source));
}

test("snapshots, rewritten Markdown, and finished messages have no entrance animation", () => {
  const initial = advanceStreamReveal(null, "Already loaded", true, 1000);
  assert.equal(initial.characters.length, 0);
  const added = advanceStreamReveal(initial, "Already loaded!", true, 1010);
  assert.equal(added.characters.length, 1);
  assert.equal(advanceStreamReveal(added, "Replaced", true, 1020).characters.length, 0);
  assert.equal(advanceStreamReveal(added, added.source, false, 1020).characters.length, 0);
  assert.doesNotMatch(render(initial), /data-stream/);
});

test("burst output catches up with bounded animated DOM and delay", () => {
  const state = reveal("字".repeat(10000));
  assert.equal(state.characters.length, 24);
  assert.equal(Math.max(...state.characters.map((character) => character.delay)), 90);
  assert.deepEqual(state.characters.slice(0, 4).map((character) => character.delay), [0, 30, 60, 90]);
  assert.equal(state.characters[0].offset, 9976);
  assert.equal((render(state).match(/data-stream-born-at/g) ?? []).length, 24);
});

test("new batches preserve animation clocks and drop expired characters", () => {
  const first = reveal("abc");
  const next = advanceStreamReveal(first, "abcd", true, 1050);
  assert.deepEqual(next.characters.slice(0, 3), first.characters);
  const late = advanceStreamReveal(next, "abcde", true, 1500);
  assert.equal(late.characters.length, 1);
  assert.equal(late.characters[0].offset, 4);
});

test("Chinese, combining marks and joined emoji remain whole graphemes", () => {
  const text = "中e\u0301👨‍👩‍👧‍👦👍🏽";
  const state = reveal(text);
  assert.equal(state.characters.length, 4);
  const html = render(state);
  assert.match(html, />e\u0301<\/span>/u);
  assert.match(html, />👨‍👩‍👧‍👦<\/span>/u);
  assert.match(html, />👍🏽<\/span>/u);
});

test("Markdown formatting and link destinations stay intact while new labels animate", () => {
  const state = reveal("Existing **bold** [new](https://example.com)", "Existing **bold** ");
  const html = render(state);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, />e<\/span>/);
  assert.equal(html.replace(/<[^>]+>/g, ""), "Existing bold new");
});

test("code, tables, Mermaid, formulas, escapes and entities remain untouched", () => {
  for (const markdown of ["`code`", "```js\nconst x = 1;\n```", "```mermaid\ngraph TD; A-->B;\n```", "| A | B |\n| - | - |\n| C | D |", "$x + y$", "a &amp; b", String.raw`escaped \* text`]) {
    const html = render(reveal(markdown));
    assert.doesNotMatch(html, /data-stream/, markdown);
  }
});

test("animations do not split an existing emoji when a later delta adds a joiner", () => {
  const state = reveal("👨‍👩", "👨");
  assert.doesNotMatch(render(state), /data-stream/);
});
