import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { clarificationRuntime } from "./clarification-runtime";
import { AUTOMATION_CHAT_TOOL, automationChatAccess, chatAutomations, chatInvocationResult, listAutomationComposerApps, listChatInvocations, prepareChatInvocation, startChatInvocation, stopAppRun } from "./automation-chat";

export const EUREKA_AUTOMATION_CHAT_EXTENSION: InlineExtension = {
  name: "eureka-automation-chat", hidden: true, factory: pi => {
    pi.on("before_agent_start", (_event, ctx) => {
      const task = clarificationRuntime(ctx.sessionManager)?.task;
      if (!chatAutomations(ctx.sessionManager).some(app => task?.plugins.some(ref => ref.source === app.source && ref.capabilityId === app.capabilityId && ref.digest === app.digest))) pi.setActiveTools(pi.getActiveTools().filter(name => name !== AUTOMATION_CHAT_TOOL));
    });
    pi.registerTool({
      name: AUTOMATION_CHAT_TOOL, label: "调用自动化应用", executionMode: "sequential",
      description: "Prepare/start/inspect/stop an explicitly selected installed automation application using its EXISTING runner. prepare accepts declared NON-FILE values only and displays the shared run/configuration card. start reuses that invocation's run ID and saved file grants, login and approvals. Missing config requires the user card, never invented paths. status inspects the SAME run and may wait up to 10 seconds. Do not recreate code, repeat uncertain actions or report unexecuted success.",
      parameters: Type.Object({ appId: Type.String(), mode: Type.Union([Type.Literal("prepare"), Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]), values: Type.Optional(Type.Record(Type.String(), Type.Any())), actionId: Type.Optional(Type.String()), waitSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })) }),
      execute: async (_id, p, signal, _update, ctx) => {
        signal?.throwIfAborted();
        const selected = chatAutomations(ctx.sessionManager), task = clarificationRuntime(ctx.sessionManager)?.task;
        if (!task || task.automationTask || !selected.length) throw new Error("请先在聊天命令菜单选择已安装的自动化应用。");
        const choice = selected.find(app => app.automation?.id === p.appId);
        const auth = automationChatAccess();
        if (!choice || !task.plugins.some(ref => ref.source === choice.source && ref.capabilityId === choice.capabilityId && ref.digest === choice.digest) || task.owner?.source !== auth.issuer || task.owner.subject !== auth.subject) throw new Error("当前任务未选择此应用，或登录身份已变化。");
        const current = (await listAutomationComposerApps(ctx.cwd)).find(app => app.source === choice.source && app.capabilityId === choice.capabilityId && app.digest === choice.digest && app.automation?.revision === choice.automation?.revision);
        if (!current) throw new Error("所选应用已更新、停用或卸载，请重新选择命令。");
        const sessionId = ctx.sessionManager.getSessionId();
        let invocation = (await listChatInvocations(auth, sessionId)).find(item => item.appId === p.appId && item.taskId === task.id);
        if (p.mode === "prepare" || p.mode === "start") invocation ??= await prepareChatInvocation(auth, sessionId, task.id, current, p.values ?? {});
        else invocation ??= (await listChatInvocations(auth, sessionId)).find(item => item.appId === p.appId);
        if (!invocation) throw new Error("当前会话尚未调用此应用，请先准备参数。");
        signal?.throwIfAborted();
        let configurationError: string | undefined;
        if (p.mode === "start") {
          try { await startChatInvocation(auth, invocation, p.actionId); if (signal?.aborted) { await stopAppRun(auth, invocation.appId, invocation.runId); signal.throwIfAborted(); } }
          catch (error) { configurationError = error instanceof Error ? error.message : "无法开始运行，请检查配置卡片。"; }
        }
        if (p.mode === "stop") await stopAppRun(auth, invocation.appId, invocation.runId);
        let value = await chatInvocationResult(auth, invocation);
        const deadline = Date.now() + Math.min(10, Math.max(0, Number(p.waitSeconds) || 0)) * 1000;
        while (["running", "waiting-browser"].includes(value.status) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 800)); signal?.throwIfAborted(); auth.assertIdentity();
          value = await chatInvocationResult(auth, invocation);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...value, ...(configurationError ? { configurationError, message: "未确认开始运行，请处理对话配置卡片；不要重复发起新运行。" } : {}) }) }], details: { automationInvocation: true, invocationId: invocation.id, name: value.name } };
      },
    });
  },
};
