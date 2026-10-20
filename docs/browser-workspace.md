# 组织插件选择与内置浏览器

## 使用

在输入框的添加菜单或 `/` 菜单中选择“插件”下的组织插件，例如“Atlas数据助手”。选择以标签显示，支持同时选择多个插件；输入业务请求后发送。选择只作用于当前消息，不等于安装、启用或新增工具权限。

普通 Pi 市场包仍在原有插件管理入口维护。组织插件的版本更新、停用、卸载及地址授权继续在组织扩展详情中操作。出现“待重载”、认证失效或技能冲突时，先处理详情中的状态并重载当前会话。

模型调用组织插件后，插件返回的选数链接会自动打开右侧网页面板，输入框不提供手动浏览器按钮。面板支持 HTTP/HTTPS 地址、标签页、前进后退、刷新、点击、滚动、键盘、中文输入和文本粘贴。网页使用 Eureka 服务端的网络环境：远程部署时 `localhost` 指服务器，不是使用者电脑。

“隐藏”暂停画面传输并暂留网页环境；无可见面板连接十分钟后清理。关闭浏览器会立即清理网页 Cookie 和存储。不同 Eureka 对话、不同账号使用独立环境；退出、账号切换或删除对话会释放对应资源。进程重启不恢复网页登录状态。

本期不提供模型网页操作工具，也不提供自定义 `/atlas-menu` 命令、文件上传下载、网页对话框交互、系统剪贴板读取或持久浏览器配置。浏览器自动化可后续在同一运行时上增加，不应另建一套网页登录环境。

## 安装与部署

生产依赖 `playwright` 固定在 package-lock.json 中，配套浏览器需显式安装：

```powershell
npm install
npm run browser:install
npm run dev
```

Linux 部署还需安装对应 Chromium 的系统依赖，按 Playwright 官方安装说明配置。运行服务的账号必须能读取其浏览器缓存。设置 `PLAYWRIGHT_BROWSERS_PATH` 时，安装阶段和运行阶段应使用同一目录；也可通过服务端环境变量 `EUREKA_BROWSER_EXECUTABLE` 显式指定匹配的 Chromium 可执行文件。

服务启动和首次网页请求不会自动下载浏览器。缺少 Chromium 时，界面提供安装指引。

桌面资源准备脚本要求先完成 `npm run browser:install`，会复制 Playwright、playwright-core 和匹配的 Chromium，并生成 `browser/runtime.json`。桌面启动的 Node 服务按该描述文件查找浏览器，无需为外部网页开放 Tauri 权限。浏览器显示和交互与 Web 版共用实现。

不要在开发验证时运行 `next build` 或会间接运行该命令的桌面资源准备、打包脚本。

## 接口与插件链接契约

- `GET /api/organization-extensions/composer?cwd=...&sessionId=...`：当前来源的有效组织插件及状态，遵守项目覆盖全局和项目信任。
- 消息提交可携带 `selectedPlugins`：来源、能力 ID、包摘要及展示名称。服务端重新解析并校验，客户端名称不决定实际加载对象。上下文记录随消息保存，输入框、历史显示及恢复隐藏内部展开文本。
- `GET /api/browser?sessionId=...`：浏览器摘要及 Chromium 就绪状态。
- `POST /api/browser`：打开、新建/选择/关闭标签、导航、返回、前进、刷新、调整 viewport、鼠标、键盘、文本及关闭浏览器。
- `GET /api/browser/events?sessionId=...&frames=1`：SSE 状态与 JPEG 画面。`frames=0` 仅订阅插件打开通知，不保活或传输画面。API 需要当前 Haze 登录，访客不可用。

宿主仅处理当前会话已登记组织 MCP 的成功工具结果。实际服务器身份来自 adapter 的结果详情，不根据聊天中的工具名或链接猜测。支持 MCP `structuredContent` 或文本块中的顶层 JSON 对象，以及 Atlas 标准 `{ data: { browser_url, ... }, request_id }` 响应信封。接管后保留原有信封、业务字段与请求编号，移除启动链接并加入 `browser_panel`：

```json
{
  "session_id": "当前业务会话",
  "scope_revision": 3,
  "browser_url": "https://atlas.example/selector#launch=短期启动凭据"
}
```

Eureka 消费 `browser_url`，在当前对话右侧打开顶层网页；同一插件、业务会话复用标签。成功交接后，工具结果保留业务字段并返回 `browser_panel` 状态，模型无需再次打开系统浏览器。失败时明确返回失败，检查运行时或目标服务后重新调用原工具获取新链接。历史消息回放不会重开页面。

短期启动地址不写入宿主日志、草稿或持久浏览器状态，画面和 URL 仅对所属用户可用。地址栏摘要不显示 query 或 fragment；宿主不向网页注入 Haze、Eureka Cookie 或个人凭证。网页以真实 Chromium 顶层页面加载，不通过 iframe 或改写目标站点安全策略。

## 验证

运行 `lib/plugin-selection.test.mjs`、`lib/plugin-composer-runtime.test.mjs` 与 `lib/browser-runtime.test.mjs`。最后一项需要已安装 Chromium，会使用独立临时账号目录和本机 HTTP 测试页面，不操作日常浏览器。

真实 Atlas 联调需要可用的 Haze 登录、已授权的组织插件和 Atlas MCP 服务；模拟包与浏览器测试不替代“Haze 发布 → 安装 → 当前对话选数 → 原业务会话查询”的完整验证。

本次实现已通过 147 项针对性及相关回归测试、TypeScript 类型检查和相关 lint（零错误，保留原有警告）。真实 Chromium 测试覆盖画面流、中文输入、导航、Cookie 隔离、并发标签复用和账号切换清理。独立页面预览没有 Haze 登录，未执行真实 Atlas 业务查询；该项及桌面安装包完整运行仍待联调验证。本次未运行 Next 构建或桌面打包。
