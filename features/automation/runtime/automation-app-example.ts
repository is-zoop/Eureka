import { inspectAutomationFiles, writeAutomationAppZip } from "./automation-app-package";

/** Public, synthetic packaging fixture. It never accesses a user's workspace. */
export function automationExampleFiles(version = "1.0.0"): Map<string, Buffer> {
  if (!["1.0.0", "1.1.0"].includes(version)) throw new Error("示例版本无效");
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const files = ["plugin.json", "package.json", "ui.json", "workflow.json", "scripts/main.mjs", "README.md"];
  return new Map(Object.entries({
    "plugin.json": json({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "file-list-package-example", version, description: "A02 应用包管理示例，用于验证安装、版本、启停和导出；没有可执行的文件处理功能。", extensions: { "com.eureka": { schemaVersion: 1, displayName: "应用包管理示例", automation: { schemaVersion: 1, id: "c9677b6a-7991-4fc1-8d40-8862c3c9dcab", runtime: "javascript-esm", entry: "scripts/main.mjs", ui: "ui.json", workflow: "workflow.json", capabilities: ["files.read", "artifacts"], files } } } }),
    "package.json": json({ name: "file-list-package-example", version, type: "module", pi: { skills: [] } }),
    "ui.json": json({ schemaVersion: 1, fields: [{ id: "source", label: "待处理文件夹", type: "directory", required: true }], buttons: [{ id: "run", label: "运行", action: "run" }], results: { columns: [{ key: "name", label: "文件名", type: "text" }], download: true } }),
    "workflow.json": json({ schemaVersion: 1, nodes: [{ id: "read", label: "读取文件清单", kind: "script", script: "scripts/main.mjs" }, { id: "output", label: "输出清单", kind: "script" }, ...(version === "1.1.0" ? [{ id: "summary", label: "汇总信息", kind: "script" }] : [])], edges: [{ from: "read", to: "output" }, ...(version === "1.1.0" ? [{ from: "output", to: "summary" }] : [])] }),
    "scripts/main.mjs": `// A02 packaging example ${version}. Installation must not execute this file.\nexport default async function run() {\n  throw new Error("此示例仅用于 A02 应用包管理验收，尚无运行逻辑。");\n}\n`,
    "README.md": `# 应用包管理示例\n\n版本 ${version}。本包只有公开示例声明，没有真实用户数据。\n\n用于验证 A02 的安装、版本切换、停用、卸载和导入导出。不包含实际文件处理功能，不应报告运行成功。A03 接入通用运行器后再制作可运行示例。\n\n用户配置、授权、日志、产物和证据只应写入宿主分配的 app-data 目录；禁止写回插件包，也不要把密码、登录状态或真实业务样本写进源码。\n`,
  }).map(([name, value]) => [name, Buffer.from(value)]));
}
export function automationExampleArchive(version = "1.0.0") {
  const files = automationExampleFiles(version); inspectAutomationFiles(files); return writeAutomationAppZip(files);
}

/** Real SDK example, separate identity from the immutable A02 packaging fixture. */
export function fileAutomationExample(version = "1.0.0") {
  if (!["1.0.0", "1.1.0"].includes(version)) throw new Error("示例版本无效");
  const enhanced = version === "1.1.0", json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const published = ["plugin.json", "package.json", "ui.json", "workflow.json", "scripts/main.mjs", "README.md"];
  const script = `export default async function run(ctx) {
  const entries = await ctx.step("read", { source: ctx.params.source.label }, () => ctx.files.list(ctx.params.source));
  let chosen = entries;
  ${enhanced ? `chosen = await ctx.step("filter", { suffix: ctx.params.suffix, includeDirectories: ctx.params.includeDirectories }, async () => entries.filter(row => (ctx.params.includeDirectories || row.kind === "file") && (!ctx.params.suffix || row.name.endsWith(ctx.params.suffix))));` : `chosen = entries.filter(row => row.kind === "file");`}
  const rows = [];
  for (const entry of chosen) {
    rows.push(await ctx.step("inspect", { name: entry.name }, async () => {
      const delay = Number(ctx.params.delayMs ?? 100); if (delay < 0 || delay > 60000) throw new Error("每项等待应为 0～60000 毫秒。");
      await ctx.sleep(delay);
      await ctx.log("已读取：" + entry.name);
      return { name: entry.name, kind: entry.kind, size: entry.size, modifiedAt: entry.modifiedAt };
    }));
  }
  ${enhanced ? `if (ctx.params.confirm) {
    const answers = await ctx.step("confirm", { count: rows.length }, () => ctx.ask([{ title: "导出文件清单", question: "已读取 " + rows.length + " 项，是否生成 CSV？", options: [{ label: "生成 CSV", description: "将清单保存为本机产物" }, { label: "只看结果", description: "保留本轮结果，不创建 CSV" }] }]));
    if (!answers[0].optionIds?.includes("1")) return rows;
  }` : ""}
  await ctx.step("export", { count: rows.length }, async () => {
    const cell = value => { let text = String(value); if (/^[=+@\\-\\t\\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
    const csv = "\\uFEFF" + [["文件名", "类型", "大小", "修改时间"], ...rows.map(r => [r.name, r.kind, r.size, r.modifiedAt])].map(row => row.map(cell).join(",")).join("\\r\\n");
    return ctx.artifacts.write("文件清单.csv", csv, "text/csv;charset=utf-8");
  });
  ${enhanced ? `await ctx.step("summary", { count: rows.length }, async () => ({ total: rows.length, totalBytes: rows.reduce((sum, r) => sum + r.size, 0) }));` : ""}
  return rows;
}
`;
  const files = new Map<string, Buffer>(Object.entries({
    "plugin.json": json({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "file-list-sdk-example", version, description: "读取用户选择的目录，按真实节点整理文件清单并生成 CSV；不修改源文件。", extensions: { "com.eureka": { schemaVersion: 1, displayName: "文件清单", automation: { schemaVersion: 1, id: "847ccbf9-18d8-49ee-b581-092bb2473023", runtime: "javascript-esm", entry: "scripts/main.mjs", ui: "ui.json", workflow: "workflow.json", capabilities: ["files.read", "artifacts", ...(enhanced ? ["clarification"] : [])], files: published } } } }),
    "package.json": json({ name: "file-list-sdk-example", version, type: "module" }),
    "ui.json": json({ schemaVersion: 1, fields: [{ id: "source", label: "待整理文件夹", type: "directory", required: true }, { id: "delayMs", label: "每项等待毫秒", type: "number", default: 100, description: "正常用 100；测试停止时可以填 1000。" }, ...(enhanced ? [{ id: "suffix", label: "文件名后缀", type: "text", default: "" }, { id: "includeDirectories", label: "包括子文件夹名称", type: "boolean", default: false }, { id: "confirm", label: "导出前询问", type: "boolean", default: false }] : [])], buttons: [{ id: "run", label: "生成文件清单", action: "run" }], results: { columns: [{ key: "name", label: "文件名", type: "text" }, { key: "kind", label: "类型", type: "text" }, { key: "size", label: "大小（字节）", type: "number" }, { key: "modifiedAt", label: "修改时间", type: "date" }], download: true } }),
    "workflow.json": json({ schemaVersion: 1, nodes: [{ id: "read", label: "读取目录", kind: "script", script: "scripts/main.mjs" }, ...(enhanced ? [{ id: "filter", label: "筛选范围", kind: "branch" }] : []), { id: "inspect", label: "逐项整理", kind: "loop" }, ...(enhanced ? [{ id: "confirm", label: "等待导出选择", kind: "wait-user" }] : []), { id: "export", label: "生成 CSV", kind: "script" }, ...(enhanced ? [{ id: "summary", label: "汇总", kind: "script" }] : [])], edges: [{ from: "read", to: enhanced ? "filter" : "inspect" }, ...(enhanced ? [{ from: "filter", to: "inspect" }, { from: "inspect", to: "confirm", label: "需要确认" }, { from: "confirm", to: "export" }] : []), { from: "inspect", to: "inspect", label: "下一项" }, { from: "inspect", to: "export" }, ...(enhanced ? [{ from: "export", to: "summary" }] : [])] }),
    "scripts/main.mjs": script,
    "README.md": `# 文件清单\n\n版本 ${version}。选择一个业务目录后读取当前层级的文件，不递归或修改源文件；结果和 CSV 产物保存在当前用户的数据目录。目录项修改时间来自实际文件属性。\n\n每项等待可用来观察循环和停止；新运行重新读取，已结束运行不会重放。${enhanced ? "可筛选后缀、包括子目录名称、在导出前通过澄清卡片选择。" : ""}\n\n目录授权只对选择时的代码内容有效，切换代码版本后需重新选择。\n`,
  }).map(([name, value]) => [name, Buffer.from(value)]));
  return writeAutomationAppZip(files);
}
