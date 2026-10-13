import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { getThinkingPreview } = await createJiti(import.meta.url).import("./thinking-preview.ts");

test("thinking summaries are readable without Markdown markers", () => {
  assert.equal(getThinkingPreview("**Querying 2025 platform category data**\n\n**Checking totals**"), "Querying 2025 platform category data Checking totals");
  assert.equal(getThinkingPreview("## 查看文件\n- 读取 `sales_data.csv` 和 [说明](https://example.com)\n> *核对计算*"), "查看文件 读取 sales_data.csv 和 说明 核对计算");
  assert.equal(getThinkingPreview("**正在检查"), "正在检查");
});

test("summary truncation preserves Unicode and leaves full thinking intact", () => {
  const original = "😀".repeat(200);
  const summary = getThinkingPreview(original);
  assert.equal(summary, "😀".repeat(160) + "…");
  assert.equal(original, "😀".repeat(200));
  assert.equal(getThinkingPreview("sales_data_file.csv"), "sales_data_file.csv");
  assert.equal(getThinkingPreview(" \n "), "");
});
