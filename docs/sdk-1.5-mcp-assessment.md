# SDK 1.5 原生 MCP 替换评估

验证日期：2026-11-06。依据项目实际安装的 Pi `1.5.0`、`pi-mcp-adapter 2.33.0` 及 Eureka 当前代码。

## 结论

**原生 Haze 接入代码现已完成，并通过真实认证、工具发现和市场只读调用。** 按后续确认的范围，旧配置与历史工具格式不迁移；Haze 动态认证、插件授权、连接状态和浏览器交接已经接入原生运行时。当前详细结果与验收边界见 [Haze 原生 MCP 接入](haze-native-mcp.md)。

生产扩展列表现已使用原生后端，不同时加载旧代理。旧包暂保留用于兼容测试及现有打包脚本；没有迁移或删除用户旧配置，也没有在未登录时改写真实凭证。

`createMcpExtension()` 是 SDK 的公开接口，但当前 Eureka 通过 `createAgentSessionServices()` 自行构建扩展列表；安装 SDK 并不会自动把原生 MCP 接入这份列表。不能把 SDK 的终端管理器 `/mcp` 当成已完成的 Eureka 网页管理页。

## 接入前能力对照（历史评估）

下表记录最初识别的迁移缺口；实现后的行为与验证边界以新的 [接入记录](haze-native-mcp.md) 为准。

| 能力 | SDK 1.5 原生 MCP | Eureka 当前依赖 | 替换判断 |
| --- | --- | --- | --- |
| stdio / Streamable HTTP | 提供标准传输与连接管理 | 现有适配器支持 | 可以接入；本轮用内存传输验证真实协议链路，未连接外部服务 |
| 工具发现、调用、结构化结果 | 支持，原生名为 `mcp__<server>__<tool>` | 现有 MCP 工具、历史记录与编排格式 | 可迁移，需要转换工具名及调用结果；保留旧历史的可读性 |
| 参数校验、权限钩子 | 经过 SDK 工具执行链 | Eureka 插件选择还使用适配器审批事件 | 原生拒绝钩子已验证，但现有 Haze 插件规则不会自动接入 |
| 资源与资源模板 | 支持列表和读取 | 现有资源入口及授权 | 客户端列表、读取已测；网页入口及跨后端权限待接 |
| 取消 | 支持请求取消通知 | 任务取消、身份切换、连接关闭 | 协议取消已测；需再验证真实服务与 Haze 切换 |
| Codemode / 按需工具搜索 | 提供 codemode、deferred、direct、hidden 曝光方式 | 现有适配器代理、脚本及工具选择 | 可作为后续功能；需统一工具权限和界面，不直接映射旧配置字段 |
| Haze 每次请求认证 | 公开 `createTransport` 可定制传输；默认请求头在创建传输时解析 | `requestHeadersCommand` 每次请求获取短期凭证，并校验插件身份和地址 | 必须补动态传输桥，不能把短期密钥写进静态请求头 |
| 持久插件按任务授权 | 有通用工具钩子 | `pi-mcp-adapter:tool-approval-request` 覆盖代理、直接、脚本和资源调用 | 必须按登记的服务归属重接所有路径，不能仅按工具名猜归属 |
| 连接状态、重连、登录 | SDK 有运行时状态及终端管理器 | `pi-mcp-adapter/status/v1` → Eureka 状态接口和页面 | 需要网页状态及授权流程适配，不能直接复用旧事件名 |
| 浏览器交接 | 结果保留标准结构化内容 | `plugin-browser.ts` 读取 `details.mcpResult` 并清除临时 `browser_url` | 原生 `details` 格式不同；需转换结果后再打开右侧浏览器，防止启动链接进入持久历史 |
| 旧 HTTP SSE / MCP Apps 等扩展 | 独立客户端的核心范围不等同于旧适配器全部扩展；Streamable HTTP 中的 SSE 响应不等于旧 SSE 传输 | 现有适配器的额外协议与应用界面能力 | 应先盘点实际配置，不能宣称全部可无损迁移 |

## 已执行验证

`tests/mcp/native-mcp-sdk.integration.test.mjs` 使用公开 `createMcpExtension()`、真实 `AgentSession`、原生 `McpClient` 和独立模拟 MCP 服务，3 项测试通过：

1. 完成 MCP 初始化与版本协商，发现工具、调用工具、读取资源，取消挂起请求并收到取消通知。
2. 原生直接工具进入真实 Agent 循环，参数 `"2"` 转换为数字 `2` 后才发给 MCP 服务，结果进入模型的下一回合。
3. `tool_call` 权限钩子拒绝时，服务端调用数为零，模型收到工具错误并结束。

同时运行现有 MCP 状态、插件选择、Haze 请求认证、浏览器交接及适配器加载回归。桌面资源另在项目目录外分阶段复制 165 个生产依赖包，SDK、原生 MCP 工厂、旧适配器和 QuickJS WASM 均可加载。

这些测试证明标准链路可用，不等同于已完成真实外部 MCP、OAuth 服务器或 MCP Apps 的整体验收。

## 后续迁移清单

按顺序处理，每一步完成后再扩大默认启用范围：

| 完成 | 编号 | 工作 | 验收要求 |
| --- | --- | --- | --- |
| [x] | M01 | Haze 原生传输桥 | 本地密钥重置、换账号、注销和取消验证完成；真实 Haze 凭证获取、两个服务连接及市场只读调用通过 |
| [x] | M02 | 原生工具与资源授权 | HTTP 出站及响应边界检查插件选择和工具权限；直接、Codemode、资源路径已测 |
| [x] | M03 | 状态与浏览器交接 | 原生传输状态进入网页；直接及 Codemode 浏览器结果已清理临时启动链接；真实页面待验收 |
| — | M04 | 旧配置与历史工具兼容 | 按用户本轮要求不做；新配置路径、保存与调用已接入 |
| [ ] | M05 | 真实服务验收与依赖清理 | 真实 Haze 认证、发现、市场只读及独立重连通过；Atlas 完整业务查询、断线恢复、安装包和旧依赖清理继续跟踪 |

真实认证与市场只读调用已通过。下一步可在有效 Atlas 业务会话中验证查询及选数页面，再完成桌面安装和旧依赖清理。

## 代码依据

- [原生 MCP 集成测试](../tests/mcp/native-mcp-sdk.integration.test.mjs)
- [当前适配器入口](../server/mcp/mcp-adapter.ts)
- [Haze 服务登记及动态认证](../server/mcp/haze-mcp-runtime.ts)
- [插件授权](../server/extensions/plugin-selection-runtime.ts)
- [网页连接状态](../server/mcp/mcp-runtime.ts)
- [浏览器交接](../server/extensions/plugin-browser.ts)
- [SDK 本地 MCP 文档](../node_modules/@earendil-works/pi-coding-agent/docs/mcp.md)
- [独立 MCP 客户端范围](../node_modules/@earendil-works/pi-mcp/README.md)
- [升级总清单](sdk-1.5-upgrade-checklist.md)
