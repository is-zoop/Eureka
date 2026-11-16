# 创建自动化时直接读取原项目

2026-11-06：自动化创建增加 `eureka_app_source`。用户在当前任务中提供完整路径后，AI 可立即列目录、分页读源码和项目定义，不需要先生成草稿，再打开配置选择同一个目录。

例如直接发送：

```text
把 E:\synthos_plugins\plugins\tm_goods_update 改成自动化，保留原 API 参数与业务逻辑。
```

路径含空格时使用引号，例如 `"E:\My Projects\tm_goods_update"`。

## 创建工具

`eureka_automation_task` 返回 `sourcePaths`，来自宿主收到的原始用户消息，保存在本地工作区与任务的私有记录中，不依赖 Haze 登录。后续消息可补充路径；旧任务可以恢复初始需求或同任务历史用户消息中的路径。模型回复、工具返回、其他任务及附件正文不能自行扩大范围。见[本地工作区](./automation-local-workspace.md)。

```json
{"path":"E:\\synthos_plugins\\plugins\\tm_goods_update","method":"list"}
```

```json
{"path":"E:\\synthos_plugins\\plugins\\tm_goods_update\\tm_get_items.py","method":"readText","offset":1,"limit":200}
```

方法为 list、readText、readJson。offset 从 1 开始，limit 为 1～300；根据 nextOffset 继续读取。单个源码文件上限 2 MiB，文本页上限 64 KB，JSON 返回上限 128 KB。

源码读取可在没有候选应用时使用，不创建运行、不导入或执行原代码、不修改原项目，也不产生应用运行时文件授权或业务结果证据。Cookie／凭证目录、宿主私有数据、依赖目录、符号链接及目录联接不进入源码读取范围。常见明文凭证赋值会遮盖；迁移时仍须将原项目的硬编码凭证改为私有配置或宿主认证能力。

`eureka_app_file` 继续用于应用运行时真实需要的业务文件。原项目目录只作为迁移参考时，不应成为新应用的必填配置；旧的占位草稿可以在生成适配后的代码时去掉该字段。

## 使用与验证

本次只有服务端和 SDK 提示调整，无 Rust 变更。重启当前 `npm run dev` 服务并刷新 Eureka 后，在原自动化任务中继续即可，无需再次编译桌面程序。服务重启会中断正在执行的运行，应先结束当前运行。

回归覆盖了：无草稿直接读取、后续路径登记、旧任务恢复、SDK 参数校验、跨任务／登录隔离、取消、凭证过滤、分页、超限和目录联接。原项目只做只读检查，不执行业务接口。
