# Pi Web 开发里程碑

> 状态说明：`[x]` 已开发并通过基础验证；`[ ]` 尚未开发或仅有规划。

## Milestone 1：Pi SDK Spike

- [x] Pi SDK 服务端集成验证：确认可创建 Runtime 与 Session、发送 Prompt、接收流式事件。
- [x] 工具执行与中止验证：确认 Pi 工具事件可流转，`abort()` 可中止执行。
- [x] Session 替换订阅验证：切换 Session 时取消旧订阅并重新订阅新 Session。
- [x] Pi 事件映射记录：为后续 Web 协议与事件标准化提供依据。

## Milestone 2：共享 WebSocket 协议

- [x] `packages/protocol`：使用 Zod 定义前后端共享 JSON 协议。
- [x] Client Commands：Prompt、中止、模型、Thinking、Compaction、Session、文件命令。
- [x] Server Events：Snapshot、消息流、Thinking、工具流、状态、用量、文件与错误事件。
- [x] 协议安全解析：未知字段、错误 payload 和非 JSON-safe 数据安全拒绝。

## Milestone 3：本地 Pi Backend

- [x] 本地 Fastify + WebSocket 服务：默认仅绑定 `127.0.0.1:3001`。
- [x] Pi Runtime 管理：持久化 Session、单控制连接、Session 重新订阅和服务关闭清理。
- [x] Pi Event Normalizer：将 Pi 原始事件转换为稳定 WebEvent，不泄露凭据或内部异常。
- [x] 命令控制器：安全分发 Prompt、Abort、模型、Thinking、Compaction 与 Session 命令。

## Milestone 4：React Web Skeleton

- [x] 深色桌面工作台布局：TopBar、Sidebar、Chat、ContextPanel、StatusBar。
- [x] WebSocket 初始连接与 Snapshot 渲染。
- [x] 窄屏提示：小于桌面宽度时显示简化提示。

## Milestone 5：Chat、流式回复与 Thinking

- [x] Prompt Composer：多行输入、Enter 发送、Shift+Enter 换行、运行中 Stop。
- [x] 用户消息乐观显示与 Pi Assistant 流式文本显示。
- [x] Thinking 增量显示。
- [x] 安全 Markdown：支持 GFM 表格、列表、引用、链接、行内代码与代码块；通过 sanitize 过滤不安全 HTML。
- [x] 代码块复制与 Thinking 默认折叠。
- [x] 用户停留在底部时自动跟随最新消息。
- [x] “Jump to latest” 按钮：上滚时停止自动跟随，点击后回到最新消息并恢复跟随；Snapshot 重建后默认定位到最新内容。

## Milestone 6：工具执行 Timeline

- [x] 工具开始、增量、结束事件映射。
- [x] 通用工具活动卡片：可展开与复制。
- [x] 工具输出安全截断，单项最多 1 MiB。
- [x] Read 专用代码预览与行号：展开时惰性加载 Shiki，高亮失败安全回退为等宽行号文本。
- [x] Write 专用写入内容视图：展示目标路径与安全内容。
- [x] Edit 专用 Diff 视图：按新增、删除与上下文行渲染轻量 Diff。
- [x] Bash 实时输出专用卡片：保留换行、内部滚动、复制与安全截断提示。
- [x] Tool renderer registry：按 `read`、`write`、`edit`、`bash` 不区分大小写选择视图；未知工具回退为通用 JSON 卡片。

## Milestone 7：Session List、New 与 Resume

- [x] 当前 workspace 的持久化 Session 列表。
- [x] 新建 Session、恢复历史 Session、当前 Session 高亮。
- [x] 切换后重新绑定订阅、返回 Snapshot 并刷新列表。
- [x] Agent 运行时禁止新建或切换 Session。
- [ ] Session 重命名、删除、Fork、Clone 与树形会话。

## Milestone 8：模型、Thinking、Context 与 Compaction

- [x] 仅展示当前 Provider 实际可用的模型。
- [x] 仅展示当前模型支持的 Thinking Level。
- [x] Agent idle 时切换模型与 Thinking；运行时安全拒绝。
- [x] Context、Input、Output、Cache、Cost 的真实数据展示；未知值显示 `—`。
- [x] 手动 Compaction 弹窗与可选 instructions。
- [x] Compaction 状态与完成系统消息。
- [ ] 自动 Compaction 设置界面。

## Milestone 9：Workspace 文件、`@` 引用与图片

- [x] Workspace Explorer：目录展开、收起、刷新与文件预览。
- [x] 文件访问安全边界：相对路径校验、canonical path、外部 symlink 拒绝。
- [x] 文件过滤：隐藏文件、`.git`、`node_modules` 与 `.gitignore` 规则。
- [x] 文本和常见图片预览；二进制/超限文件安全降级。
- [x] `@文件` 本地搜索与相对路径插入。
- [x] 图片选择、粘贴、拖拽与预览；支持 PNG/JPEG/WebP/GIF，单张最多 20 MiB。
- [ ] 文件编辑、保存、PDF/Office 预览。

## Milestone 10：可靠性、安全与测试加固

- [x] WebSocket 自动重连：指数退避、抖动与 Snapshot 恢复。
- [x] 页面连接状态与断线时控制禁用。
- [x] React Error Boundary 与安全错误提示。
- [x] WebSocket 入站 payload 限制：30 MiB。
- [x] 服务关闭时控制 socket 与 Pi Runtime 清理。
- [x] Protocol、Server、Web 基础自动化测试与生产构建验证。
- [x] 统一测试入口：`npm test` 串行运行 protocol、server 与 web 测试。
- [x] 前端连接状态测试：覆盖重连退避、Snapshot 覆盖与 Usage 合并。
- [x] 前端组件基础测试：Error Boundary 安全 fallback、ToolCard 展开/收起与 Clipboard 降级。
- [x] 前端交互逻辑测试：`@` 文件引用、图片类型/大小校验、Timeline 流式追加与 Session 切换状态。
- [x] WebSocket Gateway 集成测试：Fake Runtime、初始事件顺序、坏 JSON、控制连接替换与服务关闭清理。
- [ ] WebSocket 端到端扩展覆盖：超限帧、二进制帧与服务重启后的浏览器自动恢复。
- [ ] 前端端到端组件测试：Mock WebSocket 驱动 Composer、Explorer、Preview 与完整 AppShell 联动。

## UI/UX 重构：Notion 风格工作台

- [x] Light Theme design tokens：统一颜色、边界、圆角与内容排版。
- [x] 双栏信息架构：移除常驻 Context 右栏与状态栏，Conversation 为页面主内容。
- [x] 轻量 Sidebar：New chat、Session 与 Files 采用紧凑列表层级。
- [x] Composer 上下文：模型、Thinking、连接状态与附件操作移动至输入区。
- [x] 按需信息面板：Context Popover、File Side Peek 与 Light Compact Dialog。
- [x] Tool Timeline 轻量化：默认紧凑活动行，展开后展示 Read/Write/Edit/Bash 详情。
- [x] 前端入口职责拆分：`App.tsx` 负责连接与状态，`components/workspace.tsx` 承担工作台展示。

## 后续 P1 功能

- [ ] Steering：Agent 执行时插入引导消息。
- [ ] Follow-up：Agent 完成后排队执行后续消息。
- [ ] Queue Panel：查看、编辑和清空待执行消息。
- [ ] Session Tree、Fork、Clone。
- [ ] Skills、Prompt Templates、Slash Commands。
- [ ] Git Panel 与完整 File Diff。

## 后续 P2 功能

- [ ] Extensions 与 Extension UI Adapter。
- [ ] Session 导入/导出。
- [ ] Provider Settings 管理界面。
- [ ] 多用户协作与鉴权。
- [ ] 容器或沙箱级工具隔离。
