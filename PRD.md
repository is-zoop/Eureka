# Pi Web 产品需求文档（PRD）

**版本：** v0.1  
**项目代号：** Pi Web  
**产品形态：** 基于 Pi SDK 的 Web Coding Agent  
**技术基线：** `pi-ai` + `pi-agent-core` + `pi-coding-agent`  
**UI：** 自研 Web UI，不依赖 `pi-tui`  
**第一阶段目标：** 实现 Pi Interactive 核心能力的 Web 版本

---

# 1. 项目背景

Pi 当前主要提供 Terminal Interactive/TUI 形态。

本项目希望复用 Pi 已有的 Agent 能力，包括：

- LLM Provider / Model
- Agent Loop
- Tool Calling
- Session
- Streaming
- Thinking
- Skills
- Prompt Templates
- Extensions
- Compaction
- Session Tree
- Fork / Clone
- Tool Execution

但不使用 `pi-tui`。

我们将开发一套独立 Web UI，使整体架构成为：

```text
                 pi-ai
                   │
                   ▼
            pi-agent-core
                   │
                   ▼
           pi-coding-agent
                   │
                   ▼
        AgentSessionRuntime
                   │
          ┌────────┴────────┐
          │                 │
       Pi TUI            Pi Web
                         自研 UI
```

Pi Web 与 Pi TUI 是同级 Presentation Layer。

---

# 2. 产品目标

构建一个可以在浏览器中使用的 Coding Agent Workspace。

用户能够：

1. 打开一个代码项目。
2. 与 Pi Agent 对话。
3. 实时查看模型输出。
4. 查看 Thinking。
5. 查看 Tool Call。
6. 查看 Bash 实时输出。
7. 查看文件读取、写入和修改。
8. 切换模型。
9. 调整 Thinking Level。
10. 管理 Session。
11. 中止当前 Agent 执行。
12. 管理 Context。
13. 使用 Compaction。
14. 引用项目文件。
15. 上传图片。
16. 后续支持 Session Tree、Fork、Clone、Skills、Extensions。

产品最终形态不是单纯 Chat UI，而是：

> **Web Coding Agent Workspace**

---

# 3. 非目标

V1 不要求：

- 复用 `pi-tui`
- 浏览器直接运行 Pi SDK
- 使用 `pi-server`
- 使用 `pi-client`
- 使用 `pi-protocol`
- 多用户协同
- 云端 Workspace 调度系统
- Kubernetes
- Firecracker
- 完整 IDE
- GitHub PR 自动化
- Extension 任意 Terminal Component 的 Web 兼容
- 100% TUI UI 样式复刻

功能语义需要与 Pi Interactive 接近，但 Web 应使用 Web Native UX。

---

# 4. 技术原则

## 4.1 Pi SDK 只能运行在服务端

浏览器不得直接运行：

```text
pi-coding-agent
pi-agent-core
pi-ai
```

整体架构：

```text
Browser
   │
   │ HTTP / WebSocket
   ▼
Pi Web Server
   │
   ▼
AgentSessionRuntime
   │
   ▼
AgentSession
   │
   ├─ tools
   ├─ skills
   ├─ extensions
   ├─ sessions
   └─ providers
```

---

## 4.2 主要依赖

核心：

```text
@earendil-works/pi-coding-agent
@earendil-works/pi-agent-core
@earendil-works/pi-ai
```

其中业务层优先围绕：

```text
pi-coding-agent
```

开发。

不要绕过 `pi-coding-agent` 自己重新实现 Agent Loop。

---

## 4.3 使用 AgentSessionRuntime

Web 的主要运行时对象应为：

```ts
AgentSessionRuntime
```

而不是直接管理：

```ts
Agent
```

原因：

Runtime 后续需要负责：

- newSession
- switchSession
- fork
- clone
- import
- cwd 变化
- active session replacement

---

## 4.4 Web 不直接依赖 Pi Event 类型

必须增加 Adapter 层：

```text
Pi AgentSessionEvent
        │
        ▼
PiEventNormalizer
        │
        ▼
WebEvent
        │
        ▼
WebSocket
        │
        ▼
Frontend Store
```

Pi SDK 升级时：

只允许主要修改 Adapter。

不要让 React 组件直接大量依赖 Pi 内部事件结构。

---

# 5. 推荐技术栈

## Frontend

推荐：

```text
React
TypeScript
Vite
Zustand
TanStack Query
React Router
Tailwind CSS
shadcn/ui
react-markdown
Shiki / highlight.js
Monaco Editor（P1）
```

也允许 Next.js，但不是必要条件。

首选：

```text
React + Vite
```

原因是 Backend 独立运行。

---

## Backend

```text
Node.js >= 22.19
TypeScript
Fastify / Hono
WebSocket
Zod
```

推荐 Fastify。

---

# 6. 项目结构

推荐 Monorepo：

```text
pi-web/
│
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── components/
│   │       ├── features/
│   │       │   ├── chat/
│   │       │   ├── tools/
│   │       │   ├── editor/
│   │       │   ├── sessions/
│   │       │   ├── workspace/
│   │       │   ├── model/
│   │       │   ├── context/
│   │       │   └── settings/
│   │       ├── stores/
│   │       ├── hooks/
│   │       └── lib/
│   │
│   └── server/
│       └── src/
│           ├── pi/
│           │   ├── runtime-manager.ts
│           │   ├── session-controller.ts
│           │   ├── event-normalizer.ts
│           │   ├── resource-loader.ts
│           │   └── model-service.ts
│           │
│           ├── websocket/
│           ├── workspace/
│           ├── api/
│           └── index.ts
│
├── packages/
│   ├── protocol/
│   │   └── src/
│   │       ├── commands.ts
│   │       ├── events.ts
│   │       └── schemas.ts
│   │
│   └── shared/
│
├── package.json
└── README.md
```

---

# 7. 页面整体布局

Desktop：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Logo │ Project ▾ │ Branch │                Model ▾ │ Thinking ▾ │ ⚙ │
├─────────────────┬─────────────────────────────────────┬─────────────┤
│                 │                                     │             │
│ PROJECT         │                CHAT                 │   CONTEXT   │
│                 │                                     │             │
│ Explorer        │ User                                │ Session     │
│                 │                                     │             │
│ src/            │ Assistant                           │ Context     │
│ package.json    │                                     │ Token       │
│                 │ ▼ Read src/auth.ts                  │ Cost        │
│ SESSIONS        │                                     │             │
│                 │ ▼ Bash npm test                     │             │
│ Fix login       │                                     │             │
│ Add tests       │ Response...                         │             │
│                 │                                     │             │
│                 ├─────────────────────────────────────┤             │
│                 │ @ context                           │             │
│                 │                                     │             │
│                 │ Ask Pi...                    Send ↑ │             │
├─────────────────┴─────────────────────────────────────┴─────────────┤
│ ~/project │ Ready │ Model │ High │ Context 62% │ Cost $0.31        │
└─────────────────────────────────────────────────────────────────────┘
```

主要区域：

```text
TopBar
LeftSidebar
ChatTimeline
PromptComposer
RightContextPanel
StatusBar
```

---

# 8. P0 —— MVP 功能

P0 是第一阶段必须完成的功能。

---

# 8.1 Workspace

## 功能

用户启动 Server 时指定 Workspace：

```bash
npm run dev -- --workspace /path/to/project
```

或者：

```env
PI_WEB_WORKSPACE=/path/to/project
```

Web 显示：

- Project 名称
- cwd
- 文件树

V1 不允许浏览服务器任意目录。

Workspace Root 一旦设置：

所有文件访问必须限制在 Workspace 内。

---

## 文件树

支持：

- 展开目录
- 收起目录
- 点击文件
- 文件图标
- 刷新
- 忽略 `.git`
- 忽略 `node_modules`
- 支持 `.gitignore`

点击文件：

打开 File Preview。

---

# 8.2 Chat Timeline

Timeline 必须支持不同类型内容。

建议内部模型：

```ts
type TimelineItem =
  | UserMessageItem
  | AssistantMessageItem
  | ThinkingItem
  | ToolExecutionItem
  | SystemEventItem;
```

不能只设计：

```ts
ChatMessage[]
```

---

# 8.3 User Message

显示：

```text
You
帮我检查一下这个项目为什么测试失败
```

支持：

- 文本
- 文件引用
- 图片

---

# 8.4 Assistant Streaming

要求：

模型生成过程中：

文本实时显示。

不能等待完整 response。

支持 Markdown：

- heading
- list
- table
- quote
- inline code
- code block
- links

代码块：

- Syntax Highlight
- Copy
- Language Label

---

# 8.5 Thinking

Thinking 独立显示：

```text
▼ Thinking

Need inspect package.json first...
```

默认：

```text
collapsed
```

Agent Streaming 时可实时更新。

设置：

```text
Show thinking by default
```

可以后续加入。

---

# 8.6 Agent Status

状态包括：

```ts
type AgentPhase =
  | "idle"
  | "running"
  | "compacting"
  | "retrying"
  | "error";
```

UI：

```text
● Ready
● Working
● Compacting
● Retrying
● Error
```

---

# 8.7 Abort

Agent 工作时：

Send 按钮变成：

```text
Stop
```

点击调用：

```ts
session.abort()
```

UI 必须立即进入：

```text
Stopping...
```

最终恢复：

```text
Ready
```

---

# 9. Prompt Composer

必须支持：

- 多行输入
- Enter 发送
- Shift + Enter 换行
- 输入过程中自动增高
- Agent Running 时仍可编辑
- Ctrl/Cmd + Enter 可作为可选发送快捷键

---

# 9.1 @ File Reference

输入：

```text
@
```

弹出：

```text
src/auth.ts
src/user.ts
README.md
package.json
```

支持 fuzzy search。

选择：

```text
@src/auth.ts
```

Composer 中渲染为 Token/Chip。

发送给 Agent 时转换为适当文本上下文。

V1 可以直接使用路径文本，例如：

```text
Please inspect @src/auth.ts
```

不要在 Browser 直接读取后把整个文件塞进 Prompt。

Agent 本身可使用 read tool。

---

# 9.2 Image

支持：

- 文件选择
- Clipboard paste
- Drag & Drop

支持格式：

```text
png
jpeg
webp
gif（如果 SDK/provider 支持）
```

发送时转换为 Pi `ImageContent`。

---

# 10. Tool Execution

这是核心功能。

必须建立：

```ts
ToolRendererRegistry
```

---

# 10.1 Tool Model

```ts
interface WebToolExecution {
  id: string;

  toolName: string;

  input: unknown;

  status:
    | "running"
    | "success"
    | "error";

  output?: unknown;

  startedAt?: number;
  finishedAt?: number;
}
```

---

# 10.2 Read Tool

展示：

```text
Read
src/auth.ts
```

展开：

显示源码。

要求：

- 行号
- Syntax Highlight
- Collapse
- Copy Path

---

# 10.3 Write Tool

展示：

```text
Write
+ src/new-file.ts
```

状态：

```text
Running
Success
Error
```

展开：

显示写入内容。

---

# 10.4 Edit Tool

必须使用 Diff UI。

例如：

```diff
- const timeout = 3000;
+ const timeout = 5000;
```

支持：

- added
- removed
- context
- 文件路径

---

# 10.5 Bash Tool

展示：

```text
Bash                   Running

$ npm test

PASS src/auth.test.ts
PASS src/api.test.ts
```

要求：

- 实时 streaming
- monospace
- 保留换行
- 大结果区域内部滚动
- Collapse
- Expand
- Copy

不能等 Bash 完成才一次性显示。

---

# 10.6 Unknown Tool

任何未知 Tool：

不得报错或导致页面崩溃。

Fallback：

```text
Generic Tool

Tool Name
Input JSON
Output JSON
Status
```

---

# 11. Model Selector

TopBar：

```text
Claude Sonnet 4 ▾
```

点击显示 Provider / Model。

例如：

```text
Anthropic
  Claude Sonnet
  Claude Opus

OpenAI
  GPT-5.x
```

功能：

- 查看 Available Models
- 当前 Model
- 切换 Model

调用：

```ts
session.setModel(...)
```

或者对应 SDK Runtime API。

---

# 12. Thinking Level

TopBar：

```text
Thinking: High ▾
```

支持 SDK 当前模型允许的级别。

不要硬编码模型支持能力。

UI 从 Backend 获取：

```text
availableThinkingLevels
```

例如：

```text
Off
Minimal
Low
Medium
High
XHigh
Max
```

只展示当前模型支持的值。

---

# 13. Session

左侧 Sidebar：

```text
SESSIONS

+ New Session

Fix login
Add tests
Refactor API
```

P0：

- New
- List
- Open / Resume
- Current Session
- Session Name
- 创建时间

---

# 13.1 New Session

点击：

```text
+ New Session
```

调用 Runtime：

```text
newSession()
```

Session Replacement 后必须：

1. 取消旧 session event subscription。
2. 重新订阅新 session。
3. 更新前端 snapshot。

---

# 13.2 Resume

点击 Session：

Server 调用 Runtime session switch/resume 能力。

Web 清空当前 timeline state。

随后返回：

```text
SessionSnapshot
```

Frontend 重新渲染历史记录。

---

# 14. Session Snapshot

连接 WebSocket 后，Server 必须发送完整 Snapshot。

例如：

```ts
interface WebSessionSnapshot {
  sessionId: string;

  sessionName?: string;

  cwd: string;

  phase: AgentPhase;

  model?: WebModel;

  thinkingLevel: string;

  messages: WebMessage[];

  context?: {
    usedTokens?: number;
    maxTokens?: number;
    percentage?: number;
  };

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cost?: number;
  };
}
```

Snapshot 是前端恢复状态的基础。

---

# 15. Context / Usage

右侧 Context Panel 显示：

```text
Context

████████████░░░░ 62%

124K / 200K


Usage

Input      83K
Output     11K
Cache      31K
Cost       $0.32
```

如果某 Provider 无法提供某字段：

显示：

```text
—
```

不要伪造数据。

---

# 16. Compaction

右侧：

```text
Compact Context
```

点击 Modal：

```text
Compact context

Instructions (optional)

[ Focus the summary on code changes ]

Cancel     Compact
```

调用：

```ts
session.compact(customInstructions)
```

执行期间：

```text
Compacting...
```

Chat Timeline 加一条：

```text
Context compacted
124K → 36K
```

如果 SDK 没有准确 after token 数据：

不要生成虚假数字。

---

# 17. WebSocket 协议

不要直接把 Pi SDK Event 原样暴露给前端。

建立自己的 protocol package。

---

# 17.1 Client → Server

```ts
type ClientCommand =
  | PromptCommand
  | AbortCommand
  | SetModelCommand
  | SetThinkingLevelCommand
  | CompactCommand
  | NewSessionCommand
  | SwitchSessionCommand;
```

---

## Prompt

```ts
interface PromptCommand {
  id: string;

  type: "prompt";

  text: string;

  images?: {
    mimeType: string;
    data: string;
  }[];
}
```

---

## Abort

```ts
interface AbortCommand {
  id: string;
  type: "abort";
}
```

---

## Model

```ts
interface SetModelCommand {
  id: string;

  type: "set_model";

  provider: string;
  modelId: string;
}
```

---

## Thinking

```ts
interface SetThinkingLevelCommand {
  id: string;

  type: "set_thinking_level";

  level: string;
}
```

---

## Compact

```ts
interface CompactCommand {
  id: string;

  type: "compact";

  instructions?: string;
}
```

---

# 17.2 Server → Client

```ts
type ServerEvent =
  | ConnectedEvent
  | SnapshotEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ThinkingDeltaEvent
  | ToolStartEvent
  | ToolUpdateEvent
  | ToolEndEvent
  | AgentStatusEvent
  | UsageEvent
  | ErrorEvent;
```

---

# 17.3 Example

```json
{
  "type": "tool_start",
  "tool": {
    "id": "tool_123",
    "name": "bash",
    "input": {
      "command": "npm test"
    }
  }
}
```

Update：

```json
{
  "type": "tool_update",
  "toolId": "tool_123",
  "delta": "PASS src/auth.test.ts\n"
}
```

End：

```json
{
  "type": "tool_end",
  "toolId": "tool_123",
  "success": true
}
```

---

# 18. Backend 核心模块

---

# 18.1 PiRuntimeManager

职责：

- 初始化 ModelRuntime
- 初始化 ResourceLoader
- 初始化 AgentSessionRuntime
- 当前 Runtime 生命周期
- Runtime dispose

接口建议：

```ts
class PiRuntimeManager {
  initialize(): Promise<void>;

  getRuntime(): AgentSessionRuntime;

  dispose(): Promise<void>;
}
```

---

# 18.2 PiSessionController

所有 Web Action 必须通过 Controller。

不要让 WebSocket Handler 直接大量操作 SDK。

```ts
class PiSessionController {
  prompt(...): Promise<void>;

  abort(): Promise<void>;

  compact(...): Promise<void>;

  setModel(...): Promise<void>;

  setThinkingLevel(...): Promise<void>;

  newSession(): Promise<void>;

  switchSession(...): Promise<void>;
}
```

---

# 18.3 PiEventNormalizer

职责：

```text
AgentSessionEvent
      ↓
WebEvent
```

必须处理：

```text
message_start
message_update
message_end

tool_execution_start
tool_execution_update
tool_execution_end

agent_start
agent_end

queue_update

compaction_start
compaction_end

auto_retry_start
auto_retry_end
```

不支持的 Pi Event：

可以记录 log。

不能导致 Server Crash。

---

# 18.4 ModelService

职责：

- 获取 Provider
- 获取 Available Models
- 获取 Thinking Levels
- 当前 Model
- 切换 Model

Frontend 不直接理解 Pi Model 对象全部字段。

转换：

```text
Pi Model
  ↓
WebModel
```

例如：

```ts
interface WebModel {
  provider: string;
  id: string;
  name: string;

  supportsThinking: boolean;

  contextWindow?: number;
}
```

---

# 19. Frontend State

推荐 Zustand。

Store 拆分：

```text
workspaceStore
sessionStore
timelineStore
agentStore
modelStore
uiStore
```

避免一个巨大 Store。

---

# 20. Timeline Streaming

Streaming 时不能每一个 token 都导致整个聊天页面重新 render。

实现必须：

- 使用局部 state
- batching
- requestAnimationFrame 或合理 debounce
- 保证长输出不卡顿

目标：

至少能够处理：

```text
数万字符 streaming
数百个 timeline items
```

而页面仍正常滚动。

---

# 21. 自动滚动

规则：

用户位于底部：

```text
新内容 → 自动跟随
```

用户主动向上滚动：

```text
新内容 → 不抢滚动
```

显示：

```text
↓ Jump to latest
```

---

# 22. Error Handling

所有错误必须转换成统一 Web Error。

例如：

```ts
interface WebError {
  code: string;
  message: string;

  recoverable: boolean;

  details?: unknown;
}
```

UI：

```text
Something went wrong

Rate limit exceeded.

Retry
```

不要把完整 stack trace 暴露给普通 UI。

开发模式可通过 Console 查看。

---

# 23. Reconnect

WebSocket 断开：

Frontend：

```text
Reconnecting...
```

重新连接成功：

Server 发送完整：

```text
SessionSnapshot
```

Frontend 以 Snapshot 为准恢复。

不要依靠错过的增量事件恢复。

---

# 24. Security

即使 V1 是本地版本，也必须设置基本安全边界。

---

## Workspace Path

所有文件请求：

必须验证路径属于：

```text
workspaceRoot
```

禁止：

```text
../../etc/passwd
```

等 path traversal。

---

## Host Binding

开发默认：

```text
127.0.0.1
```

不要默认：

```text
0.0.0.0
```

公网暴露。

---

## Credentials

API Key：

不得返回给 Browser。

Frontend 最多知道：

```text
configured: true
```

不能知道：

```text
sk-xxxx
```

---

# 25. P1 功能

P0 稳定后开发。

---

## 25.1 Steer

Agent Running 时：

用户可选择：

```text
Steer
```

行为：

调用：

```ts
session.steer(...)
```

UI：

```text
⚡ Steering

Do not modify login.ts.
```

---

## 25.2 Follow-up

Agent Running 时：

用户可以：

```text
Follow up
```

UI：

```text
⏳ Follow-up

After finishing, add tests.
```

调用：

```ts
session.followUp(...)
```

---

## 25.3 Queue Panel

显示：

```text
Queued Messages

⚡ Steering
Don't change auth.ts

⏳ Follow-up
Run tests afterwards
```

---

# 25.4 Session Tree

提供独立页面或 Drawer：

```text
Conversation Tree

● User
│
● Assistant
│
● User
├─────────────┐
│             │
● Branch A    ● Branch B
```

支持：

- navigate
- search
- label
- continue from node

---

# 25.5 Fork

选择历史 User Message：

```text
Fork from here
```

Runtime 创建新 Session。

新 Session 应显示来源：

```text
Forked from Fix login
```

---

# 25.6 Clone

支持 Clone 当前 Active Branch。

---

# 25.7 Skills

Settings：

```text
Skills

✓ skill-a
✓ skill-b
```

Composer：

输入：

```text
/skill:
```

出现自动完成。

---

# 25.8 Prompt Templates

输入：

```text
/
```

展示：

```text
/review
/refactor
/test
```

---

# 25.9 Slash Commands

至少支持 UI 映射：

```text
/model
/settings
/new
/resume
/tree
/fork
/clone
/compact
```

Web 操作按钮与 Slash Command 应调用同一个业务 Controller。

---

# 25.10 Git Panel

左 Sidebar：

```text
Git

M src/auth.ts
M src/user.ts
A src/token.ts
```

点击查看 Diff。

P1 仅要求：

```text
status
diff
branch
```

不要求：

```text
commit
push
PR
```

---

# 25.11 File Diff

Agent 修改文件后：

提供：

```text
View Diff
```

展示：

```diff
- old code
+ new code
```

---

# 26. P2 功能

---

# 26.1 Extensions

支持加载 Pi Extension。

Settings：

```text
Extensions

✓ example-extension
✓ github-extension
```

支持 Reload。

---

# 26.2 Extension UI Adapter

Web 实现：

```text
select
confirm
input
editor
notify
setStatus
setWidget
```

对应：

```text
select      → Modal
confirm     → Confirm Dialog
input       → Input Dialog
editor      → Monaco Dialog
notify      → Toast
setStatus   → Status Bar
setWidget   → Widget Area
```

---

# 26.3 Import / Export

支持：

```text
Session JSONL Import
Session Export
HTML Export
```

---

# 26.4 Provider Settings

支持：

```text
OpenAI
Anthropic
Google
...
```

显示：

```text
Configured
Not configured
```

支持设置 API Key。

保存策略后续决定。

默认推荐：

本地 Server credential storage。

---

# 26.5 Multi-user

仅 P2 / Production 阶段考虑。

加入：

```text
User
Workspace
Session Ownership
Credential Ownership
```

---

# 26.6 Sandbox

生产部署前必须实现。

目标：

```text
Agent
不能直接访问 Host
```

建议：

```text
Docker
```

后续可升级：

```text
gVisor
Firecracker
Kubernetes Pod
```

---

# 27. P0 验收标准

MVP 完成的定义：

## Workspace

- 能指定一个项目目录启动。
- Web 可以正确显示文件树。
- 文件树不能越过 Workspace Root。

## Chat

- 可以发送 Prompt。
- Assistant 文本实时 Streaming。
- Markdown 正常。
- Code Block 正常。
- 长输出不会明显卡死。

## Thinking

- Thinking 可以实时显示。
- Thinking 可折叠。

## Tool

必须完整支持：

```text
read
write
edit
bash
```

其中：

- Bash 实时输出。
- Edit 展示 Diff。
- Unknown Tool 有 fallback。

## Agent

- 能显示 Idle/Running/Error。
- 能 Abort。

## Model

- 可以获得可用模型。
- 可以切换模型。
- 可以设置 Thinking Level。

## Session

- New Session 可用。
- Session List 可用。
- Resume Session 可用。
- 切换 Session 后 history 正确恢复。

## Context

- 可显示 SDK 可以提供的 Usage。
- Compact 可执行。

## Image

- 可以上传图片发送给支持图片的模型。

## Reconnect

- 刷新页面后可以恢复当前 Session。
- WebSocket 重连后可以恢复 Snapshot。

---

# 28. 性能目标

本地场景：

页面首次加载：

```text
< 2 秒
```

正常 LAN 情况下 Prompt 操作 UI 响应：

```text
< 100ms
```

Streaming UI：

建议：

```text
30–60fps 范围内更新
```

无需逐 token 立即重新绘制完整页面。

支持：

```text
500+ timeline entries
100k+ 文本字符
```

不会导致明显浏览器冻结。

---

# 29. 开发顺序

Codex 严格按照下面顺序实现。

---

## Milestone 1 —— SDK Spike

目标：

只验证 Pi SDK。

实现 CLI/Server Test：

```text
create runtime
create session
send prompt
receive events
tool execution
abort
```

暂时不开发完整 UI。

完成后记录 Pi Event Shape。

---

## Milestone 2 —— Protocol

创建：

```text
packages/protocol
```

定义：

```text
ClientCommand
ServerEvent
SessionSnapshot
WebModel
WebToolExecution
```

使用 Zod 做 runtime validation。

---

## Milestone 3 —— Backend

实现：

```text
PiRuntimeManager
PiSessionController
PiEventNormalizer
ModelService
WebSocketGateway
```

达到：

浏览器外的 WebSocket 测试客户端可以：

```text
prompt
stream
abort
set model
compact
new session
resume
```

---

## Milestone 4 —— Web Skeleton

实现：

```text
TopBar
LeftSidebar
ChatArea
PromptComposer
ContextPanel
StatusBar
```

先不要过度设计 UI。

---

## Milestone 5 —— Chat

实现：

```text
User Message
Assistant Streaming
Thinking
Markdown
Code Block
Auto Scroll
```

---

## Milestone 6 —— Tools

实现：

```text
ToolRendererRegistry
Read
Write
Edit
Bash
Generic
```

这是 MVP 最重要阶段之一。

---

## Milestone 7 —— Sessions

实现：

```text
Session List
New Session
Resume
Snapshot Recovery
```

---

## Milestone 8 —— Models / Context

实现：

```text
Model Selector
Thinking Selector
Usage
Cost
Compact
```

---

## Milestone 9 —— Files / Images

实现：

```text
Explorer
File Preview
@file
Image
Clipboard
Drag Drop
```

---

## Milestone 10 —— Hardening

实现：

```text
Reconnect
Error Boundary
Path Security
Large Output
Cleanup
Tests
```

---

# 30. 测试要求

Backend：

```text
Vitest
```

必须覆盖：

```text
Event Normalizer
WebSocket Protocol
Session replacement
Abort
Model switching
Path validation
Unknown events
Unknown tools
Reconnect snapshot
```

Frontend：

至少测试：

```text
Timeline reducer
Tool renderer fallback
Streaming append
Session switching
Composer behavior
```

---

# 31. Coding Rules

Codex 开发时必须遵守：

1. TypeScript Strict。
2. 禁止大量 `any`。
3. Pi SDK 与 Web 类型之间必须存在 Adapter。
4. UI 不直接依赖 Pi SDK。
5. WebSocket Handler 不直接包含业务逻辑。
6. Session 生命周期必须集中管理。
7. Tool UI 必须可扩展。
8. 未知 Tool 不得导致 Crash。
9. 未知 Pi Event 不得导致 Crash。
10. 所有 unsubscribe / dispose 都必须正确执行。
11. Session replacement 后必须重新 subscribe。
12. 浏览器刷新后必须可以通过 Snapshot 恢复。
13. 所有文件访问必须限制在 Workspace Root。
14. API Key 不允许发给前端。
15. 不要为了“功能相同”复制 Terminal UX。
16. 优先做能力 parity，不做像素级 TUI parity。

---

# 32. 首版明确不使用

除非遇到 SDK 明确无法完成的能力，否则 V1 不引入：

```text
@earendil-works/pi-tui

@earendil-works/pi-client

@earendil-works/pi-protocol

@earendil-works/pi-server
```

V1 直接：

```text
Web Backend
   ↓
pi-coding-agent SDK
```

---

# 33. 产品最终方向

第一阶段：

```text
Pi Web Chat
+
Tool UI
+
Session
+
Files
```

第二阶段：

```text
Pi Web Coding Workspace
+
Tree
+
Git
+
Skills
+
Commands
```

第三阶段：

```text
Full Pi Web
+
Extensions
+
Sandbox
+
Multi-user
```

长期产品体验目标：

> 用户拥有 Pi Terminal 版本的 Agent 能力，但能够利用 Web 的文件浏览、Diff、Tree、Modal、Panel、富媒体和可视化优势完成 Coding Agent 工作流。

最终不应只是：

```text
Pi + Chat UI
```

而应该逐步成为：

```text
Pi SDK
+
Agent Workspace
+
Code Explorer
+
Diff Viewer
+
Session Tree
+
Tool Console
```

---

# 34. Codex 第一条执行指令

开始编码时，不要一次实现整个产品。

第一步只执行：

```text
1. 初始化 monorepo。
2. 安装 pi-ai、pi-agent-core、pi-coding-agent。
3. 创建 apps/server。
4. 创建最小 PiRuntimeManager。
5. 创建 AgentSessionRuntime。
6. 建立 session.subscribe。
7. 实现最简单的 WebSocket。
8. 浏览器发送 prompt。
9. Server 调用 Pi SDK。
10. 将 text_delta 返回 Browser。
11. Browser 实时渲染文本。
```

完成以上闭环以后，再开始 Tool UI、Session、Model 等模块。

禁止在 SDK Spike 尚未成功时提前开发大量 UI。