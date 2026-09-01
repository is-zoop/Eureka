"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ClockIcon, CpuIcon, EyeIcon, LayersIcon, LayoutGridIcon, LayoutListIcon, PackagePlusIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, StarIcon } from "lucide-react";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { OrganizationExtensionDetailItem } from "./OrganizationExtensionDetails";
import { useI18n } from "@/hooks/useI18n";

type ExtensionGroup = "organization" | "market";
type OrganizationSection = "skills" | "mcp";
type MarketSection = "skills" | "plugins";
type ViewMode = "cards" | "table";
type Filter = { kind: "all" | "favorites" | "frequent" } | { kind: "category"; categoryId: number };
type OrganizationExtension = OrganizationExtensionDetailItem & { categoryId: number | null };
type OrganizationCategory = { id: number; name: string };
type LoadState = "loading" | "ready" | "empty" | "unauthenticated" | "forbidden" | "error";
type OrganizationCache = Partial<Record<OrganizationSection, { items: OrganizationExtension[] }>>;
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

function getFilterLabel(filter: Filter, categories: OrganizationCategory[]) {
  if (filter.kind === "favorites") return "我的收藏";
  if (filter.kind === "frequent") return "高频使用";
  if (filter.kind === "category") return categories.find((category) => category.id === filter.categoryId)?.name ?? "业务分类";
  return "全部能力";
}

function ViewToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (viewMode: ViewMode) => void }) {
  const buttonClass = (active: boolean) => `grid h-7 w-7 place-items-center rounded-[calc(var(--radius-control)-2px)] transition-colors ${active ? "bg-[var(--bg-selected)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}`;
  return <div className="flex items-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-hover)] p-0.5">
    <Tooltip><TooltipTrigger render={<button type="button" aria-label="卡片视图" className={buttonClass(viewMode === "cards")} onClick={() => onChange("cards")}><LayoutGridIcon className="h-4 w-4" /></button>} /><TooltipContent>卡片视图</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger render={<button type="button" aria-label="表格视图" className={buttonClass(viewMode === "table")} onClick={() => onChange("table")}><LayoutListIcon className="h-4 w-4" /></button>} /><TooltipContent>表格视图</TooltipContent></Tooltip>
  </div>;
}

function FilterMenu({ filter, categories, items, onChange }: { filter: Filter; categories: OrganizationCategory[]; items: OrganizationExtension[]; onChange: (filter: Filter) => void }) {
  const active = (next: Filter) => next.kind === filter.kind && (next.kind !== "category" || filter.kind === "category" && next.categoryId === filter.categoryId);
  const countFor = (categoryId: number) => items.filter((item) => item.categoryId === categoryId).length;
  const itemClass = (selected: boolean) => `min-w-48 cursor-pointer text-[13px] text-[var(--text)] ${selected ? "font-medium" : "hover:bg-[var(--bg-hover)]"}`;
  const option = (label: string, next: Filter, icon?: React.ReactNode, count?: number) => <DropdownMenuItem key={label} className={itemClass(active(next))} style={active(next) ? { backgroundColor: "var(--bg-hover)" } : undefined} onClick={() => onChange(next)}>{icon}{label}{typeof count === "number" && <span className="ml-auto rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">{count}</span>}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger render={<button type="button" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)] px-3 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><SlidersHorizontalIcon className="h-3.5 w-3.5" />{getFilterLabel(filter, categories)}<ChevronDownIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" /></button>} /><DropdownMenuContent className="w-56 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-panel)] p-1 shadow-[var(--shadow-soft)]"><DropdownMenuGroup>{option("全部能力", { kind: "all" }, undefined, items.length)}{option("我的收藏", { kind: "favorites" }, <StarIcon className="h-3.5 w-3.5" />, items.filter((item) => item.isFavorite).length)}{option("高频使用", { kind: "frequent" }, <ClockIcon className="h-3.5 w-3.5" />, items.filter((item) => item.calls >= 1000).length)}</DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuLabel className="px-2 py-1.5 text-[13px] text-[var(--text-muted)]">业务分类</DropdownMenuLabel>{categories.map((category) => option(category.name, { kind: "category", categoryId: category.id }, undefined, countFor(category.id)))}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}

function CapabilityCards({ items, onOpenDetails }: { items: OrganizationExtension[]; onOpenDetails: (item: OrganizationExtension) => void }) {
  const { t } = useI18n();
  if (!items.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--text-muted)]">没有找到符合条件的组织扩展。</div>;
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => {
    const tags = item.category && !item.tags.includes(item.category) ? [item.category, ...item.tags] : item.tags;
    const attribution = [item.author, item.department].filter(Boolean).join(" · ");
    return <Card key={item.id} className="organization-extension-card flex min-h-52 flex-col rounded-[var(--radius-card)] bg-[var(--bg-panel)] p-4 shadow-none"><div className="flex min-w-0 items-start gap-3"><CapabilityIcon item={item} /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-[var(--text)]">{item.name}</h2><span className="mt-1 inline-flex rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs font-semibold text-[var(--text-muted)]">{item.type}</span></div></div><CardContent className="mt-3 px-0"><p className="line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">{item.description || t("extensions.marketNoDescription")}</p><div className="mt-2 flex min-h-5 flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{tag}</span>)}</div></CardContent><div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><span className="min-w-0 truncate text-xs text-[var(--text-muted)]">{attribution || t("extensions.marketUnknownAuthor")}</span><div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" onClick={() => onOpenDetails(item)}><EyeIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.viewDetails")}</Button><Button size="sm" onClick={() => undefined}><PackagePlusIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.install")}</Button></div></div></Card>;
  })}</div>;
}

function CapabilityTable({ items, onOpenDetails }: { items: OrganizationExtension[]; onOpenDetails: (item: OrganizationExtension) => void }) {
  const { t } = useI18n();
  if (!items.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--text-muted)]">没有找到符合条件的组织扩展。</div>;
  return <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)]"><table className="min-w-[1040px] w-full border-collapse text-left text-xs"><thead className="bg-[var(--bg-hover)] text-[var(--text-muted)]"><tr><th className="whitespace-nowrap px-4 py-2 font-medium">名称</th><th className="whitespace-nowrap px-3 py-2 font-medium">描述</th><th className="whitespace-nowrap px-3 py-2 font-medium">标签</th><th className="whitespace-nowrap px-3 py-2 font-medium">作者 / 部门</th><th className="whitespace-nowrap px-3 py-2 text-right font-medium">调用次数</th><th className="sticky right-0 z-20 whitespace-nowrap border-l border-[var(--border)] bg-[var(--bg-hover)] px-4 py-2 text-right font-medium">操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-[var(--border)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]"><td className="whitespace-nowrap px-4 py-2"><div className="flex items-center gap-2"><CapabilityIcon item={item} /><span className="max-w-56 truncate font-medium text-[var(--text)]">{item.name}</span></div></td><td className="whitespace-nowrap px-3 py-2 text-[var(--text-muted)]"><p className="max-w-80 truncate">{item.description || t("extensions.marketNoDescription")}</p></td><td className="whitespace-nowrap px-3 py-2"><div className="flex max-w-48 flex-nowrap gap-1 overflow-hidden">{item.tags.slice(0, 2).map((tag) => <span key={tag} className="shrink-0 rounded bg-[var(--bg-hover)] px-1 py-0.5 text-[11px] text-[var(--text-muted)]">{tag}</span>)}</div></td><td className="max-w-44 truncate whitespace-nowrap px-3 py-2 text-[var(--text-muted)]">{[item.author, item.department].filter(Boolean).join(" · ") || t("extensions.marketUnknownAuthor")}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-muted)]">{formatCalls(item.calls)}</td><td className="sticky right-0 z-10 whitespace-nowrap border-l border-[var(--border)] bg-[var(--bg-panel)] px-4 py-2"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => onOpenDetails(item)}><EyeIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.viewDetails")}</Button><Button size="sm" className="whitespace-nowrap" onClick={() => undefined}><PackagePlusIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.install")}</Button></div></td></tr>)}</tbody></table></div>;
}

function OrganizationExtensionsPage({ kind, cached, categories, onLoaded, onCategoriesLoaded, onOpenDetails }: { kind: OrganizationSection; cached?: { items: OrganizationExtension[] }; categories?: OrganizationCategory[]; onLoaded: (kind: OrganizationSection, items: OrganizationExtension[]) => void; onCategoriesLoaded: (categories: OrganizationCategory[]) => void; onOpenDetails: (item: OrganizationExtension) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>(() => cached ? (cached.items.length ? "ready" : "empty") : "loading");
  const [items, setItems] = useState<OrganizationExtension[]>(() => cached?.items ?? []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [viewMode, setViewMode] = useState<ViewMode>(() => typeof window !== "undefined" && window.localStorage.getItem("eureka-organization-extensions-view") === "table" ? "table" : "cards");
  const load = async (signal?: AbortSignal, background = false) => {
    if (!background) setState("loading");
    try {
      const response = await fetch(`/api/organization-extensions?type=${kind === "skills" ? "skill" : "mcp"}`, { signal, cache: "no-store" });
      const payload = await response.json().catch(() => null) as { items?: OrganizationExtension[]; error?: string } | null;
      if (signal?.aborted) return;
      if (response.ok && Array.isArray(payload?.items)) { setItems(payload.items); setState(payload.items.length ? "ready" : "empty"); onLoaded(kind, payload.items); return; }
      if (!background) setState(payload?.error === "unauthenticated" ? "unauthenticated" : payload?.error === "forbidden" ? "forbidden" : "error");
    } catch (error) { if ((error as Error).name !== "AbortError" && !background) setState("error"); }
  };
  useEffect(() => { if (cached) { setItems(cached.items); setState(cached.items.length ? "ready" : "empty"); } const controller = new AbortController(); void load(controller.signal, Boolean(cached)); return () => controller.abort(); }, [kind]);
  useEffect(() => { if (cached) setItems(cached.items); }, [cached]);
  useEffect(() => { window.localStorage.setItem("eureka-organization-extensions-view", viewMode); }, [viewMode]);
  useEffect(() => { if (categories) return; const controller = new AbortController(); void fetch("/api/organization-extensions/categories", { signal: controller.signal, cache: "no-store" }).then(async (response) => { const payload = await response.json().catch(() => null) as { items?: OrganizationCategory[] } | null; if (response.ok && Array.isArray(payload?.items)) onCategoriesLoaded(payload.items); }).catch(() => undefined); return () => controller.abort(); }, [categories, onCategoriesLoaded]);
  const availableCategories = useMemo(() => { const byId = new Map((categories ?? []).map((category) => [category.id, category])); items.forEach((item) => { if (item.categoryId !== null && item.category && !byId.has(item.categoryId)) byId.set(item.categoryId, { id: item.categoryId, name: item.category }); }); return [...byId.values()]; }, [categories, items]);
  const visibleItems = useMemo(() => { const normalized = query.trim().toLocaleLowerCase(); return items.filter((item) => (filter.kind === "favorites" ? item.isFavorite : filter.kind === "frequent" ? item.calls >= 1000 : filter.kind === "category" ? item.categoryId === filter.categoryId : true) && (!normalized || [item.name, item.description, item.author, item.department ?? "", item.category ?? "", ...item.tags].some((value) => value.toLocaleLowerCase().includes(normalized)))); }, [filter, items, query]);
  const emptyText = kind === "skills" ? t("extensions.organizationSkillsEmpty") : t("extensions.organizationMcpEmpty");
  const statusText = state === "unauthenticated" ? t("extensions.marketUnauthenticated") : state === "forbidden" ? t("extensions.marketForbidden") : state === "error" ? t("extensions.marketLoadFailed") : emptyText;
  if (state !== "ready") return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center"><span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-[var(--bg-hover)] text-[var(--text-muted)]"><ExtensionIcon kind={kind} /></span><h2 className="text-lg font-semibold text-[var(--text)]">{state === "loading" ? t("extensions.marketLoading") : kind === "skills" ? t("extensions.skills") : t("extensions.mcp")}</h2>{state !== "loading" && <p className="max-w-md text-sm leading-6 text-[var(--text-muted)]">{statusText}</p>}{state === "error" && <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />{t("extensions.reload")}</Button>}</div>;
  return <div className="flex h-full min-h-0 flex-col bg-[var(--chat-bg)]"><div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><FilterMenu filter={filter} categories={availableCategories} items={items} onChange={setFilter} /><div className="relative min-w-0 flex-1 sm:max-w-md"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索能力、标签、作者或部门…" className="h-8 bg-[var(--bg-panel)] pl-9 pr-3 text-[13px] text-[var(--text)] placeholder:text-[13px] focus-visible:border-[var(--border)]" /></div><div className="sm:ml-auto"><ViewToggle viewMode={viewMode} onChange={setViewMode} /></div></div></div><div className="min-h-0 flex-1 overflow-y-auto p-4">{viewMode === "cards" ? <CapabilityCards items={visibleItems} onOpenDetails={onOpenDetails} /> : <CapabilityTable items={visibleItems} onOpenDetails={onOpenDetails} />}</div></div>;
}

export function ExtensionsCenter({ cwd, sessionId, onReloaded, onOpenExtensionDetails }: Props) {
  const { t } = useI18n();
  const [group, setGroup] = useState<ExtensionGroup>("organization");
  const [organizationSection, setOrganizationSection] = useState<OrganizationSection>("skills");
  const [marketSection, setMarketSection] = useState<MarketSection>("skills");
  const [organizationCache, setOrganizationCache] = useState<OrganizationCache>({});
  const [organizationCategories, setOrganizationCategories] = useState<OrganizationCategory[] | undefined>();
  const cacheOrganizationExtensions = (section: OrganizationSection, items: OrganizationExtension[]) => setOrganizationCache((current) => ({ ...current, [section]: { items } }));
  const updateFavorite = (id: string, isFavorite: boolean) => setOrganizationCache((current) => Object.fromEntries(Object.entries(current).map(([section, entry]) => [section, entry ? { items: entry.items.map((item) => item.id === id ? { ...item, isFavorite } : item) } : entry])) as OrganizationCache);
  const openExtensionDetails = (item: OrganizationExtension) => onOpenExtensionDetails(item, updateFavorite);
  return <main className="flex h-full min-h-0 flex-col bg-[var(--chat-bg)] text-[var(--text)]"><Tabs value={group} onValueChange={(value) => setGroup(value as ExtensionGroup)} className="flex min-h-0 flex-1 flex-col"><header className="shrink-0 border-b border-[var(--border)] bg-[var(--chat-bg)]"><div className="flex h-11 items-center gap-4 px-5"><TabsList className="h-full gap-0 rounded-none bg-transparent p-0"><TabsTrigger value="organization" className="h-full rounded-none border-b-2 border-transparent px-3 text-sm data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none">{t("extensions.organization")}</TabsTrigger><TabsTrigger value="market" className="h-full rounded-none border-b-2 border-transparent px-3 text-sm data-[state=active]:border-[var(--accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none">{t("extensions.market")}</TabsTrigger></TabsList><span aria-hidden="true" className="h-5 w-px bg-[var(--border)]" /><Tabs value={group === "organization" ? organizationSection : marketSection} onValueChange={(value) => group === "organization" ? setOrganizationSection(value as OrganizationSection) : setMarketSection(value as MarketSection)}><TabsList><TabsTrigger value="skills" className="gap-1.5"><ExtensionIcon kind="skills" />{t("extensions.skills")}</TabsTrigger>{group === "organization" ? <TabsTrigger value="mcp" className="gap-1.5"><ExtensionIcon kind="mcp" />{t("extensions.mcp")}</TabsTrigger> : <TabsTrigger value="plugins" className="gap-1.5"><ExtensionIcon kind="plugins" />{t("extensions.plugins")}</TabsTrigger>}</TabsList></Tabs></div></header><TabsContent value="organization" className="min-h-0 flex-1 overflow-hidden"><Tabs value={organizationSection} onValueChange={(value) => setOrganizationSection(value as OrganizationSection)} className="h-full"><TabsContent value="skills" className="h-full"><OrganizationExtensionsPage kind="skills" cached={organizationCache.skills} categories={organizationCategories} onLoaded={cacheOrganizationExtensions} onCategoriesLoaded={setOrganizationCategories} onOpenDetails={openExtensionDetails} /></TabsContent><TabsContent value="mcp" className="h-full"><OrganizationExtensionsPage kind="mcp" cached={organizationCache.mcp} categories={organizationCategories} onLoaded={cacheOrganizationExtensions} onCategoriesLoaded={setOrganizationCategories} onOpenDetails={openExtensionDetails} /></TabsContent></Tabs></TabsContent><TabsContent value="market" className="min-h-0 flex-1 overflow-hidden"><Tabs value={marketSection} onValueChange={(value) => setMarketSection(value as MarketSection)} className="h-full"><TabsContent value="skills" className="h-full"><SkillsConfig cwd={cwd} embedded onClose={() => undefined} /></TabsContent><TabsContent value="plugins" className="h-full"><PluginsConfig cwd={cwd} sessionId={sessionId} embedded onClose={() => undefined} onReloaded={onReloaded} /></TabsContent></Tabs></TabsContent></Tabs></main>;
}
