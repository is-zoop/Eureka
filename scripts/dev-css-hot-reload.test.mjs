import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { replaceStylesheets } = require("./dev-css-hot-reload.js");

function fixture(href = "http://localhost:8080/_next/static/css/app/layout.css?v=one") {
  const nodes = [];
  function link(url) {
    const handlers = new Map();
    return { href: url, parentNode: parent, nextSibling: null,
      cloneNode() { return link(this.href); },
      addEventListener(event, handler) { handlers.set(event, handler); },
      removeEventListener(event) { handlers.delete(event); },
      fire(event) { handlers.get(event)?.(); },
      remove() { parent.removeChild(this); },
    };
  }
  const parent = {
    insertBefore(node, before) { nodes.splice(before ? nodes.indexOf(before) : nodes.length, 0, node); },
    removeChild(node) { const index = nodes.indexOf(node); if (index >= 0) nodes.splice(index, 1); node.parentNode = null; },
  };
  const old = link(href); nodes.push(old);
  return { old, nodes, doc: { baseURI: "http://localhost:8080/", querySelectorAll: () => [...nodes] } };
}

test("a failed CSS refresh preserves the working stylesheet and allows recovery", () => {
  const { doc, old, nodes } = fixture();
  replaceStylesheets(doc, 1);
  assert.equal(nodes.length, 2);
  const failed = nodes[1]; failed.fire("error");
  assert.deepEqual(nodes, [old]);
  replaceStylesheets(doc, 2);
  const loaded = nodes[1];
  assert.match(loaded.href, /eureka-css-hmr=2/);
  assert.deepEqual(nodes, [old, loaded]);
  loaded.fire("load");
  assert.deepEqual(nodes, [loaded]);
  assert.equal(loaded.isLoaded, true);
});

test("overlapping updates do not remove or duplicate a pending replacement", () => {
  const { doc, nodes } = fixture();
  replaceStylesheets(doc, 1); replaceStylesheets(doc, 2);
  assert.equal(nodes.length, 2);
  nodes[1].fire("load");
  assert.equal(nodes.length, 1);
});

test("CSS hot updates leave external styles and non-Next assets untouched", () => {
  for (const href of ["https://cdn.example/style.css", "http://localhost:8080/vendor/style.css"]) {
    const { doc, old, nodes } = fixture(href); replaceStylesheets(doc);
    assert.deepEqual(nodes, [old]);
  }
});
