import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  getLocalePlugin,
  getSupportedLocales,
  registerLocale,
  resolveBrowserLocale,
} = await jiti.import("./registry.ts");

test("uses the first supported browser language and falls back to English", () => {
  assert.equal(resolveBrowserLocale(["zh-CN", "en-US"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["zh", "en-US"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["en-US", "zh-CN"]), "en");
  assert.equal(resolveBrowserLocale(["fr-FR", "zh-CN"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["fr-FR"]), "en");
  assert.equal(resolveBrowserLocale([]), "en");
});

test("returns only registered locales", () => {
  assert.deepEqual(getSupportedLocales(), ["en", "zh-CN"]);
  assert.equal(getLocalePlugin("en").id, "en");
  assert.equal(getLocalePlugin("missing"), undefined);
});

test("extension capability labels use Chinese product names while preserving English MCP", async () => {
  const { capabilityTypeLabelKey } = await jiti.import("../organization-capability.ts");
  const types = ["Skill", "MCP", "Plugin"];
  assert.deepEqual(types.map(type => getLocalePlugin("zh-CN").messages[capabilityTypeLabelKey(type)]), ["技能", "连接器", "插件"]);
  assert.deepEqual(types.map(type => getLocalePlugin("en").messages[capabilityTypeLabelKey(type)]), ["Skills", "MCP", "Plugins"]);
  const english = getLocalePlugin("en").messages;
  const chinese = getLocalePlugin("zh-CN").messages;
  for (const key of Object.keys(english).filter(key => key.startsWith("extensions.connector"))) {
    assert.ok(chinese[key]?.trim(), key);
    assert.deepEqual(english[key].match(/\{\w+\}/g) ?? [], chinese[key].match(/\{\w+\}/g) ?? [], key);
  }
});

test("context inspector has matching localized labels and parameters", () => {
  const english = getLocalePlugin("en").messages;
  const chinese = getLocalePlugin("zh-CN").messages;
  const keys = Object.keys(english).filter((key) => key.startsWith("context."));
  assert.ok(keys.length > 0);
  assert.deepEqual(keys.sort(), Object.keys(chinese).filter((key) => key.startsWith("context.")).sort());
  for (const key of keys) {
    assert.ok(chinese[key].trim(), key);
    assert.deepEqual(english[key].match(/\{\w+\}/g) ?? [], chinese[key].match(/\{\w+\}/g) ?? [], key);
  }
});

test("allows a new locale plugin and rejects duplicate ids", () => {
  registerLocale({ id: "test", label: "Test", messages: { "common.ok": "OK" } });
  assert.equal(getLocalePlugin("test")?.label, "Test");
  assert.throws(() => registerLocale({ id: "test", label: "Again", messages: {} }));
});
