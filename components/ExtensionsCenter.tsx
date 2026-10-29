"use client";

import { describeExtensionError } from "@/lib/extension-errors";

import { InstalledCapabilityResources } from "./InstalledCapabilityResources";
import { CapabilityInstallRuntime } from "./CapabilityInstallRuntime";
import { CapabilityTypeBadge } from "./CapabilityTypeBadge";
import { OrganizationCapabilityIcon } from "./OrganizationCapabilityIcon";

import { sendAgentCommand } from "@/lib/agent-client";
import type { PluginConfirmation } from "./OrganizationPluginDialog";
import { ExtensionNotice as NotificationNotice } from "./ExtensionNotice";
import { notify } from "@/lib/notification-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ClockIcon, CpuIcon, EyeIcon, LayersIcon, LayoutGridIcon, LayoutListIcon, PackagePlusIcon, PlugIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, StarIcon, Trash2Icon } from "lucide-react";
import { SkillsConfig } from "./SkillsConfig";
import { InstalledCapabilitiesSidebar } from "./InstalledCapabilitiesSidebar";
import installedStyles from "./InstalledCapabilitiesSidebar.module.css";
import { mergeInstalledCapabilities, type ManagedCapabilityInstall, type InstalledCapability as InstalledSidebarCapability } from "@/lib/installed-capabilities";
import { PluginsConfig } from "./PluginsConfig";
import { McpConfig } from "./McpConfig";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { HazeCapabilityInstallDialog, HazeMcpConfigDialog, type InstallScope, type McpRuntimeOptions } from "./HazeCapabilityDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { useI18n } from "@/hooks/useI18n";

type ExtensionGroup = "organization" | "market";
type OrganizationSection = "skills" | "mcp" | "plugins";
type ExtensionView = "installed" | "market";
type InstalledSelection = {
  item: InstalledSidebarCapability;
  skill?: { filePath: string; requestId: number };
  plugin?: { source: string; scope: InstallScope; requestId: number };
  mcp?: { name: string; scope: InstallScope; requestId: number };
};
type ViewMode = "cards" | "table";
type Filter = { kind: "all" | "favorites" | "frequent" } | { kind: "category"; categoryId: number };
type OrganizationExtension = OrganizationExtensionDetailItem & { categoryId: number | null };
type OrganizationCategory = { id: number; name: string };
type LoadState = "loading" | "ready" | "empty" | "unauthenticated" | "forbidden" | "error";
type OrganizationCache = Partial<Record<OrganizationSection, { items: OrganizationExtension[] }>>;
type InstalledCapability = { capabilityId: string; name: string; type: "Skill" | "MCP" | "Plugin"; version: string; scope: InstallScope; installedAt: string; disabled: boolean; plugin?: { state: string }; lifecycle?: McpRuntimeOptions["lifecycle"]; idleTimeout?: number };
type ListedCapability = OrganizationExtension & { installation?: InstalledCapability; marketUnavailable?: boolean; installedAt?: string; disabled?: boolean; marketVersion?: string; plugin?: { state: string }; lifecycle?: McpRuntimeOptions["lifecycle"]; idleTimeout?: number };
type Props = { active?: boolean; sidebarOpen?: boolean; installedRevision?: number; cwd: string; sessionId: string | null; guest?: boolean; onReloaded?: () => void; onTrustProject?: () => void; onShowSidebar?: () => void; onCloseExtensionDetails?: () => void; onOpenExtensionDetails: (item: OrganizationExtensionDetailItem, onFavoriteChange: (id: string, isFavorite: boolean) => void) => void };

function ExtensionIcon({ kind }: { kind: "skills" | "mcp" | "plugins" }) {
  const common = { width: 16, height: 16, "aria-hidden": true };
  if (kind === "skills") return <LayersIcon {...common} />;
  if (kind === "mcp") return <CpuIcon {...common} />;
  return <PlugIcon {...common} />;
}

function CapabilityIcon({ item, size = 40 }: { item: OrganizationExtension; size?: number }) {
  return <OrganizationCapabilityIcon capability={{ capabilityId: item.id }} iconUrl={item.iconUrl} type={item.type} size={size} fit="cover" className="bg-[var(--bg-hover)] text-[var(--text-muted)]" />;
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
  if (item.type === "MCP" || !item.marketVersion) return false;
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

function InstallMenu({ item, state, disabled, onInstall }: { item: OrganizationExtension; state: "idle" | "installing" | "installed"; disabled: boolean; onInstall: (item: OrganizationExtension) => void }) {
  const { t } = useI18n();
  return <Button size="sm" disabled={disabled || state !== "idle"} onClick={() => onInstall(item)}>{state === "installing" ? <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : state === "installed" ? <CheckIcon className="mr-1.5 h-3.5 w-3.5" /> : <PackagePlusIcon className="mr-1.5 h-3.5 w-3.5" />}{state === "installing" ? t("extensions.installing") : state === "installed" ? t("extensions.installedSuccess") : t("extensions.install")}</Button>;
}

type InstalledAction = "update" | "uninstall" | "configure";

type CapabilityMarketProps = {
  items: ListedCapability[];
  onOpenDetails: (item: OrganizationExtension) => void;
  installBusyId: string | null;
  installSuccessId: string | null;
  installationsReady: boolean;
  onInstall: (item: OrganizationExtension) => void;
  onManage: (install: ManagedCapabilityInstall) => void;
};

function CapabilityMarketAction({ item, installBusyId, installSuccessId, installationsReady, onInstall, onManage }: Omit<CapabilityMarketProps, "items" | "onOpenDetails"> & { item: ListedCapability }) {
  const { t } = useI18n();
  const installation = item.installation;
  return installation ? <Button size="sm" className="bg-blue-500 text-white hover:bg-blue-600" onClick={() => onManage(installation)}><SlidersHorizontalIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.manage")}</Button>
    : <InstallMenu item={item} disabled={!installationsReady} state={installBusyId === item.id ? "installing" : installSuccessId === item.id ? "installed" : "idle"} onInstall={onInstall} />;
}

function InstalledCapabilityManagement({ item, scope, busy, onAction, onSetDisabled }: {
  item: ListedCapability; scope: InstallScope; busy: boolean;
  onAction: (item: ListedCapability, action: InstalledAction) => void;
  onSetDisabled: (item: OrganizationExtension, disabled: boolean) => void;
}) {
  const { t } = useI18n();
  const canUpdate = item.type !== "MCP" && !item.marketUnavailable;
  const attribution = [
    [t("extensions.developer"), item.author || "—"],
    [t("extensions.department"), item.department || "—"],
    [t("extensions.businessCategory"), item.category || "—"],
  ];
  return <article data-installed-management className="flex h-auto min-h-full w-full min-w-0 flex-col px-1 pt-2 text-[var(--text)] sm:px-4 sm:pt-4 min-[960px]:h-full min-[960px]:min-h-0">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <CapabilityIcon item={item} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-xl font-semibold">{item.name}</h2>
          <div data-capability-labels className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <CapabilityTypeBadge type={item.type} className="rounded-[var(--radius-control)] px-2 py-1" />
            {item.tags.map(tag => <span key={tag} className="rounded-[var(--radius-control)] bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-muted)]">{tag}</span>)}
            {item.plugin && <span>{t(`extensions.pluginState.${item.plugin.state}`)}</span>}
            {hasSkillUpdate(item) && <span className="font-medium text-[var(--accent)]">{t("extensions.updateAvailable")}</span>}
          </div>
        </div>
      </div>
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-3 py-1 text-sm">
        <span>{t(item.disabled ? "extensions.pluginState.disabled" : "extensions.managementEnabled")}</span>
        <Switch checked={!item.disabled} disabled={busy} aria-label={`${item.disabled ? t("extensions.enable") : t("extensions.disable")}${item.name}`} onCheckedChange={checked => onSetDisabled(item, !checked)} />
      </label>
    </div>
    <p data-capability-description className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">{item.marketUnavailable ? t("extensions.marketUnavailable") : item.description || t("extensions.marketNoDescription")}</p>
    <dl data-capability-attribution className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--text-muted)]">
      {attribution.map(([label, value]) => <div key={label} className="inline-flex min-w-0 gap-1.5"><dt className="shrink-0">{label}</dt><dd className="break-words">{value}</dd></div>)}
    </dl>
    <div className="mt-5 border-t border-[var(--border)] pt-5">
    <CapabilityInstallRuntime scope={scope} version={item.version} state={item.plugin?.state ?? (item.disabled ? "disabled" : "installed")} latestVersion={!item.marketUnavailable && item.version && item.marketVersion && compareVersions(item.version, item.marketVersion) < 0 ? item.marketVersion : undefined} actions={<>
      {canUpdate && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction(item, "update")}><RefreshCwIcon size={14} className="mr-1.5" aria-hidden="true" />{t("extensions.update")}</Button>}
      {item.type === "MCP" && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction(item, "configure")}><SlidersHorizontalIcon size={14} className="mr-1.5" aria-hidden="true" />{t("extensions.configure")}</Button>}
      <Button variant="destructive" size="sm" disabled={busy} onClick={() => onAction(item, "uninstall")}><Trash2Icon size={14} className="mr-1.5" aria-hidden="true" />{t("extensions.uninstall")}</Button>
    </>} />
    </div>
    <InstalledCapabilityResources key={item.id} item={item} />
  </article>;
}

function CapabilityCards({ items, onOpenDetails, ...actions }: CapabilityMarketProps) {
  const { t } = useI18n();
  if (!items.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--text-muted)]">{t("extensions.noMatches")}</div>;
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => {
    const tags = item.category && !item.tags.includes(item.category) ? [item.category, ...item.tags] : item.tags;
    const attribution = [item.author, item.department].filter(Boolean).join(" · ");
    const updateAvailable = hasSkillUpdate(item);
    const installedLabel = item.marketUnavailable ? t("extensions.installedVersion", { version: item.version }) : `${attribution || t("extensions.marketUnknownAuthor")} · v${item.version}`;
    return <Card key={item.id} className="organization-extension-card flex min-h-52 flex-col rounded-[var(--radius-card)] bg-[var(--bg-panel)] p-4 shadow-none"><div className="flex min-w-0 items-start gap-3"><CapabilityIcon item={item} /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-[var(--text)]">{item.name}</h2><CapabilityTypeBadge type={item.type} className="mt-1" />{item.plugin ? <span className="ml-2 text-xs text-[var(--text-muted)]">{t(`extensions.pluginState.${item.plugin.state}`)}</span> : null}</div></div><CardContent className="mt-3 px-0"><p className="line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">{item.marketUnavailable ? t("extensions.marketUnavailable") : item.description || t("extensions.marketNoDescription")}</p><div className="mt-2 flex min-h-5 flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{tag}</span>)}</div></CardContent><div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-xs text-[var(--text-muted)]">{item.installedAt ? installedLabel : attribution || t("extensions.marketUnknownAuthor")}</span>{updateAvailable ? <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600">{t("extensions.updateAvailable")}</span> : null}</div><div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" onClick={() => onOpenDetails(item)}><EyeIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.viewDetails")}</Button><CapabilityMarketAction item={item} {...actions} /></div></div></Card>;
  })}</div>;
}

function CapabilityTable({ items, onOpenDetails, ...actions }: CapabilityMarketProps) {
  const { t } = useI18n();
  if (!items.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--text-muted)]">{t("extensions.noMatches")}</div>;
  return <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]"><table className="min-w-[1040px] w-full border-collapse text-left text-xs"><thead className="bg-[var(--bg-hover)] text-[var(--text-muted)]"><tr><th className="whitespace-nowrap px-4 py-2 font-medium">{t("session.name")}</th><th className="whitespace-nowrap px-3 py-2 font-medium">{t("extensions.capabilityDescription")}</th><th className="whitespace-nowrap px-3 py-2 font-medium">{t("extensions.capabilityTags")}</th><th className="whitespace-nowrap px-3 py-2 font-medium">{t("extensions.developer")} / {t("extensions.department")}</th><th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("extensions.calls")}</th><th className="sticky right-0 z-20 whitespace-nowrap border-l border-[var(--border)] bg-[var(--bg-hover)] px-4 py-2 text-right font-medium">{t("extensions.manage")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[var(--border)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]"><td className="whitespace-nowrap px-4 py-2"><div className="flex items-center gap-2"><CapabilityIcon item={item} /><span className="max-w-56 truncate font-medium text-[var(--text)]">{item.name}</span>{hasSkillUpdate(item) ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">{t("extensions.updateAvailable")}</span> : null}</div></td><td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]"><p className="max-w-80 truncate">{item.marketUnavailable ? t("extensions.marketUnavailable") : item.description || t("extensions.marketNoDescription")}</p></td><td className="whitespace-nowrap px-3 py-2"><div className="flex max-w-48 flex-nowrap gap-1 overflow-hidden">{item.tags.slice(0, 2).map((tag) => <span key={tag} className="shrink-0 rounded bg-[var(--bg-hover)] px-1 py-0.5 text-[11px] text-[var(--text-muted)]">{tag}</span>)}</div></td><td className="max-w-44 truncate whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{[item.author, item.department].filter(Boolean).join(" · ") || t("extensions.marketUnknownAuthor")}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-muted)]">{formatCalls(item.calls)}</td><td className="sticky right-0 z-10 whitespace-nowrap border-l border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => onOpenDetails(item)}><EyeIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.viewDetails")}</Button><CapabilityMarketAction item={item} {...actions} /></div></td></tr>)}</tbody></table></div>;
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

function OrganizationExtensionsPage({ kind, scope, onManage, cwd, sessionId, view, selection, installedRevision, cached, categories, onLoaded, onCategoriesLoaded, onOpenDetails, onInstalledChange }: { kind: OrganizationSection; scope: InstallScope; onManage: (install: ManagedCapabilityInstall) => void; cwd: string; sessionId?: string | null; view: ExtensionView; selection?: ManagedCapabilityInstall; installedRevision: number; cached?: { items: OrganizationExtension[] }; categories?: OrganizationCategory[]; onLoaded: (kind: OrganizationSection, items: OrganizationExtension[]) => void; onCategoriesLoaded: (categories: OrganizationCategory[]) => void; onOpenDetails: (item: OrganizationExtension) => void; onInstalledChange?: () => void }) {
  const { t } = useI18n();
  const initialCacheRef = useRef(cached);
  const [state, setState] = useState<LoadState>(() => cached ? (cached.items.length ? "ready" : "empty") : "loading");
  const [items, setItems] = useState<OrganizationExtension[]>(() => cached?.items ?? []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [viewMode, setViewMode] = useState<ViewMode>(() => typeof window !== "undefined" && window.localStorage.getItem("eureka-organization-extensions-view") === "table" ? "table" : "cards");
  const [installBusyId, setInstallBusyId] = useState<string | null>(null);
  const [installSuccessId, setInstallSuccessId] = useState<string | null>(null);
  const [installedActionBusyId, setInstalledActionBusyId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<OrganizationExtension | null>(null);
  const [installTargetScope, setInstallTargetScope] = useState<InstallScope>(scope);
  const [pluginOperation, setPluginOperation] = useState<"install" | "update">("install");
  const [mcpConfigTarget, setMcpConfigTarget] = useState<ListedCapability | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const showInstalled = view === "installed";
  const installedScope: InstallScope = showInstalled ? selection?.scope ?? scope : scope;
  const [installationRevision, setInstallationRevision] = useState(0);
  const installationKey = JSON.stringify([cwd, installedScope, kind, sessionId, installationRevision, installedRevision]);
  const [installationList, setInstallationList] = useState<{ key: string; state: "loading" | "ready" | "error"; items: InstalledCapability[] }>({ key: "", state: "loading", items: [] });
  const installed = useMemo(() => installationList.key === installationKey ? installationList.items : [], [installationList, installationKey]);
  const installedState = installationList.key === installationKey ? installationList.state : "loading";

  const install = async (item: OrganizationExtension, scope: InstallScope, runtime?: McpRuntimeOptions, plugin?: PluginConfirmation) => {
    if (!cwd || installBusyId) return;
    setInstallBusyId(item.id);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope, action: item.type === "Plugin" ? pluginOperation : "install", type: item.type, ...(runtime ?? {}), ...(plugin ?? {}) }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "安装失败，请稍后重试。");
      notify({ type: "success", title: "已安装", message: `${item.name}已${scope === "project" ? "项目" : "全局"}安装。重载会话后生效。` });
      setInstallationRevision((current) => current + 1);
      onInstalledChange?.();
      setInstallSuccessId(item.id);
      window.setTimeout(() => setInstallSuccessId((current) => current === item.id ? null : current), 1200);
      return true;
    } catch (error) {
      notify({ type: "error", title: "安装失败", ...describeExtensionError(error, t) });
      return false;
    } finally {
      setInstallBusyId(null);
    }
  };

  const beginInstall = (item: OrganizationExtension) => {
    setPluginOperation("install");
    if (item.type === "Skill") { void install(item, installedScope); return; }
    setInstallTargetScope(installedScope);
    setInstallTarget(item);
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
      onInstalledChange?.();
    } catch (error) {
      notify({ type: "error", title: action === "update" ? "更新失败" : "卸载失败", ...describeExtensionError(error, t) });
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
      setInstallationList(current => ({ ...current, items: current.items.map(install => install.capabilityId === item.id ? { ...install, ...runtime } : install) }));
      notify({ type: "success", title: "配置已保存", message: t("extensions.connectorSaved", { name: item.name }) });
      setInstallationRevision((current) => current + 1);
      onInstalledChange?.();
      return true;
    } catch (error) {
      notify({ type: "error", title: "配置失败", ...describeExtensionError(error, t) });
      return false;
    } finally { setInstalledActionBusyId(null); }
  };

  const handleInstalledAction = (item: ListedCapability, action: InstalledAction) => {
    if (action === "configure") { setMcpConfigTarget(item); return; }
    if (action === "update" && item.type === "Plugin") { setPluginOperation("update"); setInstallTargetScope(installedScope); setInstallTarget(item); return; }
    void runInstalledAction(item, action);
  };

  const setDisabled = async (item: OrganizationExtension, disabled: boolean) => {
    if (!cwd || toggleBusyId) return;
    setToggleBusyId(item.id);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope: installedScope, action: "set-disabled", type: item.type, disabled }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "操作失败，请稍后重试。");
      setInstallationList(current => ({ ...current, items: current.items.map(install => install.capabilityId === item.id ? { ...install, disabled } : install) }));
      notify({ type: "success", title: disabled ? "已停用" : "已启用", message: `${item.name}${disabled ? "已停用" : "已启用"}。重载会话后生效。` });
      setInstallationRevision((current) => current + 1);
      onInstalledChange?.();
    } catch (error) {
      notify({ type: "error", title: "操作失败", ...describeExtensionError(error, t) });
    } finally {
      setToggleBusyId(null);
    }
  };

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (!background) setState("loading");
    try {
      const response = await fetch(`/api/organization-extensions?type=${kind === "skills" ? "skill" : kind === "plugins" ? "plugin" : "mcp"}`, { signal, cache: "no-store" });
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
    const controller = new AbortController();
    // Loading updates the parent cache. That update must not start another
    // request, especially now that this page stays mounted behind Home.
    void load(controller.signal, Boolean(initialCacheRef.current));
    return () => controller.abort();
  }, [load]);
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
    const controller = new AbortController();
    setInstallationList({ key: installationKey, state: "loading", items: [] });
    void fetch(`/api/organization-extensions/installations?${new URLSearchParams({ cwd, scope: installedScope, type: kind === "skills" ? "skill" : kind === "plugins" ? "plugin" : "mcp", ...(sessionId ? { sessionId } : {}) })}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) as { items?: InstalledCapability[] } | null }))
      .then(({ response, payload }) => {
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(payload?.items)) throw new Error("installed-list");
        setInstallationList({ key: installationKey, state: "ready", items: payload.items.filter(item => item.scope === installedScope) });
      })
      .catch((error) => { if (!controller.signal.aborted && (error as Error).name !== "AbortError") setInstallationList({ key: installationKey, state: "error", items: [] }); });
    return () => controller.abort();
  }, [cwd, installedScope, installationKey, kind, sessionId]);

  const availableCategories = useMemo(() => {
    const byId = new Map((categories ?? []).map((category) => [category.id, category]));
    items.forEach((item) => { if (item.categoryId !== null && item.category && !byId.has(item.categoryId)) byId.set(item.categoryId, { id: item.categoryId, name: item.category }); });
    return [...byId.values()];
  }, [categories, items]);
  const installedItems = useMemo(() => {
    const marketById = new Map(items.map((item) => [item.id, item]));
    return installed.filter(install => !selection || (install.capabilityId === selection.capabilityId && install.scope === selection.scope)).map((install) => {
      const market = marketById.get(install.capabilityId);
      return { ...(market ?? fallbackInstalledCapability(install)), version: install.version, marketVersion: market?.version, installedAt: install.installedAt, disabled: install.disabled, plugin: install.plugin, lifecycle: install.lifecycle, idleTimeout: install.idleTimeout };
    });
  }, [installed, items, selection]);
  const marketItems = useMemo(() => {
    const byId = new Map(installed.map(install => [install.capabilityId, install]));
    return items.map(item => ({ ...item, installation: byId.get(item.id) }));
  }, [installed, items]);
  const sourceItems = showInstalled ? installedItems : marketItems;
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return sourceItems.filter((item) => {
      const matchesFilter = showInstalled || filter.kind === "all" || filter.kind === "favorites" && item.isFavorite || filter.kind === "frequent" && item.calls >= 1000 || filter.kind === "category" && item.categoryId === filter.categoryId;
      return matchesFilter && (!normalized || [item.name, item.description, item.author, item.department ?? "", item.category ?? "", ...item.tags].some((value) => value.toLocaleLowerCase().includes(normalized)));
    });
  }, [filter, query, showInstalled, sourceItems]);
  const emptyText = showInstalled ? t("extensions.installedEmpty", { scope: installedScope === "global" ? t("extensions.global") : t("extensions.project"), type: kind === "skills" ? t("extensions.skills") : kind === "plugins" ? t("extensions.plugins") : t("extensions.mcp") }) : kind === "skills" ? t("extensions.organizationSkillsEmpty") : kind === "plugins" ? t("extensions.organizationPluginsEmpty") : t("extensions.organizationMcpEmpty");
  const statusText = state === "unauthenticated" ? t("extensions.marketUnauthenticated") : state === "forbidden" ? t("extensions.marketForbidden") : state === "error" ? t("extensions.marketLoadFailed") : emptyText;

  if (!showInstalled && state !== "ready" && state !== "empty") return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center"><span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-[var(--bg-hover)] text-[var(--text-muted)]"><ExtensionIcon kind={kind} /></span><h2 className="text-lg font-semibold text-[var(--text)]">{state === "loading" ? t("extensions.marketLoading") : kind === "skills" ? t("extensions.skills") : kind === "plugins" ? t("extensions.plugins") : t("extensions.mcp")}</h2>{state !== "loading" ? <NotificationNotice message={statusText} type={state === "error" ? "error" : "warning"} /> : null}{state === "error" && <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.reload")}</Button>}</div>;

  return <><div className="flex h-full min-h-0 flex-col bg-[var(--chat-bg)]">{!showInstalled && <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center">{!showInstalled && <><FilterMenu filter={filter} categories={availableCategories} items={items} onChange={setFilter} /><div className="relative min-w-0 flex-1 sm:max-w-md"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("extensions.search")} className="h-8 bg-[var(--bg-panel)] pl-9 pr-3 text-[13px] text-[var(--text)] placeholder:text-[13px] focus-visible:border-[var(--border)]" /></div></>}<div className="flex items-center gap-2 sm:ml-auto"><ViewToggle viewMode={viewMode} onChange={setViewMode} /></div></div></div>}<div className={`min-h-0 flex-1 overflow-y-auto px-4 pt-4 ${showInstalled ? "pb-6" : "pb-4"}`}>{!showInstalled && installedState === "error" ? <div role="alert" className="mb-4 flex items-center gap-3"><p className="text-sm text-[var(--text-muted)]">{t("extensions.installedLoadFailed")}</p><Button variant="outline" size="sm" onClick={() => setInstallationRevision(current => current + 1)}>{t("context.retry")}</Button></div> : null}{showInstalled && installedState === "loading" ? <div className="grid min-h-72 place-items-center text-sm text-[var(--text-muted)]">{t("extensions.installedLoading")}</div> : showInstalled && installedState === "error" ? <NotificationNotice type="error" message={t("extensions.installedLoadFailed")} />  : showInstalled ? visibleItems[0] ? <InstalledCapabilityManagement item={visibleItems[0]} scope={installedScope} busy={installedActionBusyId === visibleItems[0].id || toggleBusyId === visibleItems[0].id || installBusyId === visibleItems[0].id} onAction={handleInstalledAction} onSetDisabled={setDisabled} /> : <div className="grid min-h-72 place-items-center text-sm text-[var(--text-muted)]">{emptyText}</div> : viewMode === "cards" ? <CapabilityCards items={visibleItems} onOpenDetails={item => onOpenDetails({ ...item, installScope: installedScope, ...(showInstalled ? { installedScope, isInstalled: true } : {}) })} installBusyId={installBusyId} installSuccessId={installSuccessId} onInstall={beginInstall} installationsReady={installedState === "ready"} onManage={onManage} /> : <CapabilityTable items={visibleItems} onOpenDetails={item => onOpenDetails({ ...item, installScope: installedScope, ...(showInstalled ? { installedScope, isInstalled: true } : {}) })} installBusyId={installBusyId} installSuccessId={installSuccessId} onInstall={beginInstall} installationsReady={installedState === "ready"} onManage={onManage} />}</div></div>{installTarget ? <HazeCapabilityInstallDialog operation={pluginOperation} fixedScope={installTargetScope} item={installTarget} cwd={cwd} busy={installBusyId === installTarget.id} onClose={() => setInstallTarget(null)} onConfirm={async (scope, runtime, plugin) => { const installed = await install(installTarget, scope, runtime, plugin); if (installed) setInstallTarget(null); return Boolean(installed); }} /> : null}{mcpConfigTarget ? <HazeMcpConfigDialog item={mcpConfigTarget} initial={{ lifecycle: mcpConfigTarget.lifecycle ?? "lazy", idleTimeout: mcpConfigTarget.idleTimeout ?? 10 }} busy={installedActionBusyId === mcpConfigTarget.id} onClose={() => setMcpConfigTarget(null)} onConfirm={async (runtime) => { const configured = await configureMcp(mcpConfigTarget, runtime); if (configured) setMcpConfigTarget(null); return configured; }} /> : null}</>;
}
export function ExtensionsCenter({ active = true, sidebarOpen = true, installedRevision = 0, cwd, sessionId, guest = false, onReloaded, onTrustProject, onShowSidebar, onCloseExtensionDetails, onOpenExtensionDetails }: Props) {
  const { t } = useI18n();
  const [group, setGroup] = useState<ExtensionGroup>(guest ? "market" : "organization");
  const activeGroup = guest ? "market" : group;
  const [organizationSection, setOrganizationSection] = useState<OrganizationSection>("skills");
  const [marketSection, setMarketSection] = useState<OrganizationSection>("skills");
  const [view, setView] = useState<ExtensionView>("market");
  const [installedScope, setInstalledScope] = useState<InstallScope>("global");
  const section = activeGroup === "organization" ? organizationSection : marketSection;
  const pageKey = `${activeGroup}:${section}:${view}${view === "installed" ? `:${installedScope}` : ""}`;
  // Keep visited content mounted so searches, configuration drafts and scroll positions survive navigation.
  const [visited, setVisited] = useState<string[]>([pageKey]);
  useEffect(() => { setVisited(current => current.includes(pageKey) ? current : [...current, pageKey]); }, [pageKey]);
  const [organizationCache, setOrganizationCache] = useState<OrganizationCache>({});
  const [organizationCategories, setOrganizationCategories] = useState<OrganizationCategory[] | undefined>();
  const cacheOrganizationExtensions = useCallback((section: OrganizationSection, items: OrganizationExtension[]) => setOrganizationCache((current) => ({ ...current, [section]: { items } })), []);
  const updateFavorite = (id: string, isFavorite: boolean) => setOrganizationCache((current) => Object.fromEntries(Object.entries(current).map(([section, entry]) => [section, entry ? { items: entry.items.map((item) => item.id === id ? { ...item, isFavorite } : item) } : entry])) as OrganizationCache);
  const openExtensionDetails = (item: OrganizationExtension) => onOpenExtensionDetails(item, updateFavorite);
  const [installedRefresh, setInstalledRefresh] = useState(0);
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);
  const reloadSession = async () => {
    if (!sessionId || reloadBusy) return;
    setReloadBusy(true);
    try {
      const response = await fetch(`/api/agent/${sessionId}`);
      const state = await response.json();
      if (!response.ok || state.state?.isStreaming) throw new Error(t("extensions.pluginReloadWhenIdle"));
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadRevision(value => value + 1);
      notify({ type: "success", title: t("extensions.reload"), message: t("extensions.pluginReloaded") });
    } catch (error) {
      notify({ type: "error", title: t("extensions.reload"), ...describeExtensionError(error, t) });
    } finally { setReloadBusy(false); }
  };
  const refreshInstalled = useCallback(() => setInstalledRefresh(value => value + 1), []);
  const [installedSelections, setInstalledSelections] = useState<Record<string, InstalledSelection>>({});
  const selectedInstalledItem = installedSelections[`${activeGroup}:${section}:${installedScope}`]?.item;
  const selectionRequestRef = useRef(0);
  const openInstalled = (item: InstalledSidebarCapability) => {
    const target = item.target;
    if (target.type === "organization" && guest) {
      notify({ type: "warning", message: t("extensions.loginRequired") });
      return;
    }
    onCloseExtensionDetails?.();
    const requestId = ++selectionRequestRef.current;
    const section = item.kind === "Skill" ? "skills" : item.kind === "Plugin" ? "plugins" : "mcp";
    const source = target.type === "organization" ? "organization" : "market";
    const selection: InstalledSelection = { item };
    if (target.type === "skill") selection.skill = { filePath: target.filePath, requestId };
    else if (target.type === "plugin") selection.plugin = { source: target.source, scope: target.scope, requestId };
    else if (target.type === "mcp") selection.mcp = { name: target.name, scope: target.scope, requestId };
    setInstalledSelections(current => ({ ...current, [`${source}:${section}:${item.scope}`]: selection }));
    if (item.scope === "global" || item.scope === "project") setInstalledScope(item.scope);
    setView("installed"); setGroup(source);
    if (target.type === "organization") setOrganizationSection(section);
    else setMarketSection(section);
  };
  const changeScope = (scope: InstallScope) => {
    onCloseExtensionDetails?.(); setInstalledScope(scope);
  };
  const changeSource = (source: ExtensionGroup) => {
    if (guest && source === "organization") return;
    onCloseExtensionDetails?.(); setView("market"); setGroup(source);
  };
  const changeSection = (next: OrganizationSection) => {
    onCloseExtensionDetails?.(); setView("market");
    if (activeGroup === "organization") setOrganizationSection(next); else setMarketSection(next);
  };
  const title = t(section === "skills" ? "extensions.skills" : section === "plugins" ? "extensions.plugins" : "extensions.mcp");
  return <main className={installedStyles.workspace}>
    <div style={{ display: sidebarOpen ? "contents" : "none" }}><InstalledCapabilitiesSidebar cwd={cwd} sessionId={sessionId} active={active} scope={installedScope} onScopeChange={changeScope} revision={installedRevision + installedRefresh} selectedKey={view === "installed" ? selectedInstalledItem?.key : undefined} browsing={view === "market"} onSelect={openInstalled} source={activeGroup} section={section} guest={guest} onSourceChange={changeSource} onSectionChange={changeSection} /></div>
    <div data-notification-boundary="30" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        {onShowSidebar ? <Tooltip><TooltipTrigger render={<button type="button" onClick={onShowSidebar} aria-label={t("sidebar.show")} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg></button>} /><TooltipContent>{t("sidebar.show")}</TooltipContent></Tooltip> : null}
        <h1 className="mr-auto flex items-center gap-2 text-base font-semibold"><ExtensionIcon kind={section} />{title}</h1>
        {(activeGroup === "organization" && sessionId || activeGroup === "market") ? <Tooltip><TooltipTrigger render={<span className="inline-flex shrink-0"><Button variant="outline" size="sm" className="shrink-0 gap-1.5" disabled={!sessionId || reloadBusy} aria-busy={reloadBusy} onClick={() => void reloadSession()}><RefreshCwIcon size={14} aria-hidden="true" className={reloadBusy ? "animate-spin" : undefined} />{t("extensions.reload")}</Button></span>} /><TooltipContent>{t(sessionId ? "i18n.reloadSession" : "i18n.openSessionToReload")}</TooltipContent></Tooltip> : null}
      </header>
      {visited.map(key => {
        const [source, kind, contentView, scope] = key.split(":") as [ExtensionGroup, OrganizationSection, ExtensionView, InstallScope?];
        const selection = contentView === "installed" ? installedSelections[`${source}:${kind}:${scope}`] : undefined;
        if (source === "organization" && guest) return null;
        return <div key={key} role="region" aria-label={`${t(source === "organization" ? "extensions.organization" : "extensions.market")} · ${t(kind === "skills" ? "extensions.skills" : kind === "plugins" ? "extensions.plugins" : "extensions.mcp")} · ${t(contentView === "installed" ? "extensions.installed" : "extensions.browseMarket")}`} hidden={key !== pageKey} className="min-h-0 flex-1 overflow-hidden" style={{ display: key === pageKey ? "block" : "none" }}>
          {contentView === "installed" && !selection ? <div className="grid h-full place-items-center p-6 text-sm text-[var(--text-muted)]">{t("extensions.selectInstalled")}</div> : source === "organization" ? <OrganizationExtensionsPage kind={kind} scope={scope ?? installedScope} onManage={install => openInstalled({ key: `organization:${install.type}:${install.scope}:${install.capabilityId}`, name: install.name, kind: install.type, scope: install.scope, origin: "organization", disabled: install.disabled, target: { type: "organization", install } })} view={contentView} selection={selection?.item.target.type === "organization" ? selection.item.target.install : undefined} installedRevision={installedRevision + installedRefresh + reloadRevision} cwd={cwd} sessionId={sessionId} cached={organizationCache[kind]} categories={organizationCategories} onLoaded={cacheOrganizationExtensions} onCategoriesLoaded={setOrganizationCategories} onOpenDetails={openExtensionDetails} onInstalledChange={refreshInstalled} />
            : kind === "skills" ? <SkillsConfig cwd={cwd} onTrustProject={onTrustProject} fixedInstallScope={installedScope} embedded view={contentView} revision={installedRevision + installedRefresh + reloadRevision} selection={selection?.skill} onInstalledChange={refreshInstalled} onManageSkill={skill => { const item = mergeInstalledCapabilities({ skills: [skill] })[0]; if (item) openInstalled(item); }} onClose={() => undefined} />
            : kind === "plugins" ? <PluginsConfig cwd={cwd} sessionId={sessionId} onTrustProject={onTrustProject} fixedInstallScope={installedScope} embedded view={contentView} revision={installedRevision + installedRefresh + reloadRevision} selection={selection?.plugin} onInstalledChange={refreshInstalled} onClose={() => undefined} onReloaded={onReloaded} />
            : <McpConfig cwd={cwd} sessionId={sessionId} fixedInstallScope={scope ?? installedScope} view={contentView} revision={installedRevision + installedRefresh + reloadRevision} selection={selection?.mcp} onInstalledChange={refreshInstalled} onReloaded={onReloaded} />}
        </div>;
      })}
    </div>
  </main>;
}
