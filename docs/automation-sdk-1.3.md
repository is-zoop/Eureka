# 自动化 SDK 1.3：业务 AI、文件产物和本地定时运行

## 使用入口

1. **业务 AI**：打开带 AI 步骤的已安装应用，进入“配置 → 业务 AI”，选择模型、推理强度、超时和输出上限，点击保存。聊天和应用资料生成使用各自原来的设置。运行界面显示本轮实际选用的模型。
2. **文件产物**：应用通过 `ctx.artifacts.fromFile(name,ref,mediaType)` 将已有文件加入本轮下载列表。用户在结果下载菜单选择文件，并选择本机保存位置。Excel、ZIP、图片、PDF 均按原字节保存；此接口不承担生成文件格式的工作。
3. **定时运行**：打开应用目标版本和功能，填写参数，在“配置 → 定时运行”创建并启用计划；支持一次、每天、每周、1～10080分钟间隔。计划保存创建时的参数；日期可选固定日期或每次重新计算今日、昨日、明日。在“设置 → 自动化管理 → 定时运行”统一查看、暂停、启用和删除。

## 边界与兼容

- 本地设置、产物和计划不要求登录 Haze，不自动上传 Haze。在线模型会接收用户交给它的分析内容，并可能收费；业务网站自身仍可能要求登录。
- 未配置业务 AI 的旧应用沿用原来的模型选择、60秒超时和4000 token。可配置超时10～1800秒、输出256～128000 token，仍受模型自身能力和每轮20次AI调用限制。不自动换模型或重试。一次运行固定本轮配置，运行期间不能修改应用业务AI设置。
- 文件产物仅读取工作目录或用户授权文件，需要 `artifacts` 与 `files.read`；分段复制为独立副本，单文件最多1GiB、每轮最多64个文件产物，记录SHA256。文字产物保留16MiB上限。旧桌面支持的小文件仍可通过原有通道保存，超过32MiB需更新桌面程序。副本保存在本机应用数据，随用户清理数据而删除，不进入应用导出包或AI对话。保存至电脑时采用分段传输，失败保留原目标文件，不发布未完成的新文件。
- 本机最多保存100个计划；大量业务数据应通过授权文件输入。计划只在 Eureka 本机服务运行且电脑未休眠时启动，按本机时区、约15秒检查一次。不接入Windows服务、不唤醒电脑、不使用云端调度。启动或唤醒时错过的运行不补跑，上一轮未结束时跳过，不排队积压。
- 计划固定包版本和摘要，不自动切换最新版本；同一版本内容变化、业务AI配置或浏览器环境配置变化、时区变化时暂停。需要新配置时重新创建计划。停用或卸载应用后不能启动。
- 定时启动复用现有运行入口、文件授权、浏览器账号核对和操作授权。验证码、登录过期或网页操作授权仍需人工处理；打开计划对应版本的应用，在运行记录查看并接管。当前版本的应用面板空闲时会发现其正在运行的定时任务；不能保证所有网站都无人值守完成。
- 暂停或删除计划仅影响后续触发；已开始的运行在应用内停止。触发前先落盘登记本次时间，启动过程中异常退出也不自动重发这次业务。检查点仍由用户手动继续。

## 修改范围

| 范围 | 主要文件 |
| --- | --- |
| 业务AI | `features/automation/runtime/automation-business-ai.ts`、`features/automation/runtime/automation-business-ai-store.ts`、`app/api/automation/apps/[id]/ai/route.ts`、`features/automation/ui/AutomationBusinessAi.tsx`、AI执行及运行记录模块 |
| 文件产物 | `features/automation/runtime/automation-artifacts.ts`、`features/files/shared/save-artifact.ts`、运行API、`desktop/src-tauri/src/save_file.rs`、原生命令注册和权限声明 |
| 定时计划 | `features/automation/shared/automation-schedule.ts`、`features/automation/runtime/automation-scheduler.ts`、`app/api/automation/schedules/route.ts`、`instrumentation.ts`、`features/automation/ui/AutomationSchedules.tsx` |
| 现有界面 | `features/automation/ui/AutomationApplication.tsx`、`features/settings/ui/AutomationSettings.tsx`、复用模型选择器、中英文文案 |
| 共用定义 | SDK契约、模型参考说明、生成的参考手册与 `integrations/haze` 交付文件 |

桌面文件分段“另存为”需要更新原生程序及权限文件，Web更新不能给旧安装包增加命令。Haze部署匹配契约、manifest及适配器；业务AI本地设置和定时计划本身不增加发布包字段。

自检覆盖配置隔离与冲突、授权文件和独立副本、超过旧下载大小限制的文件、原生地址限制与中断保存、定时重复触发/休眠/占用/动态日期/卸载，以及未登录Haze的本地运行。不调用真实模型或业务网站，不创建用户真实计划，不部署Haze，不执行 `next build`。
