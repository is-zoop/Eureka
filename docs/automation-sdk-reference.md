# 自动化 SDK 功能实现与限制

核对日期：2026-11-16。对应当前工作区源码。
SDK 能力契约版本：1.3.0；能力、方法、限制与运行时共用 automation-sdk-contract.json。

用于确认自动化需求是否能实现、如何调用已有能力，以及失败时应修代码、补配置、等待用户还是扩展宿主。运行时能力以实际加载的后端和桌面二进制为准。

生成器先调用 `eureka_automation_task {}` 获取任务和章节索引；随后可用 `eureka_automation_task {sdkSection:"http"}` 等按需查询。章节查询不会执行应用，也不重复返回整个草稿。

本文件由 `features/automation/sdk/automation-sdk-reference.json` 与 `renderAutomationSdkReference()` 生成，与模型按章节读取的内容共用同一份参考数据。

| 章节 ID | 功能 |
| --- | --- |
| overview | 能力总览与生成前检查：区分创建工具、应用运行时和桌面原生能力，先确认需求能否实现。 |
| authoring | 创建阶段工具：6 个创建工具：轻量任务、按需代码读取、增量修改与只读探索；测试仅人工运行。 |
| package | 应用包界面与多功能声明：完整文件清单、受支持的 UI 字段、流程图和独立动作。 |
| core | 入口步骤日志等待与用户询问：ctx 基础接口、真实步骤的实现、JSON 数据和等待语义。 |
| files | 文件读取写入与产物下载：文件引用、工作区、授权读写、ZIP 解压、文本编码和本地保存。 |
| formats | 文件格式依赖与签名能力缺口：区分可读字节、可解析业务格式与已实现的库，避免手写大型兼容层。 |
| tables | CSV/XLSX 表格服务：宿主侧流式批量读写、列类型、多工作表、格式与公式缓存；不执行公式。 |
| browser | 网页观察定位读取与操作：固定 DOM 适配器、网站范围、读写操作、登录及验证。 |
| checkpoints | 长任务检查点与显式恢复：批次边界保存 JSON 进度，由用户显式恢复并重新校验身份和输入。 |
| http | 会话 API 协议参数鉴权与签名：声明式会话 API、应用隔离凭证、multipart 文件上传、受控只读重定向和原生签名。 |
| ai | 固定 AI 规则、分类模型与图片输入：聊天与分类操作、完整规则模板、输出类型及图片/调用预算。 |
| validation | 仅人工测试、结果隔离与持续保存：人工运行与结果查看只在应用界面；保存后同一任务继续增量修改。 |
| limits | 大小并发与超时限制汇总：区分各阶段限制，避免把文件大小上限误当作结果或工具返回上限。 |
| recovery | 常见阻塞与正确恢复方式：按失败层处理：代码冲突读取当前片段，执行问题交人工反馈，不自动重放。 |
| recipe | 可靠生成顺序与最小入口示例：按需读取、增量写入、人工运行和持续保存，减少上下文中的重复代码与数据。 |

## overview 能力总览与生成前检查

这里的 SDK 是 Eureka 自动化应用的 `ctx` 与创建工具，不是 Pi SDK、浏览器 Playwright 或任意 MCP 工具集合。以下描述对应当前工作区源码；运行中的旧桌面二进制不会因为后端代码更新而自动获得新的 Rust 能力。

| 层次 | 提供什么 | 执行位置与边界 |
| --- | --- | --- |
| 创建阶段工具 | 读取原项目、只读探索、增量修改；测试由用户人工运行 | 创建对话中的专用工具，不是生成脚本可以调用的函数 |
| 应用运行时 `ctx` | 参数、步骤、文件、产物、网页、API、AI、询问 | 应用代码是 JavaScript ESM，由宿主 Node 工作进程执行，业务 SDK 经 IPC 交给宿主 |
| 桌面原生层 | 网站侧栏、浏览环境、Cookie 会话 API、受控网页操作 | 需要更新后的 Eureka 桌面程序；网页版不因此具备原生 WebView 能力 |

创建任务与数据归属使用本机工作区，Haze 登录仅用于云端发布及组织服务；网站登录属于所选浏览环境；AI 模型凭证来自当前用户的模型设置。这三类身份不能互相代替。

生成前依次核对：输入格式和数据量 → 每个独立功能 → 所需 SDK 方法 → 网站端点与鉴权 → 真实操作和结果验证 → 输出格式。发现能力缺口时指出具体缺少的接口或适配，不通过静默改需求、猜字段或重复生成整包解决。

先调用 `eureka_automation_task {}` 恢复轻量任务摘要与文件索引；需要精确约定时调用同一工具 `{sdkSection:"files"}` 等章节查询。章节查询只返回 SDK 参考，不重发整个代码包、不启动应用。参考中的源码文件名是实现索引，不会授予读取或修改宿主源码的权限。

模型生成和增量修改发生在应用运行之前，不受下面的 30 分钟运行预算控制；模型试运行入口已移除。反复整包生成会增加会话上下文；遇到明确的能力缺口应停在可解释的阶段，而不是把运行时超时改大来解决模型生成耗时。

| capability | 宿主提供的能力 |
| --- | --- |
| files.read | 文件引用读取、业务文件选择、AI 图片文件读取 |
| files.write | 授权范围内的写文件、建目录、复制/移动目标；移动源也需写权限 |
| browser.read | 网页观察/读取/查询、受声明的会话 API |
| browser.write | 如实声明网页或 API 变更；API 无额外授权问答或页面结果核对，网页控件变更仍需账号、授权和验证 |
| ai | AI 规则调用；图片文件还需 files.read |
| clarification | 应用运行中 ctx.ask，宿主自己的登录/授权问答另行管理 |
| artifacts | 文本下载产物登记，与 files.write 分开 |

本地定时运行由用户在应用“配置 → 定时运行”中创建，应用脚本不提供定时器注册 SDK。支持一次、每天、每周、1～10080分钟间隔；固定版本、功能和参数，动态日期按触发时重算。Eureka退出、休眠或错过的时间不补跑，上一轮未结束时跳过，不自动恢复或重试业务。计划不进入发布包、不上传Haze，不依赖Haze登录。不要用长时间 sleep/无限循环模拟定时功能。

实现位置：[features/automation/authoring/automation-intake-extension.ts](../features/automation/authoring/automation-intake-extension.ts)、[features/automation/runtime/automation-app-worker.ts](../features/automation/runtime/automation-app-worker.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)。

## authoring 创建阶段工具

模型创建工具不执行候选应用，不读取人工运行结果。测试、登录、文件选择和实际结果检查由用户在应用界面完成；API 流程不要求额外授权澄清或页面结果核对，网页控件变更仍由宿主管理范围授权。

| 工具 | 实现与主要参数 | 限制 |
| --- | --- | --- |
| `eureka_automation_task` | `{}` 返回当前任务、digest、版本、文件目录/摘要、sourcePaths 和 SDK 章节索引 | 不返回完整 SDK、整包源码、人工运行状态、日志、结果或试运行证据 |
| 同一任务工具的 SDK 读取 | `{sdkSection:"http"}` | 只读一个章节，不载入草稿或执行业务 |
| 同一任务工具的代码读取 | `{file:"scripts/main.mjs",source?:"current"或"base",search?,offset?,limit?}` | current 默认优先当前草稿；base 优先读取本会话最近保存的不可变版本。offset 是从 0 开始的字符位置；默认 8000、最多 12000 字符，还受输出字节预算约束；使用 nextOffset 继续。目录每次 40 项，以 fileOffset 继续 |
| 同一任务工具的探索读取 | `{evidenceId,path?,fields?,offset?,limit?}` | 仅当前任务只读探索；path 为 JSON Pointer；数组默认 5 行、最多 200 行并按字节缩小，字符串分页。人工 run: 证据拒绝读取 |
| `eureka_app_source` | `{path,method:"list"或"readText"或"readJson",offset?,limit?}` | 仅当前任务用户提供的源码根，分页只读，不执行源码，也不授予运行时文件权限 |
| `eureka_app_browser` | `{method,args}`；open 为 `[site]`，request 为 `[operationId,input]` | 仅发现只读 DOM/API 契约；拒绝 mutation 声明和调用，不是运行应用。大响应返回结构或小页，完整值留在私有任务目录；相同内容返回已有 evidenceId |
| `eureka_app_file` | `{fieldId,method:"list"或"readText"或"readJson",relative?,actionId?}` | 读取用户在配置中选择的业务输入，不读取人工运行记录；大内容按 evidenceId 分页 |
| `eureka_app_write` | 新应用 `{files:{相对路径:完整文本},scope?,limitations?}`；已有包 `{baseDigest,files?:{变更文件:完整文本},edits?:[{path,oldText,newText}],deleteFiles?,scope?,limitations?}` | 旧文件/二进制资源由宿主保留；oldText 必须唯一匹配；校验合并后的完整包并同步文件清单；不运行代码，不保存到目录 |
| `request_user_input` | 澄清实质缺失需求 | 不能要求用户提供不存在的试运行证据，不能伪造登录、文件授权或核对通过 |

`eureka_app_test` 和 `eureka_app_validate` 已移除并阻止旧调用；不再存在模型试运行或模型确定性校验步骤。应用运行时 ctx.ai 是独立业务能力，不因此被禁用。

增量修改以最新 digest 作为 baseDigest。摘要不匹配或文本匹配 0 次/多次时整个修改拒绝；先读取受影响的当前文件再重试，不生成整包。未改动文件不需要重新输出；已有原应用也可直接基于目录中的 digest 增量修改，不先复制一整包。

模型可见业务值的单页预算为 20,000 字节，过大时返回结构和引用，不静默丢失宿主数据；使用更具体的 path/fields 或更小分页。人工运行数据完全不走这条返回链路。历史模型上下文通过 SDK context 投影隔离旧试运行内容、重复 SDK、历史整包与大探索正文；JSONL 和界面记录保持原样。

实现位置：[features/automation/authoring/automation-intake-extension.ts](../features/automation/authoring/automation-intake-extension.ts)、[features/automation/authoring/automation-authoring.ts](../features/automation/authoring/automation-authoring.ts)、[features/automation/authoring/automation-authoring-source.ts](../features/automation/authoring/automation-authoring-source.ts)、[features/automation/authoring/automation-authoring-context.ts](../features/automation/authoring/automation-authoring-context.ts)、[features/automation/authoring/automation-authoring-edit.ts](../features/automation/authoring/automation-authoring-edit.ts)、[features/automation/authoring/automation-authoring-output.ts](../features/automation/authoring/automation-authoring-output.ts)、[features/automation/authoring/automation-authoring-history.ts](../features/automation/authoring/automation-authoring-history.ts)。

## package 应用包界面与多功能声明

`plugin.json` 使用 `$schema:"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"`；Eureka 声明放在 `extensions["com.eureka"]`。需要 `schemaVersion:1`、displayName、automation；automation 需要 schemaVersion/id/runtime/entry/ui/workflow/capabilities/files。runtime 只能是 `javascript-esm`，ui/workflow 根文件分别是 `ui.json`、`workflow.json`。新应用 id 使用 suggestedAppId。

`package.json` 的 name/version 与 plugin.json 相同，type 为 module；不支持 npm dependencies/devDependencies/install scripts。根包需要 plugin.json、package.json、ui.json、workflow.json、README.md，以及真实存在的 scripts/*.mjs 或 .js 入口；入口不强制叫 main.mjs。相对 import 的共享模块也必须列入 automation.files。

发布文件最多 256 个、合计 16 MiB，ZIP 导入最多 20 MiB；automation.files 必须与提交文件集合完全相等。JSON 定义单文件最多 1 MiB，README 最多 256 KiB。支持约定的 scripts/、ui/、workflows/、ai/、assets/ 路径与扩展名，不允许绝对路径、上级目录、真实配置/日志/证据/结果和凭证。

| 定义 | 正确结构 | 生成时常见错误 |
| --- | --- | --- |
| ui.json | `{schemaVersion:1,fields:[{id,label,type,required?,description?,default?,multiline?}],layout?:{columns,order?,spans?},buttons:[{id,label,action:"run"}],results:{columns:[{key,label,type}],download?:true}}` | type 不支持 password、select、xlsx；按钮 action 不支持 download；不能随意增加 placeholder、templateUrl 等字段 |
| 输入类型 | text/number/boolean/date/percentage/object/list/file/directory | file/directory 不可设默认路径；长编号用 text；date 为 YYYY-MM-DD；multiline 仅 text；percentage 是数值，不自动换算 10 与 0.1 |
| 输出列 | text/number/boolean/date/percentage/object/list | 输出应是真实 JSON 数据；列声明不会自动计算或修复结果 |
| workflow.json | `{schemaVersion:1,nodes:[{id,label,kind,description?,script?}],edges:[{from,to,label?,when?}]}` | kind 仅 script/browser/ai/branch/loop/wait-user；图形不自动执行脚本或解释 when 表达式，实际顺序由入口 JS 控制 |

字段、按钮、列、节点 id 用字母开头的 ASCII 标识，最长 80 字符，单个定义内不能重复；字段/列/节点各最多 256 项，按钮最多 32、边最多 1024。流程至少一个节点。

多功能用 `automation.actions:[{id,label,description?,entry,ui,workflow,capabilities?}]`，最多 32 个。每个功能拥有自己的输入、配置修订、文件授权、入口、流程、列与试运行记录。capabilities 是应用级能力的子集，根能力应为所需能力的并集；根入口/界面/流程保持为默认功能。

当前宿主 UI 是主运行按钮加功能选择菜单；选功能不执行。不能用声明实现任意 React/PyQt 界面、四个自定义横排按钮、文件字段右侧自定义下载按钮。模板下载可以做成独立动作生成真实产物；特殊布局属于宿主 UI 扩展需求。应用通过结构检查后即可由用户保存，不要求模型试运行或全部功能校验通过。创建卡片的“运行校验”可手动执行选定功能并检查结果；运行完成不自动标记校验通过。

个人应用通过 AI 修改已保存版本时，宿主自动递增 patch 版本（如 1.0.0 → 1.0.1），同时更新 plugin.json 与 package.json；同一轮未保存草稿可继续增量修订。保存后追加不可变历史版本，不覆盖已发布代码。自动化目录默认打开最新版本；“查看详情”下方的“选择版本”可切换当前应用视图及运行代码，应用名称后展示当前版本。组织插件仍遵循原安装版本约束。更新代码会使旧校验失效，文件选择也绑定代码 digest，不能承诺保留原授权。

actions[].capabilities 未填时会继承根应用能力。读写混合应用必须按动作明确声明最小能力，否则纯查询动作也可能继承 browser.write/files.write，进而被要求提供真实变更事件或文件内容验证。给查询按钮换名字不会改变能力与校验条件。UI fields 未声明的额外输入不会进入 ctx.params，不能只在 test.values 临时添加一个 secret 就认为已有该配置字段。

参数布局支持 `ui.layout:{columns:2,order:["source","target","startDate","endDate"],spans:{source:1,target:1,startDate:1,endDate:1}}`。columns 为 1–4；order 为不重复的字段 ID，未列出的字段按原顺序追加；spans 为字段占用列数（1 到 columns）。宿主默认每行 2 项，布局设置默认收起；“调整排列”入口位于参数 Tab 栏右侧，与 Tab 同行；用户点击后才显示每行数量、顺序和宽度控件，重新打开配置时再次收起。布局偏好按本机浏览器、用户、应用及功能保存。窄屏自动单列。字段 description 默认显示在名称后方的问号 Tooltip 中，使用宿主组件库。required:true 的字段名称后显示红色 *。这些是 SDK 宿主的统一默认行为，无需生成额外布局开关或必填样式配置。

日期输入和传入 ctx.params 的格式均为 `yyyy-mm-dd`。日期 default 可以是固定日期字符串，或 `{relative:"today"}` / `{relative:"yesterday"}` / `{relative:"tomorrow"}`。相对日期在启用应用时按本机日期重新计算（跨月、跨年使用日历日期运算），会覆盖上次保存的旧日期；运行配置不展示“启用时默认”控件，旧的浏览器日期默认值偏好不再参与计算；默认值由开发时的 AI 根据用户需求写入字段声明，例如 `{id:"startDate",label:"开始日期",type:"date",required:true,default:{relative:"yesterday"}}`。用户仍可在日期选择器中修改本次日期。固定日期或未声明动态默认值的字段继续优先使用已保存的值。文件和目录字段仍不允许默认路径。

实现位置：[features/automation/shared/automation-app.ts](../features/automation/shared/automation-app.ts)、[features/automation/runtime/automation-app-package.ts](../features/automation/runtime/automation-app-package.ts)、[features/automation/runtime/automation-app-actions.ts](../features/automation/runtime/automation-app-actions.ts)、[features/automation/ui/AutomationApplication.tsx](../features/automation/ui/AutomationApplication.tsx)。

## core 入口步骤日志等待与用户询问

入口默认导出 `async function run(ctx)`。宿主先 import 入口，再调用默认函数；顶层 import 只能装配模块/纯函数，不要在模块加载阶段执行业务。所有业务副作用与 SDK 调用放在 `await ctx.step(...)` 的回调里。

| 接口 | 实现和返回 | 边界 |
| --- | --- | --- |
| `ctx.params` / `ctx.config` | 同一份本次运行已验证的参数快照 | 不会动态读取配置面板；没有 ctx.getConfig |
| `ctx.runId` / `ctx.action` / `ctx.signal` | 当前运行 ID、所选动作 ID、AbortSignal | 动作属性叫 action，不是 actionId；取消应尽快停止循环 |
| `await ctx.step(nodeId,input,async()=>output)` | IPC 报告节点开始/结束/失败，通过 AsyncLocalStorage 关联子调用，返回 callback 的 output | nodeId 必须在当前功能图中；循环可重复同一 nodeId；嵌套 step 属于外层步骤。聊天逐步执行可等待宿主放行，不能重建 worker 跳过等待 |
| `await ctx.log(text)` | 记录附着在当前节点的日志 | 单条截到 1000 字符；console 总输出超过约 32,000 字节后不再记录。不要把日志当作独立校验证据 |
| `await ctx.sleep(ms)` | 可中止的定时等待 | 0～60,000 毫秒/次；不是网站就绪判断，不自动重试请求 |
| `await ctx.ask(questions)` | 暂停同一 worker，等待用户答案数组 | 需 clarification；每次 1～4 问，每问最多 8 个选项。question 最多 2000 字符，title 最多 100，选项 label 最多 200。支持 single/multiple；答案含 questionId、optionIds、text、custom、skipped 等 |

运行中临时缺少业务值可用 ctx.ask；创建需求澄清用 request_user_input。两者不是同一接口。跳过问题不代表同意默认选项。问答、登录和授权等待都继续原运行，不再点击开始或重发变更。

参数、step 输入/输出和最终结果使用 JSON 值。禁止 undefined、NaN、Infinity、BigInt、函数、循环引用及超过 40 层的嵌套；缺值显式用 null，日期用字符串。不要把 Buffer/复杂对象当作业务结构直接返回。持久化 step 输入/输出和最终结果最多 20 MiB；普通配置/通用 appJsonValue 默认预算仍为 1 MiB，配置总值另有 512 KiB 预算。读入较大文件后仍宜在 step 中处理并返回所需字段或产物元数据，避免展示大量无关正文。

至少实际执行一个 ctx.step，且入口返回时没有未 await 的 SDK 操作、未结束的步骤，宿主才可能记为 completed。仅画 workflow、只返回结果或 fire-and-forget 的 Promise 都不能算完整执行。

询问形状：ctx.ask([{title,question,options:[{label,description?}],selection?:"single"|"multiple"}])。返回的是答案数组，按 questionId、optionIds、text、custom、skipped 等读取；自由文本或多选不保证存在 optionId。没有选项时仍需传 options:[]。

实现位置：[features/automation/runtime/automation-app-worker.ts](../features/automation/runtime/automation-app-worker.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)、[features/automation/runtime/automation-step-driver.ts](../features/automation/runtime/automation-step-driver.ts)、[features/automation/runtime/automation-app-run.ts](../features/automation/runtime/automation-app-run.ts)、[features/chat/shared/user-input.ts](../features/chat/shared/user-input.ts)。

## files 文件读取写入与产物下载

文件 SDK 使用引用对象，不接收任意绝对路径。`ctx.files.workspace` 是宿主提供的工作区引用；用户选择的 file/directory 参数也是引用。`ctx.files.child(ref,relative)` 只组装子引用，真正访问时才校验，不能把它当作授权。

| 方法 | 实际行为 | 限制 |
| --- | --- | --- |
| `child(ref,relative)` | 返回 `{grantId,relative}` | 路径用 /；不能用绝对路径、..、链接或用 filename 假造 grantId |
| `await list(ref)` | 当前层目录项 `{name,kind,size,modifiedAt,ref}` 数组 | 不自动递归，目录最多 10,000 项；只列普通文件/目录 |
| `await readText(ref,encoding="utf-8")` | 按指定编码解码文本 | 普通文件最多 16 MiB；默认 UTF-8；GBK/GB18030 需指定 encoding，不解析 Excel 或 PDF |
| `await readJson(ref)` | UTF-8 JSON.parse 结果 | 普通文件最多 16 MiB；不是任意格式解析器 |
| `await readBytes(ref)` | Buffer，底层通过 Base64 IPC 传输 | 普通文件最多 16 MiB；不自动解压、识别工作簿或转成业务表 |
| `await writeText(ref,text,overwrite=false)` | 创建 UTF-8 文件并返回 bytes | 单文件最多 16 MiB；默认禁止覆盖，会创建必要的父目录 |
| `await writeJson(ref,value,overwrite=false)` | JSON.stringify 后写 UTF-8 文件 | 不是二进制 JSON/Excel；数据仍应可 JSON 序列化 |
| `await writeBytes(ref,bytes,overwrite=false)` | Base64 IPC 后落真实二进制字节 | 单文件最多 16 MiB；要求内容本身已经是正确文件格式 |
| `await mkdir(ref)` | 创建目录 | 必须在可写引用范围 |
| `await copy(from,to)` / `move(from,to)` | copyFile 或 rename 普通文件，目标要求不存在 | 不复制/移动目录，不删除文件；move 还需要源写权限，跨盘 rename 可能失败 |
| `await ctx.artifacts.write(name,text,mediaType='text/plain')` | 宿主保存 UTF-8 文本，登记可下载产物，返回 `{id,name,mediaType,size}` | 需 artifacts；只收字符串，最多 16 MiB；文件名单段、最长 120，不接收路径或 Buffer。MIME 不会把文本转换成 XLSX/PDF/PNG |

读取需 files.read，写入需 files.write；选择外部文件时还需用户授予 read/readwrite。授权绑定功能、所选路径和代码 digest；代码改变、文件移动、本地授权失效后可能需要重新选择。不能授权宿主私有配置、其他应用数据、越界路径、符号链接或目录联接。没有 remove/unlink/rmdir SDK。

`results.download:true` 的内置结果下载是完整 JSON，不自动生成 CSV/XLSX。需要 CSV 时由脚本生成正确转义的 CSV 字符串并写 artifact；二进制文件可经 writeBytes 写入授权位置，但不会因此自动登记为下载产物。不要把 Base64 文本标成 XLSX MIME 当作真实工作簿交付。

能力应准确区分：登记文本产物只需 artifacts，不会因为内部落盘就额外要求 files.write；调用 files 写入才需要 files.write。当前选择外部 file/directory 还要求 files.read，可写选择再要求 files.write。过度声明写能力会增加人工运行时的授权要求；业务校验不阻塞保存。

| `await extractZip(archiveRef,directoryRef,{overwrite?:false,filenameEncoding?:"auto"})` | 解压 ZIP 到已授权可写目录或工作区，返回 `{files:[{name,bytes,ref}],bytes}` | ZIP 输入最多 1 GiB，解压总量最多 1 GiB，最多 512 条目，单文件最多 512 MiB；默认不覆盖；全部路径与冲突先预检；文件分块解压到临时文件，所有条目的大小和 CRC 校验通过后才发布正式文件；解压后的数据不经过 Base64/工作进程 IPC。拒绝路径穿越、链接、重复路径、加密、损坏内容及超限压缩包。提交期间停止或磁盘错误仍可能留下部分已发布文件，不自动重跑或删除用户文件。 |

`readText(ref,encoding)` 支持 utf-8、utf8、gbk、gb18030、utf-16le；ZIP 文件名默认 auto（优先 UTF-8，旧 ZIP 可回退 GB18030），也可明确传 utf-8 或 gb18030。解压保留原始文件字节，因此 GBK CSV、XLSX 都不会被误转成 UTF-8 文本。解压是取出文件，不会把 CSV 自动转换成 XLSX。

大报表原样保存优先直接使用 extractZip，不要再以 ZIP 内单文件超过 16 MiB 拒绝落盘。readText/readBytes/writeText/writeBytes 的整块传输上限仍为 16 MiB，大文件处理使用 readChunk/createWriter 或 tables，不要在解压后为了保存而把大 CSV 整体读回工作进程再写一次；extractZip 返回的 files[].ref 和大小元数据即可用于后续结果展示。

大文件分块：`await ctx.files.readChunk(ref,{offset:0,length:1048576})` 返回 `{bytes:Buffer,offset,nextOffset,size,eof}`，每块最多 1 MiB、文件最多 1 GiB。使用 nextOffset 继续读取。
原子写入：`const w=await ctx.files.createWriter(ref,{overwrite:false,maxBytes:1073741824}); await w.write(buffer); await w.commit();`。单次 write 最多 1 MiB，总量最多 1 GiB。`await w.abort()` 丢弃临时文件；运行停止也清理未提交写入。commit 返回 bytes/sha256，已有目标默认不覆盖。
ZIP 解压现在只读取中央目录和条目头，文件体以分块流读取，不再整体加载压缩包；单包 1 GiB、单条目 512 MiB、展开合计 1 GiB、条目数 512。

`await ctx.artifacts.fromFile(name,ref,mediaType="application/octet-stream")`：将已授权文件保存为本轮结果列表中的独立副本。需要 artifacts 和 files.read；ref 必须是工作目录或用户授权的文件引用，不能传绝对路径。单文件最多1GiB，每轮最多64个文件产物。保留字节、文件名、类型和 SHA256；源文件后来变化不影响副本。文件内容不进入 AI 上下文，不上传 Haze。下载通过分段读取和原生“另存为”保存，大文件不走 Base64/Blob IPC；旧桌面支持的32MiB以内文件仍使用兼容通道；更大的文件需升级桌面程序。原有文字产物 write 的16MiB限制保持不变。

实现位置：[features/automation/runtime/automation-app-files.ts](../features/automation/runtime/automation-app-files.ts)、[features/automation/runtime/automation-app-worker.ts](../features/automation/runtime/automation-app-worker.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)、[features/automation/ui/AutomationApplication.tsx](../features/automation/ui/AutomationApplication.tsx)、[features/automation/runtime/automation-zip.ts](../features/automation/runtime/automation-zip.ts)、[features/automation/runtime/automation-stream-files.ts](../features/automation/runtime/automation-stream-files.ts)、[features/automation/runtime/automation-artifacts.ts](../features/automation/runtime/automation-artifacts.ts)。

## formats 文件格式依赖与签名能力缺口

| 需求 | 当前实际能力 | 生成器应如何处理 |
| --- | --- | --- |
| 文本/JSON | 已有 UTF-8 读写、JSON.parse/stringify 与结构化结果 | 直接使用文件 SDK；大结果分批或写产物 |
| CSV | 已有 ctx.tables 的 CSV 流式批量读取和追加写入 | 宿主处理引号、逗号、换行、BOM、中文编码与空值；输出 UTF-8 CSV，默认防止公式文本被误执行 |
| XLSX/XLS | XLSX 已有 ctx.tables 工作表批量读写、类型、列宽、冻结行、数字格式、公式及缓存值；XLS 旧二进制格式与公式计算引擎暂不支持 | 优先通过宿主 ctx.tables 处理 XLSX；脚本无需安装依赖。公式写入不等于宿主计算；可提供 result 缓存值，或在 Excel/WPS 中重算。下载解压原文件仍无需解析工作簿。 |
| PDF/DOCX | 文件 SDK 可读取字节，没有对应解析、排版或格式转换 SDK | 需要明确已有的解析模块/宿主扩展与验收方式，不能把 MIME 或文件扩展名当作转换 |
| ZIP | 已有 ctx.browser.download 和 ctx.files.extractZip，可下载 ZIP 并原样解出 CSV/XLSX 等文件 | 下载不是格式转换；原始表格可直接保存，不需要重新生成工作簿；RAR/7z、加密 ZIP、ZIP64 不支持 |
| 纯计算、MD5/HMAC 等业务签名 | JavaScript 与 Node 内置计算模块可用，例如 node:crypto；相对 JS 模块可以随包复用 | 独立业务 secret、账号和原始 body 来自私有参数时，可按已知算法计算；不需要为了 MD5 本身重写整个兼容库或一律要求原生适配 |
| 依赖隐藏 Cookie/Token 的平台签名 | 普通脚本无浏览器 Cookie 导出接口；当前原生提供淘宝 MTOP | 需要对应宿主适配；不能把独立 secret 的签名和读取浏览器隐藏 Token 混为一谈，更不能猜算法或导出凭证 |
| Python、npm 安装、系统程序、其他 MCP | 生成应用的运行时与工具清单没有提供这些通用执行接口 | 原项目可以读，不能直接运行原 Python 或安装依赖；缺少能力要明确记录，不能尝试 bash/exec、Playwright 或 ctx.mcp 等不存在的接口 |

工作进程使用 Eureka 本身的 Node 可执行文件，V8 old-space 配置 256 MiB，环境只保留必要的运行变量。文件权限通过 Node permission 与宿主引用检查实现，子进程、worker、native addon 等没有通用授权。Node 内置模块是否能做某件事与宿主 SDK 是否提供受管理能力是两回事；当前不能把这些文件权限旗标描述成完整的操作系统或网络沙箱。浏览器/API 访问应走受声明、授权、证据和重放规则管理的 SDK，不把裸 fetch 当作浏览器会话 API。

发现依赖缺口时输出：缺少的准确能力、受影响功能、已有可复用模块、需要扩展的宿主位置、可验证的替代方案。替代格式或减少功能需要用户决定；反复生成更大的包不会增加宿主能力。

私有配置表示不会随应用包发布，不等于提供了加密 SecretStore 或任意字段自动脱敏。当前 UI 没有 password/secret 类型；业务密钥必须显式声明为私有输入，避免放入日志、step 输入/输出、AI 输入或公开默认值。请求输入可能进入本任务的私有审计/证据；若要求独立密钥或签名完全不进入脚本/模型，需要专门的宿主凭证适配。

实现位置：[features/automation/runtime/automation-app-worker.ts](../features/automation/runtime/automation-app-worker.ts)、[features/automation/runtime/automation-node-runtime.ts](../features/automation/runtime/automation-node-runtime.ts)、[features/automation/runtime/automation-app-package.ts](../features/automation/runtime/automation-app-package.ts)、[features/automation/authoring/automation-authoring-validation.ts](../features/automation/authoring/automation-authoring-validation.ts)。

## tables CSV/XLSX 表格服务

表格服务需要对应 files.read/files.write 能力及现有文件授权，工作区引用同样适用。不传绝对路径，也不能从其他运行复用 reader/writer 句柄。最多同时打开 8 个表格句柄，单批最多 2000 行/16 MiB。
读取：`const reader=await ctx.tables.openReader(ref,{format:"csv",encoding:"gb18030"}); const batch=await ctx.tables.readRows(reader,500);`。返回 `{rows:[{sheet,row,values:[单元格]}],done}`；持续读取到 done，再停止。提前结束用 `closeReader(reader)`。CSV 支持 utf-8/utf8/gbk/gb18030/utf-16le、BOM、引号、多行字段和自定义 delimiter，单条记录最多 1 MiB，输入最多 1 GiB。
XLSX 读取使用 `{format:"xlsx"}`，返回各表真实行号与名称，日期为 ISO 字符串，公式保留 formula/sharedFormula 和已有 result。输入压缩包上限 32 MiB、展开校验总量上限 128 MiB、最多 10000 条目；宿主先验证路径、实际展开大小及 CRC，再用 ExcelJS 按行读取。没有伪装成流式的整表 JSON 返回。
创建 CSV：`const writer=await ctx.tables.createWriter(target,{format:"csv",columns:[{key:"id",label:"计划ID",type:"text"},{key:"cost",label:"花费",type:"number"}]});`。输出 UTF-8，默认 BOM 和公式文本转义，可设 bom:false、delimiter、escapeFormulas:false。日期/数字等通过声明验证；不要将长编号以 JS number 传入。
创建 XLSX：`const writer=await ctx.tables.createWriter(target,{format:"xlsx",sheets:[{name:"明细",columns:[{key:"id",type:"text",width:24},{key:"cost",type:"number",numFmt:"0.00"},{key:"roi",type:"formula",numFmt:"0.00"}],freezeRows:1},{name:"汇总",columns:[{key:"total",type:"number"}]}]});`。最多 32 表、每表 256 列、1048576 行（含表头）。列类型支持 text/number/boolean/date/formula；date 为 ISO 日期。
追加批次：`await ctx.tables.appendRows(writer,[{id:"0012345678901234567890",cost:12.5,roi:{formula:"B2*2",result:25}}],"明细");`。也支持按列顺序传数组行。末尾 `const saved=await ctx.tables.commitWriter(writer)` 返回 bytes/sha256/rows；`abortWriter(writer)` 取消。输出先落临时文件，成功后原子发布，默认不覆盖，可设 overwrite:true/maxBytes。追加指同一未提交 writer 内增加行，不是打开已关闭的 XLSX 原地追加。
公式仅写入表达式和可选缓存值，宿主不求值；Excel/WPS 重算取决于客户端设置。CSV 没有公式/格式元数据，formula 列仅输出提供的缓存值或空文本。XLS/ODS、合并单元格、图表、宏、任意模板无损编辑不在本版能力内。

实现位置：[features/automation/runtime/automation-tables.ts](../features/automation/runtime/automation-tables.ts)、[features/automation/runtime/automation-stream-files.ts](../features/automation/runtime/automation-stream-files.ts)。

## browser 网页观察定位读取与操作

网站声明为 `{id,label,startUrl,paths:[精确路径或末尾/*],account?:field,operations:[op]}`，放在 `automation.browser:{schemaVersion:1,sites:[...]}`。网页能力需 browser.read；网站最多 16 个，每站路径最多 32、操作最多 100。页面操作限 startUrl 的同 origin 与 paths；API 子域另见 http 章节。

| 方法 | 实际行为 | 限制 |
| --- | --- | --- |
| `await connect(siteId)` | 打开所选浏览环境中的网站，检查页面 origin、环境与账号 | 登录/验证码由用户在侧栏完成；返回登录后回到声明范围。不返回 Cookie |
| `await release()` | 释放当前网页控制 | 不清空已经记录的证据；释放后需要正确重连 |
| `await observe()` | 返回可见 DOM 摘要、控件、文字、表格示例 | 不是完整 DOM/全表：最多 120 控件、100 文本条、8 表各 5 示例行；观察结果超过约 180,000 字节还会继续截短 |
| `await locate(locator)` | 检查定位匹配，返回可见目标说明 | 单目标读取/操作通常要求唯一；不能把多个匹配当作一个 |
| `await read(field)` | 读取 text/value/checked/attribute，再按 type 转换 | 隐藏字段、密码、验证码、Token 不读取；attribute 只开放 data-*、aria-label、title、href 等并排除凭证，href 只返回 origin+path |
| `await extract({rows,fields,limit})` | 行内相对字段读取，返回结构化行 | 每次 1～500 行、最多 64 字段；没有自动翻页或无限滚动 |
| `await navigate(url)` | 导航到声明站点范围内地址 | 不任意跨域，不恢复旧写操作 |
| `await operation(opId,{value?,key?})` | 执行预先声明的 click/fill/select/check/enter | 不接收任意 JS；fill/select 值最多 4000 字符；row 作用域使用实际 key |
| `await waitFor(field,expected,timeout=10000)` | 每约 250 ms 调用 read，JSON 值严格相等才返回 | 最多 30,000 ms；只读等待，不重新点击查询/提交，不保证每次远端 read 都在此预算内结束 |

locator 选择 css、role(+name)、label、text、testId 中一种，可加 within、nth；within 必须唯一，嵌套不超过实现深度 3。同源 iframe、开放式 Shadow DOM 和普通文件控件上传需按本章显式声明；画布 OCR、任意坐标拖拽、调用者 evaluate/CDP 接口和关闭式 Shadow DOM 不提供。需要特定原生输入事件的网站可能需专门适配。

field 常用结构为 `{locator:{css:".value"},source:"text",type:"text",optional?:true}`。复杂货币、中文数量、特殊百分比先读 text，再在业务脚本明确解析；缺失不自动补 0。

网页控件 mutation 必须声明 browser.write、可靠的可见账号文字 account、verify，并由宿主取得操作范围授权。verify 为 `{field,mode:"equals",expected:JSON}` 或 `{field,mode:"equals",input:true}` 或 `{field,mode:"changed"}`；登录输入框/页面标题不等于账号。宿主比较控件变更前后的实际字段；未确认的变更中断，不自动重放。kind:request 的 API 变更不需要上述 account、范围授权或 DOM verify。

同一应用的功能和后续运行默认复用同一持久浏览器环境及登录态。任务页面仍按 run/site 隔离，不得移除运行归属校验以复用页面。显式配置的网站账号环境继续优先；temporary 是主动选择的例外，不保留登录态。

SDK 1.2 定位上下文：locator 可添加 context:[{kind:"frame",locator:{css:"#report-frame"}},{kind:"shadow",locator:{css:"report-grid"}}]，然后使用 css/role/label/text/testId 与 within/nth 定位具体元素。上下文最多三层，每层必须唯一且可见。frame 必须与顶层页面完全同源，并位于 site.paths 声明范围；不访问跨域 iframe、about:blank/srcdoc、不在允许路径内的 frame。shadow 仅开放式 shadowRoot；不会穿透关闭式组件。未声明 context 的旧定位只查当前文档。

浏览器文件上传使用普通 `ctx.browser.operation(id,{files:[{ref,filename?,contentType?}],key?})`。操作声明 kind:"upload",effect:"mutation",locator:{...},upload:{multiple?:false,contentTypes?:["text/csv"],maxBytes?:536870912}，须 browser.read、browser.write、files.read，并声明 account 和业务 verify。选择文件是会影响网站的变更，需要原有的持续授权；创建阶段禁止上传。上传目标必须是可见、启用的 input[type=file]，不支持目录选择、拖放、自定义坐标或隐藏控件。宿主只向明确控件设置用户授权文件的私有快照，保留原文件名；不向网站或应用代码暴露本机真实路径、文件体不进入 AI 上下文。

一次最多16个文件、合计512MiB，可降低上限；多选须同时声明 upload.multiple 且控件本身允许 multiple。每轮最多16次选择，快照保留到本轮结束，供后续表单提交读取。脚本必须 await 网站实际提交完成并核对业务结果后才能结束；设置 file input 不代表服务器已接收。上传派发后超时或验证失败都不自动再次选择/提交。使用更新后的桌面原生宿主，Web 更新不会为旧二进制增加文件选择能力。

实现位置：[features/automation/runtime/automation-app-browser.ts](../features/automation/runtime/automation-app-browser.ts)、[features/automation/runtime/automation-app-browser-runtime.ts](../features/automation/runtime/automation-app-browser-runtime.ts)、[desktop/src-tauri/src/app-browser.js](../desktop/src-tauri/src/app-browser.js)、[desktop/src-tauri/src/automation_browser.rs](../desktop/src-tauri/src/automation_browser.rs)、[features/automation/runtime/automation-app-upload.ts](../features/automation/runtime/automation-app-upload.ts)。

## checkpoints 长任务检查点与显式恢复

应用显式声明 automation.checkpoints:{schemaVersion:1} 才可使用。旧包不启用，运行方式保持原样。当前用于已安装应用的整流程运行；创建阶段、聊天逐步执行和独立运行工作区不支持恢复。

`await ctx.checkpoints.load()`：普通启动返回 null；用户选择“从检查点继续”后返回 {key,state,sourceRunId}。入口仍从头调用，应用按 state 中的已完成批次决定跳过哪些业务，不恢复 JS 调用栈、变量、Promise、打开的文件或浏览器页面。`await ctx.checkpoints.save("batch-2026-11-16",{next:2,completedFiles:[...]})` 保存最新 JSON 批次状态（最多256KiB）。名称1～120位字母、数字、点、下划线、连字符。不要保存真实密钥或令牌。

保存前必须 await 所有并行 SDK 操作，并 commit/abort 全部文件和表格 writer。ExcelJS 等写入句柄不能跨进程恢复；按日或批次提交完整 CSV/XLSX 文件，在检查点中记录已提交文件和下一个批次。启用检查点的应用禁止脚本直接通过 Node fs 写文件，统一经 ctx.files/ctx.tables 写入以跟踪写入边界。网络操作统一通过 ctx.browser，禁止直接 fetch、WebSocket、Node TCP/TLS/UDP 等常规入口，以免绕过写入跟踪；此限制不影响未启用检查点的旧应用。

用户从失败、取消或中断的历史运行选择继续，宿主创建新的 runId 并记录 resumedFrom，原运行和结果保留。原检查点只能被接续一次，防止重复启动同一批次；连续恢复使用新运行的最新检查点。不会自动恢复、自动重跑或定时轮询业务。

恢复校验应用 ID、包 digest、版本、功能、参数、当前已保存配置、文件授权和输入元数据。输入文件校验路径、文件身份、大小和修改时间；只读目录最多10000项并递归核对；读写输出目录允许新增结果，仅固定所选根目录身份。元数据校验不等同文件内容的密码学证明，需要严格不可变输入时由应用在检查点状态中记录并复核业务文件校验和。路径链接、移除授权或修改源文件会阻止恢复。

浏览器检查点须有可见账号标记和持久环境；恢复后先重新 connect 全部已记录的网站，核对账号、origin、浏览环境，再写入或保存新检查点。未确认账号和临时环境不能保存浏览器检查点。独立接口凭证只保存不含密钥的版本标识；每次请求前原生层核对恢复时固定的版本，凭证变更就停止，不发送给新凭证对应的账号。凭证值从不进入检查点。

任何网页/API 变更和文件发布都会在执行前把已有检查点标为不可恢复。应用收到并确认业务结果后再保存新检查点，才能重新允许恢复。检查点后有写入、但来不及保存新批次状态时，用户需人工核对并新建运行；不会拿旧检查点重放该写入。HTTP 200 由应用按真实业务状态判定；不确定的写请求必须停止，不依赖 checkpoint 猜测成功或自动补发。幂等键/查询核对仅按真实接口协议实现。

实现位置：[features/automation/runtime/automation-checkpoints.ts](../features/automation/runtime/automation-checkpoints.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)、[features/automation/runtime/automation-app-worker.ts](../features/automation/runtime/automation-app-worker.ts)。

## http 会话 API 协议参数鉴权与签名

先在某个 site.operations 声明 `{id,label,description,effect:"query"或"mutation",kind:"request",request:{url,method,credentials?,headers?,response?,signature?,allowDynamicUrl?,auth?,multipart?,responseHeaders?,redirects?,timeoutMs?},verify?}`。API 不使用 locator/row；域名可不同于网站页面，但每个端点需明确声明。普通 request 不能在调用时换目标地址、方法或请求头。下载允许显式声明的受限动态 URL。

调用 `await ctx.browser.request(opId,{query?,form?,json?,multipart?})`，返回 `{status,data,dispatched,verified?}`。执行在桌面 Rust 请求层；侧栏必须有当前运行的有效连接和一次性派发凭证，不是 Node 通用 HTTP 代理。

| 配置 | 支持内容与实现 | 限制 |
| --- | --- | --- |
| url | HTTP、HTTPS、非标准端口、固定 URL query 参数 | 保留真实协议，不擅改 HTTPS；禁止 user:password@host 和 #fragment。固定业务参数可发布，真实凭证/样本不能硬编码 |
| method | GET/HEAD/OPTIONS/POST/PUT/PATCH/DELETE | GET/HEAD 无 form/json 请求体；POST 可以是只读 query，业务 effect 需如实声明 |
| query | 字符串映射，与 URL 固定参数合并 | 运行时键替换 URL 中所有同名值，其他重复键保留；无运行时改动时保留固定 query 编码 |
| form / json | form 是字符串映射；json 是 JSON 值，包括 null | form、json、multipart 互斥；运行时参数最多 64,000 字节，上传文件体不计入 IPC |
| credentials | 默认 browser：取目标 URL 匹配的 Cookie，更新同环境 Set-Cookie；omit：不读取/发送/保存浏览器 Cookie | 普通 API 没 Cookie 也能发；Secure Cookie 不发到 HTTP。omit 的 401/403 应检查业务鉴权参数，不盲目要求网页登录 |
| headers | 固定 Accept、Content-Type、Referer、X-Requested-With、User-Agent | Cookie、Host 和动态任意头仍禁止；Bearer/API Key 请使用 auth 引用，不能把真实密钥写进声明或脚本 |
| response | json（默认）、text（UTF-8），或用于 download 的 bytes | HEAD、空/非 JSON 响应用 text；bytes 通过 download 直接保存，不通过 request 返回字节；不提供任意响应头或重定向 Location。JSON/文本原始响应体最多 16 MiB（16,777,216 字节），新版流式下载默认最多 1 GiB；旧桌面二进制兼容通道最多 12 MiB；浏览器回执 JSON 与持久化 step/最终结果最多 20 MiB。新版已移除旧 1,000,000 字节和回传 512 KiB 门槛；文本 JSON 转义和外层对象也计入回执预算 |

普通请求连接超时 8 秒、整体超时默认 20 秒，显式 timeoutMs 可配置 1000～1800000 毫秒；上传和流式下载默认 180 秒。默认不跟随重定向，不自动重试；只读 GET/HEAD 可显式声明受控 redirects。使用直接连接，不继承系统代理配置。401/403、未完成响应、登录页非 JSON、MTOP 登录失效会报错；HTTP 200 不代表业务成功。

淘宝 MTOP 原生签名使用 `signature:{kind:"taobao-mtop",appKey:"公开 appKey"}`，仅适配淘宝/天猫 HTTPS 端点与浏览器登录态。宿主读取 `_m_h5_tk` Token 前缀，计算 MD5(token&t&appKey&原始data)，注入 t/appKey/sign。URL 与输入都不能预置这三项；query.data 或 form.data 只能存在一份，需保留原序列化字符串。它不能与 credentials:omit 同用。

小强等独立业务签名若只用私有配置值与原始 body，可用 node:crypto 的纯计算；它不是 MTOP。需要浏览器隐藏 Token 的其他签名才依赖原生适配。API mutation 只需如实声明 effect:mutation 和 browser.write，不要求可见 account、DOM verify 或额外授权澄清；旧包的 request.verify 保留兼容但不触发页面读取。宿主返回接口响应，由脚本按真实业务约定判断，例如 `const r = await ctx.browser.request(id,input); if(r.data.ok !== true) throw new Error("修改失败");`。HTTP 200 本身不代表业务成功。可按需求主动调用查询接口复查，但不是保存或运行的强制门槛。请求已派发后如断线或超时，结果未知时仍停止且不自动重发。

下载已支持：声明 `request:{url:"https://download.example/reports/",method:"GET",response:"bytes",allowDynamicUrl:true,credentials:"omit"}`，然后 `await ctx.browser.download("downloadReport",{url:downloadUrl},ctx.files.child(ctx.files.workspace,"report.zip"))`。真实应用应使用真实确认过的下载域名及路径，不能照抄示例域名。动态 URL 必须与声明同 origin（协议、域名、端口相同），且在声明路径下；路径以 / 结尾表示该目录的子路径，否则只接受相同路径。签名 query 可原样携带；不能更换方法、Cookie 或请求头。固定 URL 下载不需要 allowDynamicUrl，也可使用已有请求体约定。

`ctx.browser.download(operationId,input,destinationRef,overwrite=false)` 返回 `{ref,bytes,status,contentType}`。需要 browser.read、files.read、files.write 及目标目录写权限；接口若属于业务变更，仍需 browser.write 和正确的 effect。先连接对应 site，登录态默认复用同一浏览器环境；公共下载可声明 credentials:omit。新版原生下载分块写入宿主指定的私有临时文件，不通过 Base64 或工作进程 IPC 传输文件体，也不进入 AI 上下文或运行审计正文；应用拿到的是文件引用。只接受完整的 2xx 响应，默认不跟随跳转、不自动重试。下载前检查目标授权与冲突，结束后校验字节数再写入。

ZIP 报表流程：获取导出任务的真实下载链接 → `ctx.browser.download` 保存 ZIP → `ctx.files.extractZip` 解压到用户选中的 directory 字段（须允许写入）→ 按需要 `readText(ref,"gb18030")` 读取 CSV，或直接保留解出的 CSV/XLSX 原文件。不要再把“SDK 无法下载二进制或解压 ZIP”作为拒绝实现的理由。这里只描述运行阶段能力，创建阶段不应执行用户业务下载或把二进制文件内容返回给模型。

二进制下载需要包含该功能的桌面原生宿主；只有 Web 代码更新、旧桌面程序未更新时不能承诺支持。旧宿主拒绝 bytes 时需升级并重启桌面程序，不能降级成仅返回 URL 并声称已保存报表。

新版下载签名：`ctx.browser.download(operationId,input,destinationRef,overwrite=false,{maxBytes?,timeoutMs?,sha256?})`。maxBytes 默认/最高 1 GiB，timeoutMs 默认 180000、最高 1800000；可传 64 位十六进制 sha256 做完整性校验。原生层必须升级后才支持流式落盘。下载中界面记录字节进度，取消撤销控制后停止传输；长度/校验失败不发布正式文件，不自动重试或续传。返回 `{ref,bytes,sha256,status,contentType}`。

SDK 1.2 增量能力（需要更新桌面原生宿主）：

独立凭证声明：request.auth={kind:bearer或api-key,credentialId:shop_key,header?:X-Shop-Key}，必须 HTTPS、credentials:omit，不与 MTOP 混用。Bearer 固定 Authorization，API Key 默认 X-API-Key；Cookie/Host/Origin/Referer/Content-Type/Length/Proxy-*/Sec-* 等特殊头不可覆盖。用户在运行配置的浏览器环境与授权页录入凭证，本机 DPAPI 加密保存，绑定本地身份、应用 ID、凭证名、类型、头和完整 origin+path+method。应用升级新增目标需重新保存授权。脚本、模型、服务端、日志、导出包都不接收真实凭证；凭证变更或撤销中断正在执行的请求，已派发写请求不会重放。清理应用数据同时删除本机凭证，普通卸载保留。

上传声明 request.multipart={fields:[shop],files:[{name:report,multiple:false,contentTypes:[text/csv],maxBytes:536870912}],maxBytes:536870912}。调用 ctx.browser.request(uploadId,{multipart:{fields:{shop:shopId},files:[{name:report,ref:ctx.params.report,filename:report.csv,contentType:text/csv}]}})。示意中的字符串必须使用 JavaScript 引号。只能 POST/PUT/PATCH，effect:mutation，须 browser.read/browser.write/files.read；不要求 files.write，不能传本地绝对路径。文件须由用户显式授权或位于应用工作目录，宿主先生成私有只读快照，再原生流式发送。每次最多16个文件，总量和单文件最高512MiB，可在声明降低上限；multipart Content-Type/boundary 由宿主生成。上传默认180秒，可 timeoutMs:1000..1800000；不支持上传断点续传或自动重试。创建阶段不执行上传。

responseHeaders 只能显式选择 content-type/content-disposition/retry-after/etag/last-modified，返回结果额外 headers；不返回 Set-Cookie、Location 或鉴权头。redirects 默认0，最多3，仅 effect:query 的无签名普通 GET/HEAD，保持同源且在原端点父目录下；不用于 allowDynamicUrl、上传或 mutation。携带独立凭证时每个跳转目标也必须已经授权，否则停止；不转发凭证到新域名。旧声明默认行为和返回结构不变。

auth 请求的原生回执附带 credentialRevision（不含密钥的版本标识），供宿主固定检查点恢复身份；应用不应将其作为业务结果。

实现位置：[features/automation/shared/automation-data-limits.ts](../features/automation/shared/automation-data-limits.ts)、[features/automation/runtime/automation-session-request.ts](../features/automation/runtime/automation-session-request.ts)、[features/automation/runtime/automation-app-browser-runtime.ts](../features/automation/runtime/automation-app-browser-runtime.ts)、[desktop/src-tauri/src/automation_session_request.rs](../desktop/src-tauri/src/automation_session_request.rs)、[features/automation/runtime/automation-app-download.ts](../features/automation/runtime/automation-app-download.ts)、[features/automation/runtime/automation-app-upload.ts](../features/automation/runtime/automation-app-upload.ts)、[desktop/src-tauri/src/automation_credentials.rs](../desktop/src-tauri/src/automation_credentials.rs)。

## ai 固定 AI 规则、分类模型与图片输入

默认聊天 AI（未声明 operation 或 operation:"chat"）：声明 ai 能力，在 `ai/rules.json` 写 `{schemaVersion:1,rules:{extract:{instruction:"固定判断规则",output:{type:"object",properties:{category:{type:"text",enum:["A","B"]}}}}}}`。调用 `await ctx.ai(ruleId,input,{images?:[已授权文件引用]})`；必须位于 kind:ai 的 ctx.step 内。

以下默认模型回退仅适用于聊天 AI，不适用于 operation:"classify"。实际实现是宿主按应用本地“业务 AI”配置选择模型，未配置时选本机可用的默认模型（受 enabledModels 范围影响），读取该用户模型凭证，单次完成 JSON 判断。没有继续探索、工具调用、多轮 agent、创建者凭证随包分发或逐调用 model/provider 覆盖参数。创建对话临时选择的模型不等同于此默认模型；图片必须由选中的模型支持，不静默切换模型。

## 独立分类操作：operation:"classify"
分类操作必须使用嵌套 classifier 对象。instruction、output、classifier 是规则内的并列字段；type 与 criteria 放在 classifier 内，不能放在规则根部，也不能放在 output 内。
| 分类类型 classifier.type | output.type | classifier.criteria | 返回值 |
| --- | --- | --- | --- |
| bool | boolean（不是 bool） | 仅含 true/false 两个键的说明对象 | 布尔值，概率 >= 0.5 为 true |
| choice | text（不是 choice） | 自定义标签到说明的对象，不能用数组 | 标签字符串 |
| score | number（不是 score） | 从低到高的等级说明数组 | 0 到等级数减 1 的期望等级索引 |
以下是可直接作为 ai/rules.json 的完整 JSON；按用户需求仅选所需模板，不必为示例增加额外功能或按钮。

```json
{
  "schemaVersion": 1,
  "rules": {
    "clothing": {
      "operation": "classify",
      "instruction": "判断输入商品描述是否属于服装。",
      "output": {
        "type": "boolean"
      },
      "classifier": {
        "type": "bool",
        "criteria": {
          "true": "商品属于服装",
          "false": "商品不属于服装或信息不足"
        }
      }
    }
  }
}
```

```json
{
  "schemaVersion": 1,
  "rules": {
    "category": {
      "operation": "classify",
      "instruction": "根据输入商品描述选择一个类目。",
      "output": {
        "type": "text",
        "enum": [
          "clothing",
          "other"
        ]
      },
      "classifier": {
        "type": "choice",
        "criteria": {
          "clothing": "服装类商品",
          "other": "其他商品或无法确定"
        }
      }
    }
  }
}
```

```json
{
  "schemaVersion": 1,
  "rules": {
    "quality": {
      "operation": "classify",
      "instruction": "评价输入商品描述的信息完整程度。",
      "output": {
        "type": "number"
      },
      "classifier": {
        "type": "score",
        "criteria": [
          "信息不足",
          "基本完整",
          "信息充分"
        ]
      }
    }
  }
}
```

分类规则的 output 是单次分类结果的类型，不是页面展示结构。需要对象或中文“是/否”时，在脚本中包装返回值，不要把 bool 分类的 output 改为 object：
```js
return ctx.step("judge", { description: ctx.params.description }, async () => {
  const isClothing = await ctx.ai("clothing", { description: ctx.params.description });
  return { isClothing, answer: isClothing ? "是" : "否" };
});
```
工作流 judge 节点必须声明 kind:"ai"，应用声明 ai 能力并发布 ai/rules.json。分类模型由用户在已保存应用的「配置 → 业务 AI → 分类模型」中选择，未选择时明确失败，不回退聊天模型。没有模型凭证或未做实际运行不阻止生成和保存；创建者不得以此要求提前测试或自动执行应用。
分类与聊天共用每轮 20 次调用、图片授权和取消限制；分类使用应用超时，不使用聊天的推理强度或输出 token 上限；仅支持图片的分类模型可接收 images。错误结果、类型不符、非法标签/概率/评分必须显式失败，不能伪造通过。


| 项目 | 当前限制 |
| --- | --- |
| 规则文件 | 最多 32 条；每条 instruction 最多 12,000 字符；文件运行时读取最多 256 KiB |
| output 结构 | text/number/boolean/object(properties)/list(items)，不是 JSON Schema 的 string/array 语法；对象声明的字段均必须出现且不接受额外字段 |
| 结构预算 | 深度最多 12；对象最多 64 属性；enum 最多 50；输出 list 最多 500 项 |
| 输入/输出 | 文字输入 JSON 序列化最多 64,000 字节；输出必须是可 JSON.parse 的纯 JSON，最多 64,000 字节 |
| 调用预算 | 每个运行最多 20 次 AI SDK 调用；单次默认60秒、maxTokens默认4000（应用本地业务 AI 设置可调整）、maxRetries=0 |
| 图片 | JPEG/PNG/WebP/GIF；每次最多 10 张；原图总量最多 16 MiB；处理后的 Base64 编码总量也最多 16 MiB |

图片优先使用 files.read 授权下的文件引用；可兼容已有 `{mediaType,base64}` 图片对象，但绝不能把图片 Base64 拼进普通文本。图片读取、解码、EXIF/缩放交给 Pi 图片处理器，默认约 2000×2000、每图编码上限 4.5 MiB。缩放不保证小字可辨；没有自动裁图分块、PDF 渲染、任意图片 URL 下载或表格解析能力。

模型连接、配额、凭证、图片格式、超时和结构校验失败会明确报错，不自动重试。AI 输出只是业务判断结果，不能替代真实文件、页面、API 或写入状态证据。

应用运行配置中的“业务 AI”单独设置模型、推理强度、请求超时10～1800秒和输出上限256～128000 token。未配置的旧应用沿用默认模型、60秒、4000 token。设置仅存本地，不进入发布包；一次运行固定设置，记录实际使用的模型；不可用或不支持的模型明确报错，不静默替换。脚本仍不能逐调用指定模型。在线模型会接收交给它的分析内容并可能收费；这不依赖 Haze 登录。

实现位置：[features/automation/runtime/automation-app-ai.ts](../features/automation/runtime/automation-app-ai.ts)、[features/automation/runtime/automation-app-ai-images.ts](../features/automation/runtime/automation-app-ai-images.ts)、[features/automation/runtime/automation-app-files.ts](../features/automation/runtime/automation-app-files.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)、[features/automation/runtime/automation-business-ai-store.ts](../features/automation/runtime/automation-business-ai-store.ts)、[features/automation/runtime/automation-app-classifier.ts](../features/automation/runtime/automation-app-classifier.ts)。

## validation 仅人工测试、结果隔离与持续保存

创建卡片 → 运行校验 → 配置 → 手动试运行。多功能通过菜单选择目标，再点击运行。打开预览或切换功能不执行。人工运行不需要 checks 或模型校验。

运行记录、结果、日志、问答和产物留在应用界面及私有运行目录。创建模型不能启动候选应用，也不能通过任务快照、evidenceId 或旧试运行工具读取这些数据。需要修错时，用户主动反馈具体错误或所需片段。模型不为获得测试样本而自动执行应用。

保存检查身份、当前代码 digest、完整包结构、宿主修订号与应用空闲状态。未运行、人工运行失败或只测试部分功能都可以保存，不伪造通过状态。网页控件变更仍需账号、范围授权和结果 verify；API 变更无额外授权问答或页面结果核对；文件写入仍需实际授权。

保存后当前任务保持活跃。后续消息继续修改同一应用，首次修改自动递增 patch 版本；用户可以再次人工运行并保存。代码修订用宿主 revision/digest 区分，每份代码快照不可变。其他会话或外部修改造成登记修订冲突时拒绝覆盖。

同一次人工运行的 HTTP 重发以 runId 幂等，不重放业务。正在运行时禁止修改或保存代码；先结束原运行。代码变化会使旧文件授权失效，须在界面按实际提示重新选择，不能将保留配置误认为授权沿用。

模型上下文仅做提供给模型的投影，不删除 JSONL，也不修改 UI 历史或私有实际结果。历史校验记录可保留供用户查看，不再作为保存门槛或模型输入。

实现位置：[features/automation/authoring/automation-authoring.ts](../features/automation/authoring/automation-authoring.ts)、[features/automation/authoring/automation-authoring-context.ts](../features/automation/authoring/automation-authoring-context.ts)、[features/automation/authoring/automation-authoring-history.ts](../features/automation/authoring/automation-authoring-history.ts)、[features/automation/ui/AutomationAuthoringCard.tsx](../features/automation/ui/AutomationAuthoringCard.tsx)、[app/api/automation/authoring/route.ts](../app/api/automation/authoring/route.ts)。

## limits 大小并发与超时限制汇总

同一数据经过多层时，以实际经过的最小限制为准；字节、字符、token、文件大小和 JSON 序列化大小不是同一个单位。

| 层次 | 限制 | 触发后的处理 |
| --- | --- | --- |
| 应用包 | 256 文件、总展开 16 MiB、ZIP 20 MiB | 拆模块与减小资源，不夹带用户数据或生成结果 |
| 原项目源码 | 单文件 2 MiB，分页 1～300，文本页 64,000 字节 | 按文件/行分页，不一次性灌入全部项目 |
| 配置 | 总值 JSON 最多 512 KiB | 大输入通过文件引用，不塞进 text 默认值 |
| 运行结果 | step 输入/输出、最终结果 20 MiB，JSON 深度 40；工作进程 IPC 整条消息 24 MiB | 支持多 MB 业务响应和完整结果；仍建议返回所需字段，大正文可写产物 |
| 工作进程 IPC | 单条消息最多 24 MiB，并行在途 SDK RPC 最多 64 | 不对几千行同时 Promise.all；二进制 Base64 与 JSON 开销也计入 |
| 普通文件/文本产物 | 整块接口单项 16 MiB；分块文件/下载最高 1 GiB，表格批次最多 2000 行 | 分批文件或明确扩展宿主；不是所有阶段都能回传 16 MiB |
| 网页表格 | extract 每批 500 行、64 字段；observe 是截断摘要 | 依据真实分页方式分批读，保留记录身份和完整性核对 |
| 浏览器命令 | 请求 payload 最多 100,000 字节；有效连接下命令约 60 秒，一次性派发票据约 15 秒 | 缩小声明/输入；连接中断处理与命令派发超时不能混成用户等待 |
| 原生 API | 运行时输入 64,000 字节、响应体 16 MiB、浏览器回执 JSON 20 MiB；连接 8 秒/普通请求整体 20 秒；流式下载默认 180 秒、最高 30 分钟，文件体不经过回执 JSON | 分页由业务接口和实际响应决定；超限会明确提示，不能当空数据；未知写入结果不重试 |
| AI | 每轮20次；默认单次60秒、输出4000 token，可由业务 AI 配置调整；文字输入64,000字节，JSON输出随配置上限最多1MiB | 分批、缩小规则/数据，检查模型连接和配额 |
| 日志/事件 | 日志 1000 字符/条，console 约 32,000 字节，运行事件约 2500 条 | 不逐字段刷日志；长循环报告阶段进度 |
| 运行 | 同一宿主进程最多 4 个应用；默认应用级执行占用互斥；old-space 256 MiB | 等原运行释放，不创建替代运行抢占；不能把特殊隔离执行选项当作 ctx 参数 |
| 总执行预算 | 实际活跃执行约 30 分钟，网页/用户等待及聊天步骤尚未放行不计入 | 停留在等待状态不代表无时限重放业务或存在可恢复的检查点 |
| 创建状态 | author.json 最多 4 MiB，任务证据最多 150 条 | 缩小证据，不发布真实数据，避免大块文本反复进入会话 |

浏览器连接不可用时，未派发命令会保留并等待原面板重连，等待不总是被固定的 60 秒截断。因此看见长等待应先看 status、连接和派发阶段，而不是另起一个 run。模型不再调用试运行工具；用户在界面观察或停止当前运行。

实现位置：[features/automation/runtime/automation-app-package.ts](../features/automation/runtime/automation-app-package.ts)、[features/automation/runtime/automation-app-run.ts](../features/automation/runtime/automation-app-run.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)、[features/automation/runtime/automation-app-browser-runtime.ts](../features/automation/runtime/automation-app-browser-runtime.ts)、[features/automation/runtime/automation-app-ai.ts](../features/automation/runtime/automation-app-ai.ts)、[features/automation/authoring/automation-authoring.ts](../features/automation/authoring/automation-authoring.ts)。

## recovery 常见阻塞与正确恢复方式

| 现象 | 原因 | 正确处理 |
| --- | --- | --- |
| baseDigest 缺失或已变化 | 基础代码不明确或存在并发修改 | 读任务当前 digest，再读受影响文件；不生成整包、不换 ID |
| oldText 匹配不唯一 | 模型使用了过短或过期片段 | 通过 file/search 获取当前唯一片段；本次编辑未写入任何文件 |
| 普通导入提示同版本内容不同 | 发布包和组织插件仍遵循原导入规则 | 已保存的个人应用修改由宿主自动递增版本，未保存草稿内可继续修订；不覆盖已保存版本或组织插件来源 |
| 代码包已生成但创建状态保存失败 | 入库已完成，任务状态提交失败 | 先读 task 恢复 pendingWrite；不重新生成代码、不执行业务 |
| 人工试运行失败、等待登录/问答 | 用户运行中的真实状态 | 在应用界面处理；模型仅根据用户主动反馈的错误修代码，不读取整份结果 |
| 应用登记已变化 | 另一任务、用户或插件更新了当前安装 | 保留当前草稿，重新打开正确修改来源，不绕过 revision 检查 |
| 请求内容过大或 API 响应超限 | 对应层的传输预算 | 原生响应 16 MiB，回执/运行值 20 MiB；创建模型探索单页另为 20,000 字节，用引用读字段。不可把超限当空数据 |
| 多个固定宿主接口返回 404 HTML | 开发服务路由状态异常 | 修复/重启服务后复查；不删除会话、不重写应用 |

人工运行的 waiting-user/waiting-browser/completed/failed/interrupted 是运行器状态，不是模型继续调用工具的指令。进程重启不会重建任意 JS 执行栈；未知变更结果不重放。

实现位置：[features/automation/authoring/automation-authoring.ts](../features/automation/authoring/automation-authoring.ts)、[features/automation/authoring/automation-authoring-validation.ts](../features/automation/authoring/automation-authoring-validation.ts)、[features/automation/runtime/automation-app-runtime.ts](../features/automation/runtime/automation-app-runtime.ts)、[features/automation/runtime/automation-app-browser-runtime.ts](../features/automation/runtime/automation-app-browser-runtime.ts)、[features/chat/client/useAgentSession.ts](../features/chat/client/useAgentSession.ts)。

## recipe 可靠生成顺序与最小入口示例

1. 读 task 摘要，取得当前 digest、文件索引、sourcePaths、SDK 章节索引；不重复载入所有代码或完整 SDK。
2. 新迁移先只读用户原项目的相关模块；修改现有应用先通过 file/search 读受影响的当前文件片段。
3. 只查询必要 SDK 章节，核对格式、协议、鉴权、输出能力；缺能力先指出，不写大段猜测兼容代码。
4. 确需发现页面/API 契约时只读最少字段；大响应通过 evidenceId/path/fields 分页，重复响应不再返回正文。
5. 新应用完整提交一次；后续用 baseDigest 加 edits 或变更文件。保持 ID 和包名；版本号由宿主在修改已保存版本时递增；宿主检查并合并完整包。
6. 生成完成交用户手动运行、查看结果和保存。模型不调用试运行/校验，也不读取人工运行结果。
7. 用户反馈问题后只修改相关代码；保存后仍是同一编辑任务，不创建新应用；保存后首次修改由宿主递增版本，未保存草稿内的小改保持版本。
8. 真实状态区分已生成/已保存/人工已运行，不将 HTTP 200 或自报成功等同业务通过。

最小运行入口示例（配套 UI 声明 text 文本字段，workflow 声明 parse/export 两个 script 节点，能力含 artifacts）：

```js
export default async function run(ctx) {
  const rows = await ctx.step('parse', null, async () => {
    const lines = String(ctx.params.text ?? '').split(/\r?\n/).filter(Boolean);
    return lines.map((value, index) => ({ index: index + 1, value }));
  });
  await ctx.step('export', { count: rows.length }, async () => {
    const artifact = await ctx.artifacts.write('result.json', JSON.stringify(rows), 'application/json');
    return { artifactId: artifact.id, count: rows.length };
  });
  return rows;
}
```

这个示例只演示小文本处理和文本产物；没有把文件 SDK 伪装成 Excel 服务。结果列可声明 index:number、value:text；私有检查使用完整结果预期或独立证据。真实文件、网页和变更功能还需各自的授权、格式适配与校验。

实现位置：[features/automation/authoring/automation-authoring-guide.ts](../features/automation/authoring/automation-authoring-guide.ts)、[features/automation/authoring/automation-intake-extension.ts](../features/automation/authoring/automation-intake-extension.ts)、[features/automation/runtime/automation-app-worker.ts](../features/automation/runtime/automation-app-worker.ts)。
