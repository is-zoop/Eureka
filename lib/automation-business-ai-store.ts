import { join } from "node:path";
import type { AutomationAppStore } from "./automation-app-store";
import { DEFAULT_BUSINESS_AI, parseBusinessAi } from "./automation-business-ai";
import { assertAppIdle } from "./automation-app-lease";
import { AutomationAppError } from "./automation-app-package";
import { appActions } from "./automation-app-actions";

export async function readBusinessAi(store: AutomationAppStore, appId: string) {
  await store.detail(appId);
  try {
    const raw = JSON.parse((await store.privateBytes(join(store.dataDirectory(appId), "business-ai.json"), 4096)).toString("utf8"));
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error("业务 AI 配置记录损坏。");
    return { revision: raw.revision as number, settings: parseBusinessAi(raw.settings) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: 0, settings: structuredClone(DEFAULT_BUSINESS_AI) }; throw error; }
}
export async function saveBusinessAi(store: AutomationAppStore, appId: string, revision: number, configRevision: number, value: unknown) {
  let settings; try { settings = parseBusinessAi(value); } catch (error) { throw new AutomationAppError((error as Error).message, 400); }
  return store.admitRun(appId, revision, async detail => {
    await assertAppIdle(detail.dataDirectory);
    if (!appActions(detail).some(action => (action.capabilities ?? detail.manifest.automation.capabilities).includes("ai"))) throw new AutomationAppError("此应用未声明业务 AI 能力。", 400);
    const current = await readBusinessAi(store, appId);
    if (current.revision !== configRevision) throw new AutomationAppError("业务 AI 配置已变化，请重新加载。", 409);
    const saved = { revision: current.revision + 1, settings };
    await store.privateJson(join(detail.dataDirectory, "business-ai.json"), saved); return saved;
  }, false);
}
