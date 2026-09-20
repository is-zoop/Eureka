"use client";

import { NotificationNotice } from "@/components/Notifications";
import { notify } from "@/lib/notification-store";


import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ClockIcon, CpuIcon, EyeIcon, LayersIcon, PackagePlusIcon, StarIcon } from "lucide-react";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export type OrganizationExtensionDetailItem = {
  id: string;
  name: string;
  type: "Skill" | "MCP";
  description: string;
  author: string;
  department: string | null;
  category: string | null;
  tags: string[];
  calls: number;
  isFavorite: boolean;
  updatedAt: string | null;
  version: string;
  connectType: string | null;
  serverUrl: string | null;
  versionHistory: { version: string; createdAt: string; changelog: string | string[] | null }[];
  iconUrl: string | null;
};

type DetailTab = "details" | "quickStart" | "readme";
type ContentState = "idle" | "loading" | "ready" | "error";
type InstallScope = "project" | "global";
type Installation = { capabilityId: string; version: string; scope: InstallScope; disabled?: boolean };
type InstallationResponse = { global?: Installation[]; project?: Installation[]; error?: string };

function formatDate(value: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

function versionNotes(changelog: string | string[] | null) {
  const values = Array.isArray(changelog) ? changelog : changelog?.split(/\r?\n/) ?? [];
  return values.map((value) => value.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function CapabilityIcon({ item }: { item: OrganizationExtensionDetailItem }) {
  const [failed, setFailed] = useState(false);
  const fallback = item.type === "MCP" ? <CpuIcon className="h-5 w-5" /> : <LayersIcon className="h-5 w-5" />;
  return <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] bg-[var(--bg-hover)] text-[var(--text-muted)]">{item.iconUrl && !failed ? <img src={item.iconUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : fallback}</span>;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="mt-1 truncate text-xs font-semibold text-[var(--text)]">{value || "-"}</p></div>;
}

function rewriteDocumentImages(markdown: string, capabilityId: string, basePath: string) {
  const base = basePath.replace(/^\/+|\/+$/g, "");
  return markdown.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (source, alt: string, src: string) => {
    if (/^(?:https?:|data:|blob:|\/)/i.test(src)) return source;
    const parts = `${base}/${src}`.split("/").filter((part) => part && part !== ".");
    const normalized: string[] = [];
    for (const part of parts) { if (part === "..") normalized.pop(); else normalized.push(part); }
    return `![${alt}](/api/organization-extensions/${encodeURIComponent(capabilityId)}/documentation/${normalized.map(encodeURIComponent).join("/")})`;
  });
}

export function OrganizationExtensionDetails({ item, cwd, onClose, onFavoriteChange }: { item: OrganizationExtensionDetailItem; cwd: string; onClose: () => void; onFavoriteChange: (id: string, isFavorite: boolean) => void }) {
  const [tab, setTab] = useState<DetailTab>("details");
  const [content, setContent] = useState<string | null>(null);
  const [basePath, setBasePath] = useState("");
  const [contentState, setContentState] = useState<ContentState>("idle");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [installations, setInstallations] = useState<InstallationResponse>({});
  const [installScope, setInstallScope] = useState<InstallScope>("project");
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const documentFile = tab === "quickStart" ? "quick_start.md" : tab === "readme" ? "README.md" : null;
  const versions = useMemo(() => [...item.versionHistory].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)), [item.versionHistory]);

  useEffect(() => {
    if (!documentFile) { setContent(null); setContentState("idle"); return; }
    const controller = new AbortController();
    setContentState("loading");
    setContent(null);
    void fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/content?file=${documentFile}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { content?: string | null; basePath?: string } | null;
        if (!response.ok) throw new Error("content");
        if (!controller.signal.aborted) { setContent(payload?.content ?? null); setBasePath(payload?.basePath ?? ""); setContentState("ready"); }
      })
      .catch(() => { if (!controller.signal.aborted) setContentState("error"); });
    return () => controller.abort();
  }, [documentFile, item.id]);

  const loadInstallations = useCallback(async () => {
    if (!cwd) return;
    const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as InstallationResponse | null;
    if (response.ok && payload) setInstallations(payload);
  }, [cwd, item.id]);

  useEffect(() => { void loadInstallations(); }, [loadInstallations]);

  const toggleFavorite = async () => {
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    setFavoriteError(null);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/favorite`, { method: "POST" });
      const payload = await response.json().catch(() => null) as { isFavorite?: boolean } | null;
      if (!response.ok || typeof payload?.isFavorite !== "boolean") throw new Error("favorite");
      onFavoriteChange(item.id, payload.isFavorite);
    } catch {
      setFavoriteError("收藏操作失败，请稍后重试。");
    } finally { setFavoriteBusy(false); }
  };

  const selectedInstall = (installations[installScope] ?? []).find((install) => install.capabilityId === item.id);
  const runInstallAction = async (action: "install" | "update" | "uninstall" | "set-disabled", disabled?: boolean, scopeOverride?: InstallScope) => {
    if (!cwd || installBusy) return;
    setInstallBusy(true); setInstallError(null);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(item.id)}/installation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: scopeOverride ?? installScope, action, type: item.type, ...(disabled === undefined ? {} : { disabled }) }),
      });
      const payload = await response.json().catch(() => null) as InstallationResponse | null;
      if (!response.ok || !payload) throw new Error(payload?.error ?? "操作失败，请稍后重试。");
      setInstallations(payload);
      const actionText = action === "install" ? "已安装" : action === "update" ? "已更新" : action === "uninstall" ? "已卸载" : disabled ? "已停用" : "已启用";
      notify({ type: "success", title: actionText, message: `${item.name}${actionText}。重载会话后生效。` });
    } catch (error) { setInstallError(error instanceof Error ? error.message : "操作失败，请稍后重试。"); }
    finally { setInstallBusy(false); }
  };

  return <div className="flex h-full min-h-0 flex-col bg-[var(--sidebar-bg)] text-[var(--text)]"><header className="shrink-0 border-b border-[var(--border)] bg-[var(--sidebar-bg)] p-4"><div className="flex items-start gap-3"><CapabilityIcon item={item} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold">{item.name}</h2><span className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{item.type}</span></div></div><button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]" aria-label="关闭详情"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div><Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)} className="mt-4"><TabsList className="grid h-8 w-full grid-cols-3"><TabsTrigger value="details" className="gap-1 text-xs"><EyeIcon className="h-3.5 w-3.5" />查看详情</TabsTrigger><TabsTrigger value="quickStart" className="text-xs">快速开始</TabsTrigger><TabsTrigger value="readme" className="text-xs">查看文档</TabsTrigger></TabsList></Tabs></header><main className="min-h-0 flex-1 overflow-y-auto bg-[var(--sidebar-bg)] p-4">{tab === "details" ? <div className="space-y-3"><Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-3"><CardTitle className="text-xs">基本信息</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 pt-0 sm:grid-cols-3"><DetailField label="版本号" value={item.version} />{item.type === "MCP" && <DetailField label="连接方式" value={item.connectType ?? "-"} />}<DetailField label="调用次数" value={`${item.calls} 次`} /><DetailField label="开发者" value={item.author} /><DetailField label="归属部门" value={item.department ?? "-"} /><DetailField label="更新时间" value={formatDate(item.updatedAt)} /></CardContent></Card><Card className="rounded-[var(--radius-card)] shadow-none"><CardContent className="grid gap-4 p-4 sm:grid-cols-2"><div><p className="text-xs font-semibold">业务分类</p><div className="mt-2 text-xs text-[var(--text-muted)]">{item.category ? <span className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5">{item.category}</span> : "-"}</div></div><div><p className="text-xs font-semibold">能力标签</p><div className="mt-2 flex flex-wrap gap-1.5">{item.tags.length ? item.tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">{tag}</span>) : <span className="text-xs text-[var(--text-muted)]">暂无标签</span>}</div></div></CardContent></Card><Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-2"><CardTitle className="text-xs">能力描述</CardTitle></CardHeader><CardContent className="p-4 pt-0"><p className="whitespace-pre-wrap text-xs leading-6 text-[var(--text-muted)]">{item.description || "暂无能力描述"}</p></CardContent></Card><Card className="rounded-[var(--radius-card)] shadow-none"><CardHeader className="p-4 pb-2"><CardTitle className="flex items-center gap-2 text-xs"><ClockIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />版本更新记录</CardTitle></CardHeader><CardContent className="p-4 pt-1">{versions.length ? <div className="divide-y divide-[var(--border)]">{versions.map((version, index) => <div key={`${version.version}-${version.createdAt}-${index}`} className="relative py-3 pl-5 first:pt-1 last:pb-1"><span className="absolute left-0 top-4 h-2 w-2 rounded-full bg-[var(--border)]" /><div className="flex gap-2"><span className="text-xs font-semibold">{version.version.startsWith("v") ? version.version : `v${version.version}`}</span><span className="text-xs text-[var(--text-muted)]">{formatDate(version.createdAt)}</span></div>{versionNotes(version.changelog).length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[var(--text-muted)]">{versionNotes(version.changelog).map((note) => <li key={note}>{note}</li>)}</ul> : <p className="mt-2 text-xs text-[var(--text-muted)]">暂无更新说明</p>}</div>)}</div> : <p className="py-6 text-center text-xs text-[var(--text-muted)]">暂无版本更新记录</p>}</CardContent></Card></div> : contentState === "loading" ? <div className="grid min-h-48 place-items-center text-sm text-[var(--text-muted)]">正在加载…</div> : contentState === "error" ? <NotificationNotice message="内容加载失败。" /> : content?.trim() ? <MarkdownBody className="text-sm" isStreaming={false}>{rewriteDocumentImages(content, item.id, basePath)}</MarkdownBody> : <div className="grid min-h-48 place-items-center text-sm text-[var(--text-muted)]">没有可以展示的内容。</div>}</main><footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--sidebar-bg)] p-4"><NotificationNotice message={favoriteError ?? installError} type="error" /><Button variant="outline" onClick={() => void toggleFavorite()} disabled={favoriteBusy}><StarIcon className={`mr-1.5 h-3.5 w-3.5 ${item.isFavorite ? "fill-yellow-400 text-yellow-400" : ""}`} />{item.isFavorite ? "取消收藏" : "收藏"}</Button><div className="flex items-center gap-1">{selectedInstall ? <><DropdownMenu><DropdownMenuTrigger disabled={installBusy} render={<Button variant="outline">{installScope === "project" ? "项目" : "全局"}<ChevronDownIcon className="ml-1 h-3.5 w-3.5" /></Button>} /><DropdownMenuContent align="end" className="min-w-24 border border-[var(--border)] bg-[var(--bg-panel)] p-1 shadow-[var(--shadow-soft)]"><DropdownMenuItem className="text-xs" onClick={() => setInstallScope("project")}>项目安装</DropdownMenuItem><DropdownMenuItem className="text-xs" onClick={() => setInstallScope("global")}>全局安装</DropdownMenuItem></DropdownMenuContent></DropdownMenu>{item.type === "MCP" ? <Button variant="outline" disabled={installBusy} onClick={() => void runInstallAction("set-disabled", !selectedInstall.disabled)}>{selectedInstall.disabled ? "启用" : "停用"}</Button> : null}{selectedInstall.version !== item.version ? <Button variant="outline" disabled={installBusy} onClick={() => void runInstallAction("update")}>更新</Button> : null}<Button variant="outline" disabled={installBusy} onClick={() => void runInstallAction("uninstall")}>卸载</Button></> : <DropdownMenu><DropdownMenuTrigger disabled={installBusy || !cwd} render={<Button><PackagePlusIcon className="mr-1.5 h-3.5 w-3.5" />安装<ChevronDownIcon className="ml-1 h-3.5 w-3.5" /></Button>} /><DropdownMenuContent align="end" className="min-w-28 border border-[var(--border)] bg-[var(--bg-panel)] p-1 shadow-[var(--shadow-soft)]"><DropdownMenuItem className="text-xs" onClick={() => { setInstallScope("project"); void runInstallAction("install", undefined, "project"); }}>项目安装</DropdownMenuItem><DropdownMenuItem className="text-xs" onClick={() => { setInstallScope("global"); void runInstallAction("install", undefined, "global"); }}>全局安装</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></footer></div>;
}
