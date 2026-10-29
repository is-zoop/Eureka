import { getAgentDir, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectivePlugins } from "./haze-registry";
import { validatedPluginRoot, pluginMcpName, pluginPresentation, getPluginSnapshots, installedPluginComposer } from "./haze-plugin-resources";
import { getProjectTrustStatus } from "./project-trust";
import { isPathWithinRoots } from "./path-security";
import { readRuntimeHazeSession } from "./auth/runtime-session";
import { splitPluginSelection, selectionEnvelope, type SelectedPlugin, type ComposerPlugin } from "./plugin-selection";
import type { ClarificationTask } from "./clarification";

/** Resolve only explicit plugin/skill entrypoints, never names found in ordinary prose. */
export function taskPluginSelection(cwd: string, sessionId: string, raw: unknown, skills: ReadonlyArray<{ name: string; filePath?: string }>, message: string): SelectedPlugin[] {
  if (raw !== undefined && !Array.isArray(raw)) throw new Error("插件选择无效");
  const selected = Array.isArray(raw) ? raw as SelectedPlugin[] : [];
  const match = /^\/skill:([^\s]+)(?:\s|$)/.exec(message);
  if (!match) return selected;
  const skill = skills.find((s) => s.name === match[1]);
  const identity = readRuntimeHazeSession();
  if (!identity || !skill?.filePath) return selected;
  const source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "") ?? "";
  const owner = effectivePlugins(cwd, source).find((item) => !item.disabled && item.plugin && isPathWithinRoots(skill.filePath!, new Set([validatedPluginRoot(cwd, item)])));
  if (!owner?.plugin) return selected;
  return [...selected.filter((ref) => ref.source !== source || ref.capabilityId !== owner.capabilityId), { source, capabilityId: owner.capabilityId, digest: owner.plugin.digest, name: owner.plugin.manifest.displayName }];
}

export function taskAllowsClarification(cwd: string, sessionId: string, task: ClarificationTask): boolean {
  const identity = readRuntimeHazeSession();
  if (task.owner && (!identity || process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "") !== task.owner.source || identity.principal.subject !== task.owner.subject)) throw new Error("当前身份已变化，请重新调用插件；澄清回答已保留");
  if (task.clarificationEnabled) return true;
  return task.plugins.some((ref) => {
    const install = effectivePlugins(cwd, ref.source).find((item) => item.capabilityId === ref.capabilityId);
    const loaded = getPluginSnapshots(sessionId).find((p) => p.source === ref.source && p.capabilityId === ref.capabilityId);
    return Boolean(install && !install.disabled && install.plugin?.digest === ref.digest && loaded?.digest === ref.digest && !loaded.error && loaded.capabilities?.requestUserInput === true && install.plugin.manifest.capabilities?.requestUserInput === true);
  });
}

export function listComposerPlugins(cwd: string, source: string, subject: string, sessionId?: string): ComposerPlugin[] {
  return effectivePlugins(cwd, source).map((item) => {
    const p = item.plugin!;
    let state = pluginPresentation(item, sessionId, subject)!.state;
    const skills: string[] = [];
    let description = "";
    let selectionMode: "once" | "persistent" = p.manifest.composer?.selectionMode ?? "once";
    try {
      if (item.scope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) throw new Error();
      const root = validatedPluginRoot(cwd, item);
      selectionMode = installedPluginComposer(cwd, item).selectionMode;
      const manifest = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8"));
      description = typeof manifest.description === "string" ? manifest.description.slice(0, 2000) : "";
      for (const dir of p.manifest.skillDirectories) {
        const path = realpathSync(resolve(root, dir));
        if (!isPathWithinRoots(path, new Set([root]))) throw new Error();
        skills.push(...loadSkillsFromDir({ dir: path, source: item.scope }).skills.map((s) => s.name));
      }
    } catch { state = "failed"; }
    return { source, capabilityId: item.capabilityId, digest: p.digest, name: p.manifest.displayName || item.name, description: description || p.manifest.name, skills, state, selectionMode, subject };
  });
}

export function prepareSelectedPlugins(cwd: string, sessionId: string, raw: unknown, skills: ReadonlyArray<{ name: string; filePath?: string; description?: string }>, message: string): string {
  if (raw === undefined) return message;
  if (!Array.isArray(raw) || raw.length > 20) throw new Error("插件选择无效");
  if (!raw.length) return message;
  const identity = readRuntimeHazeSession();
  const source = process.env.EUREKA_AUTH_HAZE_ISSUER?.replace(/\/$/, "");
  if (!identity || !source) throw new Error("请先登录 Haze 后使用组织插件");
  const available = listComposerPlugins(cwd, source, identity.principal.subject, sessionId);
  const selected: SelectedPlugin[] = [];
  const descriptions: string[] = [];
  const seen = new Set<string>();
  for (const ref of raw) {
    if (!ref || typeof ref !== "object") throw new Error("插件选择无效");
    if (ref.subject !== undefined && ref.subject !== identity.principal.subject) throw new Error("插件当前不可用：选择属于其他账号，请移除后重新选择");
    const entry = available.find((item) => item.source === ref.source && item.capabilityId === ref.capabilityId);
    if (!entry || entry.digest !== ref.digest) throw new Error("所选插件已更改，请重新选择并重载会话");
    if (entry.state !== "loaded") throw new Error(`${entry.name} 当前不可用（${entry.state}），请检查认证、启用状态并重载会话`);
    if (seen.has(entry.capabilityId)) continue;
    seen.add(entry.capabilityId);
    const item = effectivePlugins(cwd, source).find((i) => i.capabilityId === entry.capabilityId)!;
    const root = validatedPluginRoot(cwd, item);
    const actual = skills.filter((skill) => typeof skill.filePath === "string" && isPathWithinRoots(skill.filePath, new Set([root])));
    if (actual.length !== entry.skills.length) throw new Error(`${entry.name} 存在技能冲突或技能未加载，请检查诊断并重载`);
    selected.push({ source, capabilityId: entry.capabilityId, digest: entry.digest, name: entry.name });
    descriptions.push(`${entry.name}: ${entry.description}\nUse its applicable skill instructions before calling its MCP tools. Skills:\n${actual.map((s) => `- ${s.name}: ${s.description} (${s.filePath})`).join("\n")}\nMCP server namespaces: ${item.plugin!.manifest.servers.map((s) => pluginMcpName(item, s.name)).join(", ")}`);
  }
  return selectionEnvelope(splitPluginSelection(message).text, selected, `The user explicitly selected these plugins for this message. This does not grant additional tool permissions.\n${descriptions.join("\n\n")}`);
}
