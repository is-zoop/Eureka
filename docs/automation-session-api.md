# 自动化复用浏览环境调用 API

2026-11-06：已接入源代码。需要更新 Rust 桌面程序后使用；真实网站登录与业务接口尚未验收。网页版和旧桌面二进制不具备此原生能力。

## 登录与 Cookie

在侧栏选择浏览环境并登录网站，自动化配置选择同一环境。浏览器继续管理 Cookie 与登录资料；应用不再维护 Python 的 Cookie JSON 文件。持久 Cookie 按网站有效期保存在原浏览环境，临时环境与网站的会话 Cookie 不承诺退出程序后仍有效；过期后重新登录。

默认 `credentials:"browser"`：请求从该环境读取**目标 API URL**匹配的 Cookie，包括 HttpOnly Cookie，在原生内存中注入请求。没有匹配 Cookie 时普通 API 仍可请求；实际鉴权结果以服务端返回为准。API 子域需单独声明地址，不要求与页面同源。响应的 Set-Cookie 更新回同一环境。Cookie 的 Secure、域名、路径和有效期规则继续适用；不会为了 HTTP 接口复制 HTTPS 的 Secure Cookie。Cookie、签名 token 和凭证响应头不返回模型或应用代码。

公共接口、使用独立业务参数鉴权的接口可以声明 `credentials:"omit"`，不读取或发送浏览器 Cookie，也不将响应的 Set-Cookie 写回浏览环境。此时 401/403 提示核对接口鉴权参数，不要求通过网页登录解决。

## 声明与调用

在 `automation.browser.sites[].operations` 声明 API：

```json
{
  "id": "inventory",
  "label": "查询库存",
  "description": "按商品 ID 查询 SKU 库存",
  "effect": "query",
  "kind": "request",
  "request": {
    "url": "https://inventorymanage.taobao.com/seller/inventory/frontWithPlan/v2/editormanager/querySkuQuantity",
    "method": "GET",
    "response": "json"
  }
}
```

入口网站仍有 `id/label/startUrl/paths/operations`，能力声明保留 `browser.read`。API 支持 HTTP、HTTPS、非标准端口和 URL 自带的固定查询参数，每个不同端点单独声明；运行时不能换协议、主机、端口或路径。保留真实接口的原始协议和端口，不为通过校验擅自改成 HTTPS。地址不能包含用户名/密码或 `#fragment`。可声明 GET、HEAD、OPTIONS、POST、PUT、PATCH、DELETE；POST 查询仍可标为 query，变更必须如实声明 mutation。

例如旧系统可声明 `request:{url:"http://legacy.example:8088/api?version=1",method:"POST",credentials:"omit",response:"json"}`。运行时 `query` 与固定参数合并，同名键会替换 URL 中该键的全部值；其他参数和重复键继续保留。固定参数只存可发布的业务默认值，真实账号、密钥和测试数据继续放在私有配置中。

```js
export default async function run(ctx) {
  return ctx.step("query", { itemId: ctx.params.itemId }, async () => {
    await ctx.browser.connect("seller");
    const response = await ctx.browser.request("inventory", {
      query: {
        itemId: String(ctx.params.itemId),
        templateId: "",
        from: "tmall-sellManage-edit"
      }
    });
    if (response.status !== 200 || response.data.success !== true) {
      throw new Error("库存查询未成功，请核对业务响应。");
    }
    return response.data.data;
  });
}
```

此例用于说明迁移方式，并未对用户真实商品执行。保留原脚本的字段解析、错误判断和参数字符串，不把 HTTP 200 当业务成功。调用返回 `{status,data,dispatched,verified?}`。输入支持 `query` 字符串映射，以及 `form` 字符串映射或 `json` 请求体；form 与 json 二选一，GET/HEAD 无请求体。HEAD、空响应和非 JSON 接口使用 `response:"text"`。

固定声明可包含 Accept、Content-Type、Referer、X-Requested-With、User-Agent 请求头。Cookie、Authorization、Host 等不能由脚本传入。原脚本中的动态 CSRF、额外平台凭证、其他签名算法需要另行适配；不能把历史硬编码 token 放入应用包，也不能假定 Cookie 能代替它们。

## 淘宝 MTOP 签名

在 request 加上：

```json
"signature": { "kind": "taobao-mtop", "appKey": "12574478" }
```

将原始序列化 `data` 文本放在 query.data 或 form.data，且只放一次；也支持 URL 中的固定 data 默认值。宿主对合并后的实际 data 从 `_m_h5_tk` 取 token 前缀，按 `token&t&appKey&data` 计算 MD5，注入 t/appKey/sign。URL 和运行时参数都不能预置这三个签名字段。原始 data 的空格、顺序和字符编码影响签名，不能签名后再次序列化。

这个原生签名适配器仍使用声明的淘宝/天猫 HTTPS 域名与浏览器登录态，不能与 `credentials:"omit"` 同用；该适配器要求不影响普通 API 对 HTTP 的支持。其他签名仍需单独实现。登录失效、人工验证、HTML 登录页、重定向会产生明确错误，不携带 Cookie 自动跳转或重试。

## 变更、验证与分发

API mutation 要求如实声明 effect:mutation 和 browser.write，不要求可见账号标记、额外用户范围授权问答或 DOM 字段 verify。API 操作不使用 locator/row；旧包中的 request.verify 保留兼容，但请求前后都不读取该页面字段。宿主返回接口业务响应，由应用按端点约定判断成功，例如 data.ok === true；HTTP 200 本身不是业务成功。可主动调用查询接口复查，但不是保存或运行的强制门槛。网页控件变更仍遵循其账号、范围授权与 DOM 校验规则。

请求使用现有运行、应用版本、浏览环境与一次性派发凭证。派发后断线、取消、超时或状态未知都不自动重放 API。请求不跟随重定向，响应体支持 16 MiB（16,777,216 字节），并过滤凭证内容。浏览器结果回传和持久化 step/最终 JSON 结果支持 20 MiB，为外层对象和 JSON 编码保留空间；工作进程整条 IPC 消息仍最多 24 MiB。超限会显示实际预算，不将其解释为空数据、网站限流或自动重试。每次结果交付后释放命令保留的正文，避免分页过程中累积全部大响应。

2026-11-09：上述预算替代旧原生 1,000,000 字节响应、512 KiB 回传和 1 MiB 运行值限制。原生变更需要更新桌面二进制，同时使用对应后端。未降低输入参数、模型上下文或证据的独立预算：创建探索与自动证据仍有单项 256,000 字节预算，大响应应先在应用脚本中解析并返回需要的业务字段。不能为通过证据保存而丢弃业务结果。

创建探索支持 `eureka_app_browser` 的 request 方法，参数为 `[操作ID, 输入]`，仅允许只读查询。人工运行结果留在应用界面，不注入模型上下文。应用包只保存代码与规则，安装者使用自己的浏览环境。

API 失败时先记录操作 ID、派发阶段和原始宿主错误，再停止结果未知的变更，避免只有通用中断文案而没有原因。领取/派发凭证不等于已经向业务服务器发出请求，节点输出为空也不证明服务器没有返回 JSON。未派发的失败不标为已执行变更；已派发且结果未知仍不自动重试。

网页开发服务与桌面 Rust 主程序必须配套更新。只重启 Next.js、编译前端或运行 `cargo test` 都不会更新正在运行的 `target/debug/eureka.exe`。若源码已经移除 API DOM 校验，实际运行的旧二进制仍可能报“API 变更缺少结果校验”。根目录 `测试原生侧栏浏览器.cmd` 现在检测原生源码、内嵌 JS 和配置更新时间，按需编译 debug 主程序后再启动；旧测试程序仍在运行时会提示先关闭，编译失败则不回退启动旧程序。保持网页开发服务可用，退出旧桌面窗口后再次运行该 CMD 即可，无需发布安装包。也可在 desktop 目录运行 `npm run dev` 联动启动网页和原生开发环境。

## 本轮读取问题

开发服务曾漏载 `/api/automation/apps/[id]/runtime` 等子路由，返回 404 HTML。前端直接解析 JSON 又没有退出读取状态，造成语法错误提示和按钮长期禁用。已让开发服务重新发现路由，并补充非 JSON 响应处理、失败状态与“重试读取”。重试只读取配置/历史，不创建新运行。创建预览支持用户手动试运行；保存与业务校验解耦，不再要求模型校验通过。

## 桌面验收

1. 更新桌面原生程序，选择原浏览环境并完成网站登录。
2. 新建一个只读 API 自动化，声明真实端点，核对账号、参数、业务数据与原 Python 结果。
3. 关闭并重新打开任务，检查相同环境的有效登录能继续使用；过期登录应提示重新登录。
4. 检查跨子域 Cookie 匹配、MTOP 原始 data 签名与 Set-Cookie 更新；聊天、日志、导出包不应出现凭证。
5. 如需 API 变更，声明 browser.write 并按接口业务返回判断；无需额外授权澄清或页面结果核对。已派发但未知结果不得自动再次提交。

本轮未修改 `E:\synthos_plugins\plugins\tm_goods_update`，也未执行其库存、发货时间或第三方授权接口。

## 本轮检查记录

- 三个已安装应用的配置与历史接口恢复为 HTTP 200 JSON；含网页能力的应用，其浏览环境读取接口也返回 HTTP 200 JSON。
- 自动化解析、请求声明、一次性派发、授权、证据、包、运行器与界面国际化回归共 45 项通过。
- TypeScript 检查通过；相关 ESLint 检查无错误，保留原有警告。
- 原生请求模块完成 Rust 编译与单元测试，覆盖 MD5 标准向量、MTOP 原始 data、请求范围、凭证过滤及 JSON null。
- 以上不代替真实 WebView 登录、Cookie 生命周期和业务接口验收；未安装新桌面程序或执行用户商品变更。


## 文件下载与 ZIP 解压（2026-11-12）

新增 `ctx.browser.download(operationId,input,destinationRef,overwrite=false)` 和 `ctx.files.extractZip(archiveRef,directoryRef,options)`。需要更新并重启桌面原生程序后使用；创建应用本身不自动执行下载。完整参数与边界以 [SDK 参考的 HTTP 章节](./automation-sdk-reference.md#http-复用浏览环境的-api-请求)为准。

下载操作声明示例（域名和路径须换成已确认的真实下载范围）：

```json
{
  "id": "downloadReport",
  "label": "下载 ZIP 报表",
  "description": "下载已生成的报表文件",
  "kind": "request",
  "effect": "query",
  "request": {
    "url": "https://download.example/reports/",
    "method": "GET",
    "response": "bytes",
    "allowDynamicUrl": true,
    "credentials": "omit"
  }
}
```

应用保留 `browser.read`、`files.read`、`files.write` 能力；需要登录态时省略 `credentials:"omit"`。用户的 `output` 参数必须是已选择且允许写入的 directory 字段。下载链接从已声明的业务导出接口响应中获取，不写死实际签名 URL。

```js
await ctx.browser.connect("seller");
const downloaded = await ctx.browser.download(
  "downloadReport",
  { url: downloadUrl },
  ctx.files.child(ctx.files.workspace, "report.zip")
);
const extracted = await ctx.files.extractZip(downloaded.ref, ctx.params.output);
// 仅在需要读取 CSV 内容时解码；原样保存 CSV/XLSX 不需要转换。
const csv = extracted.files.find(file => file.name.endsWith(".csv"));
if (csv) {
  const text = await ctx.files.readText(csv.ref, "gb18030");
}
```

下载限同 origin 和声明目录，支持动态签名 query，不能越域或改为其他路径；不跟随重定向、不自动重试。单次下载最多 12 MiB，以便 Base64 回执保持在现有 IPC 预算内。ZIP 最多 16 MiB、512 条目、总展开 1 GiB、单文件 512 MiB。默认不覆盖，确需覆盖时显式传 `overwrite:true`；路径穿越、链接、重复路径、加密 ZIP、ZIP64 和损坏条目会拒绝。路径预检后分块解压到临时文件；全部条目的大小和 CRC 通过后才发布正式文件，不把大文件转为 Base64 送回工作进程。提交中取消或磁盘错误可能留下已发布文件，不自动删除或重新执行。
