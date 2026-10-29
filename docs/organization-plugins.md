# 组织插件

Eureka 从当前 Haze 能力市场获取 `Plugin`，复用现有列表、详情和 `access-prompt` 原包下载接口，不要求 Haze 增加接口。支持项目和全局安装；同一 Haze 来源和能力 ID 的项目安装覆盖全局安装，项目停用也覆盖全局启用。卸载项目安装后恢复全局配置。

## 包格式 v1

ZIP 中包含一个插件根目录（也支持无外层目录），保留完整技能、规则和图标：

```text
atlas-ask-eureka/
  plugin.json
  package.json
  mcp.json
  skills/atlas-ask/SKILL.md
  skills/atlas-menu/SKILL.md
  references/current-rules.md
  assets/atlas.png
```

`plugin.json` 使用 Agent Plugins 1.0 基础格式，并声明 Eureka 宿主配置：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "atlas-ask",
  "version": "2.1.0",
  "extensions": {
    "com.eureka": {
      "schemaVersion": 1,
      "displayName": "Atlas数据助手",
      "icon": "./assets/atlas.png",
      "auth": { "atlas": { "provider": "haze-personal-credential" } }
    }
  }
}
```

`com.eureka` 为 Eureka 宿主约定，不属于 Agent Plugins 标准字段。认证键必须对应 `mcpServers` 中的服务名称。未声明认证的服务匿名连接；其他认证提供者不支持。

可选 `extensions.com.eureka.capabilities.requestUserInput: true` 声明使用宿主问题澄清工具；该字段必须为布尔值，缺省为关闭。安装准备、登记和活动会话快照保留声明，安装确认及详情显示能力。只在通过插件或所属技能入口调用的当前任务开放，不因安装而影响普通聊天。日常澄清开关、回答及重试协议和可交给 Atlas 的配置修改说明见 [通用问题澄清](clarification.md)。Haze 接口及 MCP 认证契约不变。

```json
{
  "name": "atlas-ask",
  "version": "2.1.0",
  "pi": { "skills": ["./skills"] }
}
```

`package.json` 的名称和版本必须与 `plugin.json` 及 Haze 发布版本一致。`pi` 仅声明技能目录，不配置 `pi.mcp`，也不登记成普通 Pi package，以免重复发现。Eureka 不执行 npm 安装或安装脚本。

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "atlas": { "type": "streamable-http", "url": "https://atlas.example/api/mcp" }
  }
}
```

首期 MCP 只接受 `type` 和 `url`。不接受 OpenAI 认证扩展、包内请求头、密钥或凭证读取命令。远程地址使用无用户信息、查询参数或片段的 HTTPS URL；本机 localhost/127.0.0.1/::1 的 HTTP 在开发和生产模式均允许，仍需确认服务地址。本机地址指 Eureka 服务端所在环境，容器或远程部署中不代表浏览器所在电脑。包内 `development_only` 是发行用途标记，不控制此地址校验，无需改为 false 才能测试。Skill-only 插件可以省略 `mcp.json`，但仍需 Eureka 清单和 `pi.skills`。

不支持 Codex/Claude 专属清单、hooks、stdio、JS 扩展或其他 Pi 组件。ZIP 限制为 100 MiB、10,000 个条目、解压后 200 MiB；拒绝链接、重复路径、Windows 特殊路径和损坏内容。

## 安装和认证

安装对话框先请求 `POST /api/organization-extensions/:id/installation`，使用 `type: "Plugin", action: "prepare", operation: "install" | "update", cwd, scope`。返回十分钟有效的 `preparationToken`、摘要、组件及服务地址，不返回本地路径或凭证。

仓库自带的插件登记文件属于需要信任的项目资源，不会因打开仓库而自动加载。对原本没有其他待信任资源的项目，显式确认项目插件安装会记录项目信任；已有未受信任项目资源仍需先通过现有项目信任入口授权。

用户确认需要认证的完整 MCP 地址后，提交相同接口，使用 `action: "install" | "update", preparationToken, approveAddresses`。准备凭据绑定 Haze 来源、当前用户、能力 ID、cwd、范围、操作、版本和包摘要。提交安装的是准备阶段的同一份包，不再下载替代内容。

Eureka 在连接层获取当前 Haze 用户的个人凭证。凭证钩子每次校验实际地址、来源和用户；账号切换或退出后拒绝旧身份的请求。新账号需从插件“更新”入口重新准备并确认地址。包不能读取凭证库、指定命令或获取原始密钥。连接参数及安装记录不保存密钥。

网页和 MCP 子进程共享宿主的加密登录状态，跨进程文件锁串行处理 refresh token 轮换。短期 OAuth access token 只保存在宿主加密状态中，浏览器 Cookie 不携带 access token。Cookie 通过独立登录标识引用当前状态，旧 Cookie 不会覆盖已轮换的令牌，也不能恢复退出前或其他账号的登录。每次 MCP 请求仍向 Haze 获取当前个人凭证，以识别凭证重置。

升级到该共享认证机制后需重新登录 Eureka 一次；先前已经失效的 refresh token 无法通过重装插件恢复。重新登录后在原对话重试，复用已有 Atlas 业务会话和选数范围。

## 更新和运行状态

每次发布内容变化必须提升 Haze 及包内版本号。Eureka 以 Haze 版本判断更新；本地 ZIP SHA-256 用于内容识别和准备包防替换，不是 Haze 提供的发布方校验值。

相同用户且地址不变时，更新复用已有地址授权；新增或变更认证地址需要重新确认。更新保留范围、停用状态和运行配置，准备或提交失败不替换原安装。

新会话加载最新配置，已有会话需在空闲时点击组织扩展中的“重载”。不自动打断运行。Skill 使用现有 SDK，MCP 使用现有 adapter；MCP 名称按来源、能力 ID 和原服务名隔离。同名 Skill 保留已有资源并报告诊断。

详情显示已安装、待重载、已加载、待认证或失败；没有活动会话时不显示已加载。插件子技能由所属插件统一管理，不能单独通过技能开关修改包内文件。

命令菜单的插件条目仅显示名称和业务说明，版本、运行状态及组件清单保留在详情中。企业安装的插件、独立 Skill、MCP 以及插件子能力统一使用企业扩展图标。技能图标按登记的实际资源路径匹配所属能力，不按名称猜测归属；同名本地技能不会套用企业图标。未配置图标或图片加载失败时显示对应类型的默认图标。

命令菜单和选中标签的显示名称省略 `/`、`skill:` 前缀；搜索和调用仍使用原始命令标识。选中的技能命令在输入框中显示为“图标 + 技能名称”标签，标签嵌在正文首行，光标及补充请求紧接标签右侧；换行后正文使用输入框全宽。点击 × 或在正文开头按退格可移除命令并保留请求文字。标签只改变显示，草稿和提交仍保存原始 `/skill:<name> 参数` 格式，因此失败恢复、排队及原有技能展开协议不变。

更新使用新的不可变目录，活动会话暂时保留旧目录；重载或会话结束且无引用后清理。该机制不提供历史版本或回滚入口。卸载不取消 Atlas 的后台查询，也不清除业务会话和选数范围。

## 验收

离线包与安装测试覆盖准备绑定、地址授权、包校验、版本冲突、作用域、并发写入及资源清理。实际联调需 Atlas 生成 Eureka 包后上传 Haze，再在 Eureka 中完成安装、MCP 连接、当前对话选数和真实查询；离线测试不代表此项已通过。


输入框插件选择和右侧真实浏览器的使用、部署及链接接管契约见 [组织插件选择与内置浏览器](./browser-workspace.md)。组织插件仍仅加载 Skill 与 HTTP MCP，不需要在包内增加 JS、hooks 或 CLI。
## 输入框持续选择

在 `plugin.json` 的 `extensions.com.eureka` 中增加：

```json
"composer": {
  "selectionMode": "persistent"
}
```

支持 `once`（默认）与 `persistent`。常驻插件需要用户主动选择，发送后标签保留在输入框上方，后续每条提交继续携带已选择的插件；模型按任务读取其 Skill、使用已授权 MCP 和宿主能力，不因选中就强制调用。用户移除后，后续任务不再应用该插件规则。运行中、排队中以及等待澄清回答的任务保留接纳时的选择，移除标签不撤销这些已提交任务。

常驻选择按 Eureka 对话保存在本设备浏览器，只保存来源、账号、能力 ID、包摘要及名称等公开引用，不保存正文、凭证或 MCP 启动链接。新对话不继承其他对话的选择；新建对话转为实际会话时迁移选择。切换账号或 Haze 来源时清除旧身份的选择。插件停用、卸载、版本变化或未重载会话时，保留可移除标签并提示检查，不静默切换到其他版本。

服务端独立校验实际安装与任务归属，客户端的 `selectionMode` 不构成授权。常驻插件的 MCP 调用由适配器提供的实际服务器身份检查，覆盖代理、直接调用、脚本和资源调用；未在当前任务中选择时拒绝调用，也阻止通过原生读取工具载入其规则文件。宿主给模型注入当前选择范围，历史插件说明不继续授予使用权限。完全禁用工具与既有 MCP 审批策略保持有效，选择插件不绕过它们。

正式发布须把字段写入产物并同步提升 `plugin.json`、`package.json` 与 Haze 发布版本。为本机测试，也允许读取已登记安装目录中经过路径、清单身份和字段校验的 `composer` 修改；这种本地覆盖只影响选择方式，不修改登记的认证地址、能力授权或包摘要。更新、重装会覆盖本地修改。新增宿主逻辑部署后重启 Eureka 服务并刷新页面；只更新插件包时，活动会话执行“重新加载”后生效。
