"use client";

import { NotificationNotice } from "./Notifications";
import { notify } from "@/lib/notification-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, ClockIcon, CpuIcon, EyeIcon, LayersIcon, LayoutGridIcon, LayoutListIcon, PackagePlusIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, StarIcon, Trash2Icon } from "lucide-react";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { McpConfig } from "./McpConfig";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { HazeCapabilityInstallDialog, HazeMcpConfigDialog, type InstallScope, type McpRuntimeOptions } from "./HazeCapabilityDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { useI18n } from "@/hooks/useI18n";

type ExtensionGroup = "organization" | "market";
type OrganizationSection = "skills" | "mcp";
type MarketSection = "skills" | "plugins" | "mcp";
type ViewMode = "cards" | "table";
type Filter = { kind: "all" | "favorites" | "frequent" } | { kind: "category"; categoryId: number };
type OrganizationExtension = OrganizationExtensionDetailItem & { categoryId: number | null };
type OrganizationCategory = { id: number; name: string };
type LoadState = "loading" | "ready" | "empty" | "unauthenticated" | "forbidden" | "error";
type OrganizationCache = Partial<Record<OrganizationSection, { items: OrganizationExtension[] }>>;
type InstalledCapability = { capabilityId: string; name: string; type: "Skill" | "MCP"; version: string; scope: InstallScope; installedAt: string; disabled: boolean; lifecycle?: McpRuntimeOptions["lifecycle"]; idleTimeout?: number };
type ListedCapability = OrganizationExtension & { marketUnavailable?: boolean; installedAt?: string; disabled?: boolean; marketVersion?: string; lifecycle?: McpRuntimeOptions["lifecycle"]; idleTimeout?: number };
type Props = { cwd: string; sessionId: string | null; onReloaded?: () => void; onOpenExtensionDetails: (item: OrganizationExtensionDetailItem, onFavoriteChange: (id: string, isFavorite: boolean) => void) => void };

function ExtensionIcon({ kind }: { kind: "skills" | "mcp" | "plugins" }) {
  const common = { width: 16, height: 16, "aria-hidden": true };
  if (kind === "skills") return <LayersIcon {...common} />;
  if (kind === "mcp") return <CpuIcon {...common} />;
  return <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" /><path d="M12 19v3" /></svg>;
}

function CapabilityIcon({ item }: { item: OrganizationExtension }) {
  const [failed, setFailed] = useState(false);
  const fallback = item.type === "MCP" ? <CpuIcon className="h-5 w-5" /> : <LayersIcon className="h-5 w-5" />;
  return <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] bg-[var(--bg-hover)] text-[var(--text-muted)]">{item.iconUrl && !failed ? <img src={item.iconUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : fallback}</span>;
}

function formatCalls(calls: number) { return calls >= 1000 ? `${(calls / 1000).toFixed(calls >= 10_000 ? 0 : 1)}k` : String(calls); }

function compareVersions(localVersion: string, remoteVersion: string) {
  const parse = (version: string) => version.trim().replace(/^v/i, "").split(/[.+-]/).map((part) => /^\d+$/.test(part) ? Number(part) : 0);
  const local = parse(localVersion);
  const remote = parse(remoteVersion);
  const length = Math.max(local.length, remote.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (local[index] ?? 0) - (remote[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function hasSkillUpdate(item: ListedCapability) {
  if (item.type !== "Skill" || !item.marketVersion) return false;
  return compareVersions(item.version, item.marketVersion) < 0;
}

function getFilterLabel(filter: Filter, categories: OrganizationCategory[], t: (key: string) => string) {
  if (filter.kind === "favorites") return t("extensions.favorites");
  if (filter.kind === "frequent") return t("extensions.frequent");
  if (filter.kind === "category") return categories.find((category) => category.id === filter.categoryId)?.name ?? t("extensions.businessCategories");
  return t("extensions.allCapabilities");
}

function ViewToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (viewMode: ViewMode) => void }) {
  const { t } = useI18n();
  const buttonClass = (active: boolean) => `grid h-7 w-7 place-items-center rounded-[calc(var(--radius-control)-2px)] transition-colors ${active ? "bg-[var(--bg-selected)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}`;
  return <div className="flex items-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-hover)] p-0.5">
    <Tooltip><TooltipTrigger render={<button type="button" aria-label={t("extensions.cardView")} className={buttonClass(viewMode === "cards")} onClick={() => onChange("cards")}><LayoutGridIcon className="h-4 w-4" /></button>} /><TooltipContent>{t("extensions.cardView")}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger render={<button type="button" aria-label={t("extensions.tableView")} className={buttonClass(viewMode === "table")} onClick={() => onChange("table")}><LayoutListIcon className="h-4 w-4" /></button>} /><TooltipContent>{t("extensions.tableView")}</TooltipContent></Tooltip>
  </div>;
}

function FilterMenu({ filter, categories, items, onChange }: { filter: Filter; categories: OrganizationCategory[]; items: OrganizationExtension[]; onChange: (filter: Filter) => void }) {
  const { t } = useI18n();
  const active = (next: Filter) => next.kind === filter.kind && (next.kind !== "category" || filter.kind === "category" && next.categoryId === filter.categoryId);
  const countFor = (categoryId: number) => items.filter((item) => item.categoryId === categoryId).length;
  const itemClass = (selected: boolean) => `min-w-48 cursor-pointer text-[13px] text-[var(--text)] ${selected ? "font-medium" : "hover:bg-[var(--bg-hover)]"}`;
  const option = (label: string, next: Filter, icon?: React.ReactNode, count?: number) => <DropdownMenuItem key={label} className={itemClass(active(next))} style={active(next) ? { backgroundColor: "var(--bg-hover)" } : undefined} onClick={() => onChange(next)}>{icon}{label}{typeof count === "number" && <span className="ml-auto rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">{count}</span>}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger render={<button type="button" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)] px-3 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><SlidersHorizontalIcon className="h-3.5 w-3.5" />{getFilterLabel(filter, categories, t)}<ChevronDownIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" /></button>} /><DropdownMenuContent className="w-56 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)] p-1 shadow-[var(--shadow-soft)]"><DropdownMenuGroup>{option(t("extensions.allCapabilities"), { kind: "all" }, undefined, items.length)}{option(t("extensions.favorites"), { kind: "favorites" }, <StarIcon className="h-3.5 w-3.5" />, items.filter((item) => item.isFavorite).length)}{option(t("extensions.frequent"), { kind: "frequent" }, <ClockIcon className="h-3.5 w-3.5" />, items.filter((item) => item.calls >= 1000).length)}</DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuLabel className="px-2 py-1.5 text-[13px] text-[var(--text-muted)]">{t("extensions.businessCategories")}</DropdownMenuLabel>{categories.map((category) => option(category.name, { kind: "category", categoryId: category.id }, undefined, countFor(category.id)))}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}

function InstallMenu({ item, state, onInstall }: { item: OrganizationExtension; state: "idle" | "installing" | "installed"; onInstall: (item: OrganizationExtension) => void }) {
  const { t } = useI18n();
  return <Button size="sm" disabled={state !== "idle"} onClick={() => onInstall(item)}>{state === "installing" ? <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : state === "installed" ? <CheckIcon className="mr-1.5 h-3.5 w-3.5" /> : <PackagePlusIcon className="mr-1.5 h-3.5 w-3.5" />}{state === "installing" ? t("extensions.installing") : state === "installed" ? t("extensions.installedSuccess") : t("extensions.install")}</Button>;
}

type InstalledAction = "update" | "uninstall" | "configure";

function InstalledActions({ item, disabled, onAction }: { item: ListedCapability; disabled: boolean; onAction: (item: ListedCapability, action: InstalledAction) => void }) {
  const { t } = useI18n();
  const canUpdate = item.type === "Skill" && !item.marketUnavailable;
  return <DropdownMenu><DropdownMenuTrigger disabled={disabled} render={<Button size="sm" className="bg-blue-500 text-white hover:bg-blue-600"><SlidersHorizontalIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.manage")}<ChevronDownIcon className="ml-1 h-3.5 w-3.5" /></Button>} /><DropdownMenuContent align="end" className="min-w-28 border border-[var(--border)] bg-[var(--bg-panel)] p-1 shadow-[var(--shadow-soft)]">{canUpdate ? <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => onAction(item, "update")}><RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.update")}</DropdownMenuItem> : null}{item.type === "MCP" ? <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => onAction(item, "configure")}><SlidersHorizontalIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.configure")}</DropdownMenuItem> : null}<DropdownMenuItem className="cursor-pointer text-xs text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => onAction(item, "uninstall")}><Trash2Icon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.uninstall")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function CapabilityCards({ items, onOpenDetails, installBusyId, installSuccessId, onInstall, installedActionBusyId, onInstalledAction, toggleBusyId, onSetDisabled }: { items: ListedCapability[]; onOpenDetails: (item: OrganizationExtension) => void; installBusyId: string | null; installSuccessId: string | null; onInstall: (item: OrganizationExtension) => void; installedActionBusyId: string | null; onInstalledAction: (item: ListedCapability, action: InstalledAction) => void; toggleBusyId: string | null; onSetDisabled: (item: OrganizationExtension, disabled: boolean) => void }) {
  const { t } = useI18n();
  if (!items.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--text-muted)]">{t("extensions.noMatches")}</div>;
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => {
    const tags = item.category && !item.tags.includes(item.category) ? [item.category, ...item.tags] : item.tags;
    const attribution = [item.author, item.department].filter(Boolean).join(" · ");
    const updateAvailable = hasSkillUpdate(item);
    const installedLabel = item.marketUnavailable ? t("extensions.installedVersion", { version: item.version }) : `${attribution || t("extensions.marketUnknownAuthor")} · v${item.version}`;
    return <Card key={item.id} className="organization-extension-card flex min-h-52 flex-col rounded-[var(--radius-card)] bg-[var(--bg-panel)] p-4 shadow-none"><div className="flex min-w-0 items-start gap-3"><CapabilityIcon item={item} /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-[var(--text)]">{item.name}</h2><span className="mt-1 inline-flex rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs font-semibold text-[var(--text-muted)]">{item.type}</span></div>{item.installedAt ? <Switch checked={!item.disabled} disabled={toggleBusyId === item.id} aria-label={`${item.disabled ? t("extensions.enable") : t("extensions.disable")}${item.name}`} onCheckedChange={(checked) => onSetDisabled(item, !checked)} /> : null}</div><CardContent className="mt-3 px-0"><p className="line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">{item.marketUnavailable ? t("extensions.marketUnavailable") : item.description || t("extensions.marketNoDescription")}</p><div className="mt-2 flex min-h-5 flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{tag}</span>)}</div></CardContent><div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs text-[var(--text-muted)]">{item.installedAt ? installedLabel : attribution || t("extensions.marketUnknownAuthor")}</span>{updateAvailable ? <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600">{t("extensions.updateAvailable")}</span> : null}</div><div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" onClick={() => onOpenDetails(item)}><EyeIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.viewDetails")}</Button>{item.installedAt ? <InstalledActions item={item} disabled={installedActionBusyId === item.id} onAction={onInstalledAction} /> : <InstallMenu item={item} state={installBusyId === item.id ? "installing" : installSuccessId === item.id ? "installed" : "idle"} onInstall={onInstall} />}</div></div></Card>;
  })}</div>;
}

function CapabilityTable({ items, onOpenDetails, installBusyId, installSuccessId, onInstall, installedActionBusyId, onInstalledAction, showEnabledColumn, toggleBusyId, onSetDisabled }: { items: ListedCapability[]; onOpenDetails: (item: OrganizationExtension) => void; installBusyId: string | null; installSuccessId: string | null; onInstall: (item: OrganizationExtension) => void; installedActionBusyId: string | null; onInstalledAction: (item: ListedCapability, action: InstalledAction) => void; showEnabledColumn: boolean; toggleBusyId: string | null; onSetDisabled: (item: OrganizationExtension, disabled: boolean) => void }) {
  const { t } = useI18n();
  if (!items.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--text-muted)]">{t("extensions.noMatches")}</div>;
  return <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]"><table className="min-w-[1040px] w-full border-collapse text-left text-xs"><thead className="bg-[var(--bg-hover)] text-[var(--text-muted)]"><tr><th className="whitespace-nowrap px-4 py-2 font-medium">{t("session.name")}</th><th className="whitespace-nowrap px-3 py-2 font-medium">{t("extensions.capabilityDescription")}</th><th className="whitespace-nowrap px-3 py-2 font-medium">{t("extensions.capabilityTags")}</th><th className="whitespace-nowrap px-3 py-2 font-medium">{t("extensions.developer")} / {t("extensions.department")}</th><th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("extensions.calls")}</th>{showEnabledColumn ? <th className="whitespace-nowrap px-3 py-2 text-center font-medium">{t("extensions.enabled")}</th> : null}<th className="sticky right-0 z-20 whitespace-nowrap border-l border-[var(--border)] bg-[var(--bg-hover)] px-4 py-2 text-right font-medium">{t("extensions.manage")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[var(--border)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]"><td className="whitespace-nowrap px-4 py-2"><div className="flex items-center gap-2"><CapabilityIcon item={item} /><span className="max-w-56 truncate font-medium text-[var(--text)]">{item.name}</span>{hasSkillUpdate(item) ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">{t("extensions.updateAvailable")}</span> : null}</div></td><td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]"><p className="max-w-80 truncate">{item.marketUnavailable ? t("extensions.marketUnavailable") : item.description || t("extensions.marketNoDescription")}</p></td><td className="whitespace-nowrap px-3 py-2"><div className="flex max-w-48 flex-nowrap gap-1 overflow-hidden">{item.tags.slice(0, 2).map((tag) => <span key={tag} className="shrink-0 rounded bg-[var(--bg-hover)] px-1 py-0.5 text-[11px] text-[var(--text-muted)]">{tag}</span>)}</div></td><td className="max-w-44 truncate whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{[item.author, item.department].filter(Boolean).join(" · ") || t("extensions.marketUnknownAuthor")}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-muted)]">{formatCalls(item.calls)}</td>{showEnabledColumn ? <td className="whitespace-nowrap px-3 py-2 text-center">{item.installedAt ? <Switch checked={!item.disabled} disabled={toggleBusyId === item.id} aria-label={`${item.disabled ? t("extensions.enable") : t("extensions.disable")}${item.name}`} onCheckedChange={(checked) => onSetDisabled(item, !checked)} /> : null}</td> : null}<td className="sticky right-0 z-10 whitespace-nowrap border-l border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => onOpenDetails(item)}><EyeIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.viewDetails")}</Button>{item.installedAt ? <InstalledActions item={item} disabled={installedActionBusyId === item.id} onAction={onInstalledAction} /> : <InstallMenu item={item} state={installBusyId === item.id ? "installing" : installSuccessId === item.id ? "installed" : "idle"} onInstall={onInstall} />}</div></td></tr>)}</tbody></table></div>;
}

function fallbackInstalledCapability(install: InstalledCapability): ListedCapability {
  return {
    id: install.capabilityId,
    name: install.name,
    type: install.type,
    description: "",
    author: "",
    department: null,
    categoryId: null,
    category: null,
    tags: [],
    calls: 0,
    isFavorite: false,
    updatedAt: null,
    version: install.version,
    connectType: null,
    serverUrl: null,
    versionHistory: [],
    iconUrl: null,
    marketUnavailable: true,
    installedAt: install.installedAt,
    disabled: install.disabled,
  };
}

function OrganizationExtensionsPage({ kind, cwd, cached, categories, onLoaded, onCategoriesLoaded, onOpenDetails }: { kind: OrganizationSection; cwd: string; cached?: { items: OrganizationExtension[] }; categories?: OrganizationCategory[]; onLoaded: (kind: OrganizationSection, items: OrganizationExtension[]) => void; onCategoriesLoaded: (categories: OrganizationCategory[]) => void; onOpenDetails: (item: OrganizationExtension) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>(() => cached ? (cached.items.length ? "ready" : "empty") : "loading");
  const [items, setItems] = useState<OrganizationExtension[]>(() => cached?.items ?? []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [viewMode, setViewMode] = useState<ViewMode>(() => typeof window !== "undefined" && window.localStorage.getItem("eureka-organization-extensions-view") === "table" ? "table" : "cards");
  const [installBusyId, setInstallBusyId] = useState<string | null>(null);
  const [installSuccessId, setInstallSuccessId] = useState<string | null>(null);
  const [installedActionBusyId, setInstalledActionBusyId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<OrganizationExtension | null>(null);
  const [mcpConfigTarget, setMcpConfigTarget] = useState<ListedCapability | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const [showInstalled, setShowInstalled] = useState(false);
  const [installedScope, setInstalledScope] = useState<InstallScope>("global");
  const [installed, setInstalled] = useState<InstalledCapability[]>([]);
  const [installedState, setInstalledState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [installationRevision, setInstallationRevision] = useState(0);

  const install = async (item: OrganizationExtension, scope: InstallScope, runtime?: McpRuntimeOptions) => {
    if (!cwd || installBusyId) return;
    setInstallBusyId(item.id);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope, action: "install", type: item.type, ...(runtime ?? {}) }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "安装失败，请稍后重试。");
      notify({ type: "success", title: "已安装", message: `${item.name}已${scope === "project" ? "项目" : "全局"}安装。重载会话后生效。` });
      setInstallationRevision((current) => current + 1);
      setInstallSuccessId(item.id);
      window.setTimeout(() => setInstallSuccessId((current) => current === item.id ? null : current), 1200);
      return true;
    } catch (error) {
      notify({ type: "error", title: "安装失败", message: error instanceof Error ? error.message : "安装失败，请稍后重试。" });
      return false;
    } finally {
      setInstallBusyId(null);
    }
  };

  const runInstalledAction = async (item: ListedCapability, action: Exclude<InstalledAction, "configure">) => {
    if (!cwd || installedActionBusyId) return;
    setInstalledActionBusyId(item.id);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: installedScope, action, type: item.type }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "操作失败，请稍后重试。");
      const actionText = action === "update" ? "已更新" : "已卸载";
      notify({ type: "success", title: actionText, message: `${item.name}${actionText}。重载会话后生效。` });
      setInstallationRevision((current) => current + 1);
    } catch (error) {
      notify({ type: "error", title: action === "update" ? "更新失败" : "卸载失败", message: error instanceof Error ? error.message : "操作失败，请稍后重试。" });
    } finally {
      setInstalledActionBusyId(null);
    }
  };

  const configureMcp = async (item: ListedCapability, runtime: McpRuntimeOptions) => {
    if (!cwd || installedActionBusyId) return false;
    setInstalledActionBusyId(item.id);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope: installedScope, action: "configure", type: "MCP", ...runtime }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "配置失败，请稍后重试。");
      setInstalled((current) => current.map((install) => install.capabilityId === item.id ? { ...install, ...runtime } : install));
      notify({ type: "success", title: "配置已保存", message: `${item.name}的 MCP 配置已保存。重载会话后生效。` });
      setInstallationRevision((current) => current + 1);
      return true;
    } catch (error) {
      notify({ type: "error", title: "配置失败", message: error instanceof Error ? error.message : "配置失败，请稍后重试。" });
      return false;
    } finally { setInstalledActionBusyId(null); }
  };

  const handleInstalledAction = (item: ListedCapability, action: InstalledAction) => {
    if (action === "configure") { setMcpConfigTarget(item); return; }
    void runInstalledAction(item, action);
  };

  const setDisabled = async (item: OrganizationExtension, disabled: boolean) => {
    if (!cwd || toggleBusyId) return;
    setToggleBusyId(item.id);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope: installedScope, action: "set-disabled", type: item.type, disabled }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "操作失败，请稍后重试。");
      setInstalled((current) => current.map((install) => install.capabilityId === item.id ? { ...install, disabled } : install));
      notify({ type: "success", title: disabled ? "已停用" : "已启用", message: `${item.name}${disabled ? "已停用" : "已启用"}。重载会话后生效。` });
      setInstallationRevision((current) => current + 1);
    } catch (error) {
      notify({ type: "error", title: "操作失败", message: error instanceof Error ? error.message : "操作失败，请稍后重试。" });
    } finally {
      setToggleBusyId(null);
    }
  };

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (!background) setState("loading");
    try {
      const response = await fetch(`/api/organization-extensions?type=${kind === "skills" ? "skill" : "mcp"}`, { signal, cache: "no-store" });
      const payload = await response.json().catch(() => null) as { items?: OrganizationExtension[]; error?: string } | null;
      if (signal?.aborted) return;
      if (response.ok && Array.isArray(payload?.items)) {
        setItems(payload.items);
        setState(payload.items.length ? "ready" : "empty");
        onLoaded(kind, payload.items);
        return;
      }
      if (!background) setState(payload?.error === "unauthenticated" ? "unauthenticated" : payload?.error === "forbidden" ? "forbidden" : "error");
    } catch (error) {
      if ((error as Error).name !== "AbortError" && !background) setState("error");
    }
  }, [kind, onLoaded]);

  useEffect(() => {
    if (cached) {
      setItems(cached.items);
      setState(cached.items.length ? "ready" : "empty");
    }
    const controller = new AbortController();
    void load(controller.signal, Boolean(cached));
    return () => controller.abort();
  }, [cached, load]);
  useEffect(() => { if (cached) setItems(cached.items); }, [cached]);
  useEffect(() => { window.localStorage.setItem("eureka-organization-extensions-view", viewMode); }, [viewMode]);
  useEffect(() => {
    if (categories) return;
    const controller = new AbortController();
    void fetch("/api/organization-extensions/categories", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) as { items?: OrganizationCategory[] } | null }))
      .then(({ response, payload }) => { if (response.ok && Array.isArray(payload?.items)) onCategoriesLoaded(payload.items); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [categories, onCategoriesLoaded]);
  useEffect(() => {
    if (!showInstalled) return;
    const controller = new AbortController();
    setInstalledState("loading");
    void fetch(`/api/organization-extensions/installations?${new URLSearchParams({ cwd, scope: installedScope, type: kind === "skills" ? "skill" : "mcp" })}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) as { items?: InstalledCapability[] } | null }))
      .then(({ response, payload }) => {
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(payload?.items)) throw new Error("installed-list");
        setInstalled(payload.items);
        setInstalledState("ready");
      })
      .catch((error) => { if (!controller.signal.aborted && (error as Error).name !== "AbortError") setInstalledState("error"); });
    return () => controller.abort();
  }, [cwd, installedScope, installationRevision, kind, showInstalled]);

  const availableCategories = useMemo(() => {
    const byId = new Map((categories ?? []).map((category) => [category.id, category]));
    items.forEach((item) => { if (item.categoryId !== null && item.category && !byId.has(item.categoryId)) byId.set(item.categoryId, { id: item.categoryId, name: item.category }); });
    return [...byId.values()];
  }, [categories, items]);
  const installedItems = useMemo(() => {
    const marketById = new Map(items.map((item) => [item.id, item]));
    return installed.map((install) => {
      const market = marketById.get(install.capabilityId);
      return { ...(market ?? fallbackInstalledCapability(install)), version: install.version, marketVersion: market?.version, installedAt: install.installedAt, disabled: install.disabled, lifecycle: install.lifecycle, idleTimeout: install.idleTimeout };
    });
  }, [installed, items]);
  const sourceItems = showInstalled ? installedItems : items;
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return sourceItems.filter((item) => {
      const matchesFilter = showInstalled || filter.kind === "all" || filter.kind === "favorites" && item.isFavorite || filter.kind === "frequent" && item.calls >= 1000 || filter.kind === "category" && item.categoryId === filter.categoryId;
      return matchesFilter && (!normalized || [item.name, item.description, item.author, item.department ?? "", item.category ?? "", ...item.tags].some((value) => value.toLocaleLowerCase().includes(normalized)));
    });
  }, [filter, query, showInstalled, sourceItems]);
  const emptyText = showInstalled ? t("extensions.installedEmpty", { scope: installedScope === "global" ? t("extensions.global") : t("extensions.project"), type: kind === "skills" ? t("extensions.skills") : t("extensions.mcp") }) : kind === "skills" ? t("extensions.organizationSkillsEmpty") : t("extensions.organizationMcpEmpty");
  const statusText = state === "unauthenticated" ? t("extensions.marketUnauthenticated") : state === "forbidden" ? t("extensions.marketForbidden") : state === "error" ? t("extensions.marketLoadFailed") : emptyText;

  if (state !== "ready" && state !== "empty") return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center"><span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-[var(--bg-hover)] text-[var(--text-muted)]"><ExtensionIcon kind={kind} /></span><h2 className="text-lg font-semibold text-[var(--text)]">{state === "loading" ? t("extensions.marketLoading") : kind === "skills" ? t("extensions.skills") : t("extensions.mcp")}</h2>{state !== "loading" ? <NotificationNotice message={statusText} type={state === "error" ? "error" : "warning"} /> : null}{state === "error" && <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.reload")}</Button>}</div>;

  return <><div className="flex h-full min-h-0 flex-col bg-[var(--chat-bg)]"><div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><FilterMenu filter={filter} categories={availableCategories} items={items} onChange={setFilter} /><div className="relative min-w-0 flex-1 sm:max-w-md"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("extensions.search")} className="h-8 bg-[var(--bg-panel)] pl-9 pr-3 text-[13px] text-[var(--text)] placeholder:text-[13px] focus-visible:border-[var(--border)]" /></div><label className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-1 text-[13px] font-medium text-[var(--text)]"><Switch checked={showInstalled} onCheckedChange={setShowInstalled} aria-label={t("extensions.installed")} /><span>{t("extensions.installed")}</span></label>{showInstalled && <Tabs value={installedScope} onValueChange={(value) => setInstalledScope(value as InstallScope)}><TabsList className="h-8"><TabsTrigger value="global" className="h-6 px-2.5 text-[13px]">{t("extensions.globalInstall")}</TabsTrigger><TabsTrigger value="project" className="h-6 px-2.5 text-[13px]">{t("extensions.projectInstall")}</TabsTrigger></TabsList></Tabs>}<div className="sm:ml-auto"><ViewToggle viewMode={viewMode} onChange={setViewMode} /></div></div></div><div className="min-h-0 flex-1 overflow-y-auto p-4">{showInstalled && installedState === "loading" ? <div className="grid min-h-72 place-items-center text-sm text-[var(--text-muted)]">{t("extensions.installedLoading")}</div> : showInstalled && installedState === "error" ? <NotificationNotice type="error" message={t("extensions.installedLoadFailed")} /> : viewMode === "cards" ? <CapabilityCards items={visibleItems} onOpenDetails={onOpenDetails} installBusyId={installBusyId} installSuccessId={installSuccessId} onInstall={setInstallTarget} installedActionBusyId={installedActionBusyId} onInstalledAction={handleInstalledAction} toggleBusyId={toggleBusyId} onSetDisabled={setDisabled} /> : <CapabilityTable items={visibleItems} onOpenDetails={onOpenDetails} installBusyId={installBusyId} installSuccessId={installSuccessId} onInstall={setInstallTarget} installedActionBusyId={installedActionBusyId} onInstalledAction={handleInstalledAction} showEnabledColumn={showInstalled} toggleBusyId={toggleBusyId} onSetDisabled={setDisabled} />}</div></div>{installTarget ? <HazeCapabilityInstallDialog item={installTarget} cwd={cwd} busy={installBusyId === installTarget.id} onClose={() => setInstallTarget(null)} onConfirm={async (scope, runtime) => { const installed = await install(installTarget, scope, runtime); if (installed) setInstallTarget(null); return Boolean(installed); }} /> : null}{mcpConfigTarget ? <HazeMcpConfigDialog item={mcpConfigTarget} initial={{ lifecycle: mcpConfigTarget.lifecycle ?? "lazy", idleTimeout: mcpConfigTarget.idleTimeout ?? 10 }} busy={installedActionBusyId === mcpConfigTarget.id} onClose={() => setMcpConfigTarget(null)} onConfirm={async (runtime) => { const configured = await configureMcp(mcpConfigTarget, runtime); if (configured) setMcpConfigTarget(null); return configured; }} /> : null}</>;
}
export function ExtensionsCenter({ cwd, sessionId, onReloaded, onOpenExtensionDetails }: Props) {
  const { t } = useI18n();
  const [group, setGroup] = useState<ExtensionGroup>("organization");
  const [organizationSection, setOrganizationSection] = useState<OrganizationSection>("skills");
  const [marketSection, setMarketSection] = useState<MarketSection>("skills");
  const [organizationCache, setOrganizationCache] = useState<OrganizationCache>({});
  const [organizationCategories, setOrganizationCategories] = useState<OrganizationCategory[] | undefined>();
  const setOrganizationDetails = setOrganizationCategories;
  const cacheOrganizationExtensions = useCallback((section: OrganizationSection, items: OrganizationExtension[]) => setOrganizationCache((current) => ({ ...current, [section]: { items } })), []);
  const updateFavorite = (id: string, isFavorite: boolean) => setOrganizationCache((current) => Object.fromEntries(Object.entries(current).map(([section, entry]) => [section, entry ? { items: entry.items.map((item) => item.id === id ? { ...item, isFavorite } : item) } : entry])) as OrganizationCache);
  const openExtensionDetails = (item: OrganizationExtension) => onOpenExtensionDetails(item, updateFavorite);
  return <main className="flex h-full min-h-0 flex-col bg-[var(--chat-bg)] text-[var(--text)]"><Tabs value={group} onValueChange={(value) => setGroup(value as ExtensionGroup)} className="flex min-h-0 flex-1 flex-col"><header className="shrink-0 border-b border-[var(--border)] bg-[var(--chat-bg)]"><div className="flex h-11 items-center gap-4 px-5"><TabsList className="h-full gap-0 rounded-none bg-transparent p-0"><TabsTrigger value="organization" className="h-full rounded-none border-b-2 border-transparent px-3 text-sm data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none">{t("extensions.organization")}</TabsTrigger><TabsTrigger value="market" className="h-full rounded-none border-b-2 border-transparent px-3 text-sm data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none">{t("extensions.market")}</TabsTrigger></TabsList><span aria-hidden="true" className="h-5 w-px bg-[var(--border)]" /><Tabs value={group === "organization" ? organizationSection : marketSection} onValueChange={(value) => group === "organization" ? setOrganizationSection(value as OrganizationSection) : setMarketSection(value as MarketSection)}><TabsList><TabsTrigger value="skills" className="gap-1.5"><ExtensionIcon kind="skills" />{t("extensions.skills")}</TabsTrigger>{group === "organization" ? <TabsTrigger value="mcp" className="gap-1.5"><ExtensionIcon kind="mcp" />{t("extensions.mcp")}</TabsTrigger> : <><TabsTrigger value="plugins" className="gap-1.5"><ExtensionIcon kind="plugins" />{t("extensions.plugins")}</TabsTrigger><TabsTrigger value="mcp" className="gap-1.5"><ExtensionIcon kind="mcp" />{t("extensions.mcp")}</TabsTrigger></>}</TabsList></Tabs></div></header><TabsContent value="organization" className="min-h-0 flex-1 overflow-hidden"><Tabs value={organizationSection} onValueChange={(value) => setOrganizationSection(value as OrganizationSection)} className="h-full"><TabsContent value="skills" className="h-full"><OrganizationExtensionsPage kind="skills" cwd={cwd} cached={organizationCache.skills} categories={organizationCategories} onLoaded={cacheOrganizationExtensions} onCategoriesLoaded={setOrganizationCategories} onOpenDetails={openExtensionDetails} /></TabsContent><TabsContent value="mcp" className="h-full"><OrganizationExtensionsPage kind="mcp" cwd={cwd} cached={organizationCache.mcp} categories={organizationCategories} onLoaded={cacheOrganizationExtensions} onCategoriesLoaded={setOrganizationDetails} onOpenDetails={openExtensionDetails} /></TabsContent></Tabs></TabsContent><TabsContent value="market" className="min-h-0 flex-1 overflow-hidden"><Tabs value={marketSection} onValueChange={(value) => setMarketSection(value as MarketSection)} className="h-full"><TabsContent value="skills" className="h-full"><SkillsConfig cwd={cwd} embedded onClose={() => undefined} /></TabsContent><TabsContent value="plugins" className="h-full"><PluginsConfig cwd={cwd} sessionId={sessionId} embedded onClose={() => undefined} onReloaded={onReloaded} /></TabsContent><TabsContent value="mcp" className="h-full"><McpConfig cwd={cwd} sessionId={sessionId} onReloaded={onReloaded} /></TabsContent></Tabs></TabsContent></Tabs></main>;
}






