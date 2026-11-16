# 自动化 SDK 1.2.0

此次更新在 1.1 的分块文件、流式下载和报表能力之上，增加以下可选能力。现有应用无需改声明，原有 Cookie、MTOP、下载、表格和顶层 DOM 定位继续使用原方式。

| 能力 | 入口 | 边界 |
| --- | --- | --- |
| 接口凭证 | `request.auth`，运行配置中的“接口凭证” | Bearer / API Key；HTTPS + omit；本机 DPAPI 加密，绑定应用、请求头、接口路径和方法；脚本和模型只持有引用 |
| 接口上传 | `request.multipart`、`ctx.browser.request` | 授权文件引用，最多16个文件、合计512MiB；私有快照和原生流式发送；写请求不重试 |
| 请求控制 | `timeoutMs`、`responseHeaders`、`redirects` | 限定响应头；最多3次同源路径内 GET/HEAD 跳转；默认行为兼容旧包 |
| 批次恢复 | `automation.checkpoints`、`ctx.checkpoints.load/save` | 显式启用，用户手动继续，新 runId 保留来源；固定版本、功能、参数、配置、文件与浏览器身份；未记录的写入阻止恢复 |
| 网页文件选择 | `kind:"upload"` + `ctx.browser.operation` | 明确可见的文件控件、文件授权、账号授权和业务校验；保留原文件名；文件选择与服务器接收需要分别核对 |
| 页面上下文 | `locator.context` | 最多3层、唯一定位的同源 iframe / open Shadow DOM；不支持跨域 iframe、closed Shadow DOM、隐藏控件、目录拖放和任意脚本执行 |

检查点是业务批次进度，不是进程或 XLSX writer 内存快照。每批先提交文件、核对接口业务结果，再保存检查点；中断后的未知写入不能自动补发。启用检查点的应用通过 `ctx.files` / `ctx.tables` 写文件、通过 `ctx.browser` 请求网络；宿主禁用该应用脚本的直接 Node 文件写入和常规网络入口（fetch、WebSocket、TCP/TLS/UDP）。未启用检查点的旧应用不受此变化影响。

源码入口：

- `lib/automation-sdk-contract.json`：模型、运行时和 Haze 共用能力结构与限制。
- `lib/automation-session-request.ts`、`lib/automation-app-upload.ts`：接口声明和授权上传快照。
- `desktop/src-tauri/src/automation_credentials.rs`：应用隔离的加密凭证、撤销及凭证版本。
- `desktop/src-tauri/src/automation_session_request.rs`：原生鉴权注入、流式 multipart 和受控跳转。
- `lib/automation-checkpoints.ts`、`lib/automation-app-runtime.ts`：检查点边界、恢复与写入跟踪。
- `lib/automation-app-browser-runtime.ts`、`desktop/src-tauri/src/app-browser.js`、`desktop/src-tauri/src/automation_browser.rs`：浏览器授权、上下文和原生文件控件。
- `components/AutomationAppCredentials.tsx`、`components/AutomationApplication.tsx`：凭证设置和手动恢复入口。

精确参数及使用约定见 `docs/automation-sdk-reference.md`。模型从 `eureka_automation_task {sdkSection:"http"}`、`{sdkSection:"checkpoints"}`、`{sdkSection:"browser"}` 分章读取。

## 检查点与复杂页面的影响范围

两项能力均已实现，采用显式启用方式。验收边界如下：

检查点保存、恢复和复杂页面操作均在本地执行，不要求登录 Eureka / Haze，也不向 Haze 上传检查点或浏览器账号。此处的本地工作区标识用于找到原任务记录；网站账号核对仅用于确认恢复时仍在原店铺或业务账号中操作。纯本地文件任务无需网站账号。网站或接口自身要求的登录、凭证仍按其规则提供。

| 项目 | 生效条件与验收要求 | 兼容范围 |
| --- | --- | --- |
| 长任务检查点 | 应用声明 `automation.checkpoints:{schemaVersion:1}`，按已确认完成的业务批次保存进度；用户从失败、取消或中断的运行手动继续 | 普通启动仍从入口开始；未声明的旧应用保持原启动与文件、网络行为 |
| 恢复身份 | 新建 runId 并保留来源；核对包版本、参数、保存配置、输入元数据、浏览器账号与环境、接口凭证版本；同一来源仅接续一次 | 不替换原运行记录，不自动恢复或重发结果未知的写请求；不恢复创建阶段或聊天逐步执行 |
| 页面定位 | 只有声明 `locator.context` 才进入最多三层同源 iframe / 开放式 Shadow DOM；每层唯一、可见，并核对网站路径范围 | 未声明上下文的旧定位保持顶层文档范围；沿用现有浏览器环境、账号授权与操作校验 |
| 网页文件选择 | 显式声明 `kind:"upload"`，使用授权文件引用、可见文件控件及变更授权；应用等待提交并核对网站业务结果 | 沿用现有文件授权；文件控件选择成功不等同服务器接收成功，不自动重复提交 |

这两项不调整会话模型选择、发布资料生成、应用版本保存策略或 Haze 登录流程。它们共用已有运行、文件和浏览器模块，因此回归覆盖普通运行、旧定位、原有下载、授权撤销与中断处理。跨域 iframe、closed Shadow DOM、验证码绕过、任意页面脚本和通用 CDP 接口不在此次范围内。

原生能力必须重新编译并更新桌面程序。Haze 端部署 `integrations/haze` 的匹配契约、manifest、样例和 Python 适配器；本仓库只生成交付文件，不部署 Haze 服务。运行 `npm run sdk:contract:check` 验证交付文件没有过期。开发期间不运行 `next build`。
