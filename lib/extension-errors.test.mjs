import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { describeExtensionError } = await jiti.import("./extension-errors.ts");
const { getLocalePlugin } = await jiti.import("./i18n/registry.ts");
const { interpolateMessage } = await jiti.import("./i18n/format.ts");
const t = locale => (key, params) => {
  const message = getLocalePlugin(locale).messages[key];
  assert.ok(message, key);
  return interpolateMessage(message, params);
};

test("explains trust failures for ordinary and organization plugins and skills in Chinese", () => {
  for (const target of ["modifying project plugins", "installing project plugins", "installing project skills", "installing project capabilities"]) {
    const result = describeExtensionError(new Error(`Project resources must be trusted before ${target}`), t("zh-CN"));
    assert.equal(result.message, "当前项目尚未受信任，请先信任此项目，再安装或修改项目扩展。");
    assert.equal(result.details, undefined);
  }
});

test("handles expected API, network, skill update and connector validation failures", () => {
  for (const error of ["Access denied", "Untrusted API request", "Content-Type must be application/json", "Installed skill not found", "This skill cannot be updated automatically", "Remote skill path was not found.", "Package is configured but not installed yet.", "HTTP MCP does not support update", "Stdio Server 必须提供命令", "Error: fetch failed", "TypeError: Failed to fetch", "HTTP 403", "skills.sh search failed: HTTP 429", "cwd, package, and scope are required"]) {
    const result = describeExtensionError(error, t("zh-CN"));
    assert.match(result.message, /[\u3400-\u9fff]/, error);
    assert.notEqual(result.message, error);
  }
  assert.match(describeExtensionError("HTTP 429", t("zh-CN")).message, /429/);
});

test("keeps package names, paths and command output in expandable details", () => {
  const raw = "npm install @scope/pi-plugin --prefix F:\\image\\.pi\\npm --legacy-peer-deps failed with code 1";
  const result = describeExtensionError(raw, t("zh-CN"));
  assert.match(result.message, /安装命令执行失败（退出码 1）/);
  assert.equal(result.details, raw);
});

test("preserves unknown upstream diagnostics without displaying English-only feedback", () => {
  const raw = "Unexpected upstream registry failure at https://registry.example.test/pkg";
  const result = describeExtensionError(raw, t("zh-CN"));
  assert.match(result.message, /操作失败/);
  assert.equal(result.details, raw);
  const localized = "插件配置校验失败，请检查服务地址。";
  assert.deepEqual(describeExtensionError(localized, t("zh-CN")), { message: localized });
});

test("English feedback and translation parameters remain available", () => {
  assert.match(describeExtensionError("Project resources must be trusted before modifying project plugins", t("en")).message, /Trust the project/);
  const en = getLocalePlugin("en").messages, zh = getLocalePlugin("zh-CN").messages;
  const keys = Object.keys(en).filter(key => key.startsWith("extensions.errors.") || key.startsWith("notifications."));
  assert.ok(keys.length > 30);
  for (const key of keys) {
    assert.ok(zh[key]?.trim(), key);
    assert.deepEqual(en[key].match(/\{\w+\}/g) ?? [], zh[key].match(/\{\w+\}/g) ?? [], key);
  }
});
