import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../ui/startup-theme.js", import.meta.url), "utf8");

function startup(preference, darkSystem) {
  const classes = new Set();
  const root = { dataset: {}, style: {}, classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } } };
  let changed;
  const media = { matches: darkSystem, addEventListener(name, fn) { if (name === "change") changed = fn; } };
  runInNewContext(script, {
    document: { documentElement: root },
    window: { __EUREKA_DESKTOP_THEME__: preference, matchMedia: () => media },
  });
  return { root, dark: () => classes.has("dark"), changeSystem(dark) { media.matches = dark; changed(); } };
}

test("startup applies saved dark mode before paint even when Windows is light", () => {
  const page = startup("dark", false);
  assert.equal(page.dark(), true);
  assert.equal(page.root.style.colorScheme, "dark");
  assert.equal(page.root.dataset.theme, "dark");
  page.changeSystem(false);
  assert.equal(page.dark(), true);
});

test("startup preserves saved light mode when Windows is dark", () => {
  const page = startup("light", true);
  assert.equal(page.dark(), false);
  assert.equal(page.root.style.colorScheme, "light");
  page.changeSystem(true);
  assert.equal(page.dark(), false);
});

test("automatic startup theme follows system changes in both directions", () => {
  const page = startup("auto", false);
  assert.equal(page.dark(), false);
  page.changeSystem(true);
  assert.equal(page.dark(), true);
  page.changeSystem(false);
  assert.equal(page.dark(), false);
});

test("missing or invalid startup preferences fall back to the current system theme", () => {
  for (const preference of [undefined, null, "", "unknown"]) {
    const page = startup(preference, true);
    assert.equal(page.dark(), true);
    assert.equal(page.root.dataset.theme, "auto");
  }
});
