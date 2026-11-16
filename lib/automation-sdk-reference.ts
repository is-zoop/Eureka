import { sdkContractSummary } from "./automation-sdk-contract";
import reference from "./automation-sdk-reference.json";

/** Shared by the authoring tool and the repository reference. No application,
 * browser, file grant, model or package code is loaded to read this metadata. */
export function automationSdkIndex() {
  return reference.sections.map(({ id, title, summary }) => ({ id, title, summary }));
}

export function automationSdkSection(id: unknown) {
  const section = reference.sections.find(section => section.id === id);
  if (!section) throw new Error(`SDK 章节无效，可用章节：${reference.sections.map(section => section.id).join(", ")}`);
  return {
    contract: sdkContractSummary(),
    schemaVersion: reference.schemaVersion,
    updated: reference.updated,
    id: section.id,
    title: section.title,
    summary: section.summary,
    sources: section.sources,
    methods: section.methods,
    content: section.content.join("\n"),
  };
}

export function renderAutomationSdkReference() {
  const introduction = [
    "# 自动化 SDK 功能实现与限制",
    "",
    `核对日期：${reference.updated}。对应当前工作区源码。`,
    `SDK 能力契约版本：${sdkContractSummary().sdkVersion}；能力、方法、限制与运行时共用 automation-sdk-contract.json。`,
    "",
    "用于确认自动化需求是否能实现、如何调用已有能力，以及失败时应修代码、补配置、等待用户还是扩展宿主。运行时能力以实际加载的后端和桌面二进制为准。",
    "",
    "生成器先调用 `eureka_automation_task {}` 获取任务和章节索引；随后可用 `eureka_automation_task {sdkSection:\"http\"}` 等按需查询。章节查询不会执行应用，也不重复返回整个草稿。",
    "",
    "本文件由 `lib/automation-sdk-reference.json` 与 `renderAutomationSdkReference()` 生成，与模型按章节读取的内容共用同一份参考数据。",
    "",
    "| 章节 ID | 功能 |",
    "| --- | --- |",
    ...reference.sections.map(section => `| ${section.id} | ${section.title}：${section.summary} |`),
    "",
  ];
  const sections = reference.sections.flatMap(section => [
    `## ${section.id} ${section.title}`, "", ...section.content, "",
    `实现位置：${section.sources.map(source => `[${source}](../${source})`).join("、")}。`, "",
  ]);
  return [...introduction, ...sections].join("\n");
}
