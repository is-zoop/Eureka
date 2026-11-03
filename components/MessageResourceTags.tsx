"use client";
import { useEffect, useState } from "react";
import type { SelectedPlugin } from "@/lib/plugin-selection";
import type { SkillInfo } from "@/lib/api-types";
import type { AutomationAppIndex } from "@/lib/automation-app";
import { exactSkillCapability, type DisplayReference } from "@/lib/message-resources";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";
import { AutomationIcon } from "./AutomationIcon";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
const styles = {"row":"message-resource-tags","tag":"message-resource-tag","capability":"message-resource-capability","label":"message-resource-label","icon":"message-resource-icon"};

// Share in-flight metadata reads across history items. No AgentSession is started.
const pending = new Map<string, Promise<unknown>>();
function metadata<T>(url: string): Promise<T> {
  let request = pending.get(url);
  if (!request) {
    request = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(async response => {
      if (!response.ok) throw new Error(); return response.json();
    });
    pending.set(url, request);
    const release = () => { if (pending.get(url) === request) pending.delete(url); };
    request.then(() => setTimeout(release, 15000), release);
  }
  return request as Promise<T>;
}
export function MessageCapabilityIcon({ plugin, skill, cwd }: { plugin?: SelectedPlugin; skill?: { name: string; location?: string }; cwd?: string }) {
  const [catalog, setCatalog] = useState<{ key: string; capability?: { capabilityId: string; source?: string } } | null>(null);
  const key = JSON.stringify([cwd, plugin?.source, plugin?.capabilityId, plugin?.digest, plugin?.subject, skill?.name, skill?.location]);
  const automation = plugin?.capabilityId.startsWith("automation:");
  useEffect(() => {
    if (!automation && !skill || skill && !cwd) return;
    let current = true;
    const load = automation
      ? metadata<AutomationAppIndex>(`/api/automation/apps${cwd ? `?${new URLSearchParams({ cwd })}` : ""}`).then(index => index.apps.find(app => `automation:${app.id}` === plugin?.capabilityId)?.managedPlugin)
      : metadata<{ skills: SkillInfo[] }>(`/api/skills?${new URLSearchParams({ cwd: cwd!, metadataOnly: "1" })}`).then(data => exactSkillCapability(data.skills ?? [], skill!.name, skill!.location));
    void load.then(capability => { if (current) setCatalog({ key, capability }); }).catch(() => { if (current) setCatalog({ key }); });
    return () => { current = false; };
  }, [key, automation, cwd, plugin?.capabilityId, skill]);
  if (plugin && !automation) return <OrganizationCapabilityIcon capability={plugin} size={16} />;
  const capability = catalog?.key === key ? catalog.capability : undefined;
  if (capability) return <OrganizationCapabilityIcon capability={capability} size={16} type={skill ? "Skill" : "Plugin"} />;
  return automation ? <AutomationIcon size={16} /> : <OrganizationCapabilityIcon capability={{ capabilityId: "" }} iconUrl={null} type="Skill" size={16} />;
}

export function MessageResourceTags({ plugins, references, skill, cwd, expanded, onToggleSkill, onOpenReference }: {
  plugins: SelectedPlugin[]; references: DisplayReference[]; skill?: { name: string; command: string; location?: string };
  cwd?: string; expanded: boolean; onToggleSkill: () => void; onOpenReference?: (reference: DisplayReference) => void;
}) {
  const { t } = useI18n();
  if (!plugins.length && !references.length && !skill) return null;
  return <div className={styles.row}>
    {plugins.map(plugin => <span className={`${styles.tag} ${styles.capability}`} key={`${plugin.source}:${plugin.capabilityId}`}><MessageCapabilityIcon plugin={plugin} cwd={cwd} /><span className={styles.label}>{plugin.name}</span></span>)}
    {skill && <button type="button" className={`${styles.tag} ${styles.capability}`} title={skill.command} aria-label={skill.command} aria-expanded={expanded} onClick={onToggleSkill}><MessageCapabilityIcon skill={skill} cwd={cwd} /><span className={styles.label}>{skill.name}</span></button>}
    {references.map(reference => {
      const name = reference.path.replace(/\\/g, "/").split("/").at(-1) || reference.path;
      return <button key={`${reference.isDir}:${reference.path}`} type="button" className={styles.tag} title={reference.path} aria-label={t("chat.openReference", { path: reference.path })} onClick={() => onOpenReference?.(reference)}><span className={styles.icon}>{reference.isDir ? <FolderIcon size={16} /> : getFileIcon(name, 16)}</span><span className={styles.label}>{name}{reference.isDir ? "/" : ""}</span></button>;
    })}
  </div>;
}
