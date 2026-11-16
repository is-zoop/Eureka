# 自动化 SDK 1.1.0

## 统一能力契约

`lib/automation-sdk-contract.json` 是能力、声明 Schema、方法和关键限制的源数据。模型章节读取返回同一份契约摘要；`ctx.sdk` 提供同样的版本、方法和限制。应用包和请求使用契约校验后，仍执行原有授权、范围、文件一致性和语义检查。原生 HTTP 与旧下载通道的大小常量从契约生成。

`npm run sdk:contract` 导出 Haze 文件；`npm run sdk:contract:check` 检查导出文件是否过期。公共测试样例在 `lib/automation-sdk-contract-fixtures.json`，Node、Python、Rust 使用同一批 request 样例核对兼容性。

Haze 对接目录是 `integrations/haze/`。云端将 `validate_sdk_files(files)` 接入原有 `eureka_package.py` 的声明校验阶段，合并返回的 compatibility.errors；保留身份、上传限制、ZIP 安全、归属和审核检查。此仓库不直接部署 Haze。

## 大文件通道

`ctx.browser.download(operationId,input,destinationRef,overwrite=false,{maxBytes?,timeoutMs?,sha256?})` 默认/最高下载 1 GiB，默认超时 180 秒，可设 1 秒～30 分钟。可传 SHA256。仍须连接声明的网站并授予目标目录写权限。

新原生层直接分块写入宿主指定的随机临时文件，文件体不再以整包 Base64 穿过浏览器和 worker IPC。宿主复核授权、长度、可选 SHA256 后发布正式文件。取消、超限和校验失败清理临时文件，默认不覆盖目标，不自动重试。运行界面记录字节进度。

普通 HTTP 响应仍为 16 MiB/20 秒。旧桌面二进制兼容通道仍为 12 MiB；流式下载需要重新编译安装桌面程序。

`ctx.files.readChunk(ref,{offset,length})` 每次最多返回 1 MiB 的 Buffer 和 nextOffset/eof。`ctx.files.createWriter(ref,options)` 返回 write/commit/abort；单次 write 最多 1 MiB、总文件最多 1 GiB。commit 返回 bytes/sha256，运行结束清理未提交写入。

ZIP 只读取中央目录和逐条文件流，不整体加载压缩包。输入最多 1 GiB，解出单文件最多 512 MiB、合计 1 GiB，最多 512 条目；保留路径、链接、冲突、大小和 CRC 检查。多文件最终提交不是文件系统事务，磁盘错误或提交期间停止仍可能留下部分已发布文件。

## CSV/XLSX 表格服务

所有调用放入 ctx.step，声明 files.read/files.write 并使用现有文件授权。

```js
const file = ctx.files.child(ctx.params.outputDirectory, "汇总.xlsx");
const writer = await ctx.tables.createWriter(file, {
  format: "xlsx",
  sheets: [{ name: "明细", columns: [
    { key: "id", label: "计划ID", type: "text", width: 24 },
    { key: "cost", label: "花费", type: "number", numFmt: "0.00" },
    { key: "roi", type: "formula", numFmt: "0.00" }
  ] }]
});
await ctx.tables.appendRows(writer, [
  { id: "000012345678901234567890", cost: 12.5,
    roi: { formula: "B2*2", result: 25 } }
], "明细");
await ctx.tables.commitWriter(writer);
```

读取使用 `openReader(ref,{format:"csv",encoding:"gb18030"})` 或 `{format:"xlsx"}`，随后 `readRows(reader,500)` 返回 `{rows:[{sheet,row,values}],done}`，持续读到 done，提前停止可 closeReader。CSV 首行是否为表头由业务代码按真实文件约定处理。

CSV 支持引号、多行字段、BOM、UTF-8/GBK/GB18030/UTF-16LE；输出 UTF-8，可选 BOM、分隔符和公式文本转义。XLSX 支持多工作表、文本/数值/布尔/日期/公式列、列宽、数字格式、冻结行和批次追加。公式只写表达式和可选缓存值，不执行计算；客户端是否重算取决于 Excel/WPS 设置。

每批最多 2000 行/16 MiB，每次运行最多 8 个表格句柄。CSV 输入最多 1 GiB、单记录最多 1 MiB；XLSX 输入最多 32 MiB、展开最多 128 MiB，先验证 ZIP 实际内容再按行读取。输出最高 1 GiB，最多 32 个工作表、每表 256 列和 1048576 行（含表头）。追加指同一未提交 writer 内追加；已关闭的 XLSX 不支持原地追加。XLS、ODS、图表、宏及任意模板无损编辑不在本版范围内。

## 验证与上线

Node 测试覆盖契约、真实 worker RPC、40 MiB 下载、20 MiB 分块写入、ZIP 校验、CSV 中文/多行字段、XLSX 类型/格式/公式和失败清理。Rust 测试覆盖真实本机 HTTP 流式下载、取消、上限和原有 Cookie/签名约束。

Haze 适配需云端团队部署；Eureka 原生流式下载需重新打包。测试未调用真实业务网站、下载业务文件或发布应用。
