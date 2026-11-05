import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { clarificationRuntime } from "./clarification-runtime";
import { appRunActive } from "./automation-app-run";
import { advanceAppRun, appRunValue, getAppRun } from "./automation-app-runtime";
import { AUTOMATION_CHAT_TOOL, automationChatAccess, chatAutomations, chatInvocationResult, chatInvocationSnapshot, listAutomationComposerApps, listChatInvocations,
  prepareChatInvocation, configureChatInvocation, startChatInvocation, stopAppRun, prepareChatRestart, applyChatInteraction, askChatInteraction } from "./automation-chat";

export const EUREKA_AUTOMATION_CHAT_EXTENSION: InlineExtension = {
  name: "eureka-automation-chat", hidden: true, factory: pi => {
    pi.on("before_agent_start", (_event, ctx) => {
      const task = clarificationRuntime(ctx.sessionManager)?.task;
      if (!chatAutomations(ctx.sessionManager).some(app => task?.plugins.some(ref => ref.source === app.source && ref.capabilityId === app.capabilityId && ref.digest === app.digest))) pi.setActiveTools(pi.getActiveTools().filter(name => name !== AUTOMATION_CHAT_TOOL));
    });
    pi.registerTool({
      name: AUTOMATION_CHAT_TOOL, label: "执行自动化流程", executionMode: "sequential",
      description: "Run a selected SAVED app directly in conversation with no app UI or manual Run button. inspect/prepare reads declared fields, SAVED config and workflow. configure patches NON-FILE values: persist=false applies to this invocation only; persist=true saves defaults with configRevision. choose_file opens a USER-owned picker/clarification for a declared fileFieldId. start uses saved config plus overrides and pauses before actual ctx.step work. next requires the returned pending stepToken and executes ONE top-level step; nested substeps belong to that step. Keep using next/status until completion, without asking the user to click Run. status/next never create a replacement run. Explicit restart after user retry creates a new run. stop cancels. Login, questions and scoped web approval are durable clarification cards: wait for the user's answer, then status/next resumes the SAME run. Never manufacture approvals or file grants. executionMode=whole is explicit compatibility for old scripts that cannot be step-driven; never silently rerun a failed/uncertain mutation. value reads an actual valueRef with valuePath/offset/limit pagination. For multi-function apps inspect actions first, choose the actionId matching the user request, and pass it consistently to prepare/configure/choose_file/start/status/next/value/restart. Each function owns its config, input schema, graph and result columns; never reuse parameters from another function or run every function. Ask only when function choice is materially ambiguous. On completion read actual result (paginate value if needed), show requested details and a summary, not only a success flag. Do not generate CSV/JSON unless requested or the stated business goal is a file. Report true step inputs/outputs and actual artifacts only.",
      parameters: Type.Object({ appId: Type.String(), mode: Type.Union(["inspect", "prepare", "configure", "choose_file", "start", "next", "status", "restart", "stop", "value"].map(value => Type.Literal(value))),
        values: Type.Optional(Type.Record(Type.String(), Type.Any())), persist: Type.Optional(Type.Boolean()), configRevision: Type.Optional(Type.Number({ minimum: 0 })),
        fileFieldId: Type.Optional(Type.String()), access: Type.Optional(Type.Union([Type.Literal("read"), Type.Literal("readwrite")])),
        actionId: Type.Optional(Type.String()), executionMode: Type.Optional(Type.Union([Type.Literal("steps"), Type.Literal("whole")])), stepToken: Type.Optional(Type.String()),
        after: Type.Optional(Type.Number({ minimum: 0 })), waitSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
        valueRef: Type.Optional(Type.String()), valuePath: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number({ minimum: 0 })]))), offset: Type.Optional(Type.Number({ minimum: 0 })), limit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })) }),
      execute: async (toolCallId, p, signal, _update, ctx) => {
        signal?.throwIfAborted();
        const controller = clarificationRuntime(ctx.sessionManager), selected = chatAutomations(ctx.sessionManager), task = controller?.task;
        if (!controller || !task || task.automationTask || !selected.length) throw new Error("请先在聊天命令菜单选择已安装的自动化应用。");
        const choice = selected.find(app => app.automation?.id === p.appId), auth = automationChatAccess();
        if (!choice || !task.plugins.some(ref => ref.source === choice.source && ref.capabilityId === choice.capabilityId && ref.digest === choice.digest) || task.owner?.source !== auth.issuer || task.owner.subject !== auth.subject) throw new Error("当前任务未选择此应用，或登录身份已变化。");
        const current = (await listAutomationComposerApps(ctx.cwd)).find(app => app.source === choice.source && app.capabilityId === choice.capabilityId && app.digest === choice.digest && app.automation?.revision === choice.automation?.revision);
        if (!current) throw new Error("所选应用已更新、停用或卸载，请重新选择命令。");
        const sessionId = ctx.sessionManager.getSessionId(), invocations = await listChatInvocations(auth, sessionId);
        let invocation = invocations.find(item => item.appId === p.appId && item.taskId === task.id && (!p.actionId || item.actionId === p.actionId));
        if (!invocation && (["inspect", "next", "status", "restart", "stop", "value"].includes(p.mode) || p.mode === "configure" && p.persist)) invocation = invocations.find(item => item.appId === p.appId && (!p.actionId || item.actionId === p.actionId));
        if (!invocation) invocation = await prepareChatInvocation(auth, sessionId, task.id, current, p.values ?? {}, p.actionId);
        await applyChatInteraction(auth, invocation, controller);
        invocation = (await chatInvocationSnapshot(auth, invocation)).invocation;
        const modesWithOverrides = ["configure", "prepare", "start"];
        if (p.values && modesWithOverrides.includes(p.mode)) await configureChatInvocation(auth, invocation, p.values, p.persist ?? false, p.configRevision);
        if (p.mode === "choose_file") {
          if (!p.fileFieldId) throw new Error("请指定文件配置项 fileFieldId。");
          await askChatInteraction(auth, invocation, controller, toolCallId, { fieldId: p.fileFieldId, persist: p.persist ?? false, access: p.access ?? "read" });
        }
        if (p.mode === "restart") {
          invocation = await prepareChatRestart(auth, sessionId, invocation.id, invocation.runId, randomUUID());
        }
        if (p.mode === "start" || p.mode === "restart") {
          signal?.throwIfAborted();
          await startChatInvocation(auth, invocation, p.actionId, p.executionMode ?? invocation.executionMode ?? "steps");
          if (signal?.aborted) { await stopAppRun(auth, invocation.appId, invocation.runId); signal.throwIfAborted(); }
        }
        if (p.mode === "next") {
          if (!p.stepToken) throw new Error("请使用当前 pendingSteps 中的 stepToken，不按节点名称猜测或跳步。");
          await advanceAppRun(auth, invocation.appId, invocation.runId, p.stepToken);
        }
        if (p.mode === "stop") await stopAppRun(auth, invocation.appId, invocation.runId);
        if (p.mode === "value") {
          if (!p.valueRef) throw new Error("请指定真实输出中的 valueRef。");
          let value = await appRunValue(auth, invocation.appId, invocation.runId, p.valueRef);
          for (const key of p.valuePath ?? []) {
            if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("结果字段路径不存在。");
            value = (value as Record<string | number, unknown>)[key];
          }
          const offset = Math.max(0, Math.trunc(p.offset ?? 0)), limit = Math.min(1000, Math.max(1, Math.trunc(p.limit ?? 100)));
          const page = Array.isArray(value) ? { values: value.slice(offset, offset + limit), total: value.length, nextOffset: offset + limit < value.length ? offset + limit : null } : { value };
          const output = Buffer.byteLength(JSON.stringify(page)) <= 64000 ? page : { tooLarge: true, message: "缩小 limit 或指定 valuePath 读取子字段；未返回完整数据。", keys: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : undefined };
          return { content: [{ type: "text" as const, text: JSON.stringify(output) }], details: { automationInvocation: true, invocationId: invocation.id, name: current.name } };
        }
        const deadline = Date.now() + Math.min(10, Math.max(0, p.waitSeconds ?? (["start", "next", "restart"].includes(p.mode) ? 10 : 0))) * 1000;
        while (!controller.blocked && Date.now() < deadline) {
          const { run } = await chatInvocationSnapshot(auth, invocation);
          if (!run || !appRunActive(run.status) || run.status === "waiting-user" || run.status === "waiting-browser" || run.stepControl?.pending.length && !run.stepControl.current) break;
          await new Promise(resolve => setTimeout(resolve, 500)); signal?.throwIfAborted(); auth.assertIdentity();
        }
        const waitingForUser = controller.blocked || await askChatInteraction(auth, invocation, controller, toolCallId);
        const value = await chatInvocationResult(auth, invocation, p.after ?? 0);
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...value, waitingForUser }) }], details: { automationInvocation: true, invocationId: invocation.id, name: value.name }, ...(waitingForUser ? { terminate: true } : {}) };
      },
    });
  },
};
