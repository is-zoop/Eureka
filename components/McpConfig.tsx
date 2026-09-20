"use client";

import { NotificationNotice } from "@/components/Notifications";


import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { sendAgentCommand } from "@/lib/agent-client";
import type { HazeManagedMcpSummary, McpConfigScope, McpRuntimeStatus, McpServerInput, McpServerSummary, McpServersResponse } from "@/lib/api-types";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./ui/combobox";

const sidebarWidth = 210;
const blank = (): McpServerInput => ({ name: "", transport: "stdio", command: "", args: [], lifecycle: "lazy", idleTimeout: 10 });
const shortenPath = (path: string) => path.replace(/\\/g, "/").replace(/^([A-Za-z]:)\/Users\/[^/]+/, "~");
const stateColor = (state?: string) => state === "connected" ? "#22c55e" : state === "failed" || state === "needs-auth" ? "#ef4444" : state === "connecting" ? "#f59e0b" : state === "disabled" ? "var(--text-dim)" : "var(--border)";
const lifecycleNote: Record<NonNullable<McpServerInput["lifecycle"]>, string> = {
  lazy: "仅在首次调用该 Server 工具时连接，节省资源。",
  eager: "会话启动或重载后立即连接，减少首次调用等待。",
  "keep-alive": "连接后尽量保持在线，适合需要频繁调用的 Server。",
};

const controlStyle = { height: 32, boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", color: "var(--text)", padding: "0 9px", fontSize: 12 } as const;

function Field({ label, value, placeholder, type = "text", onChange }: { label: string; value: string | number | undefined; placeholder?: string; type?: "text" | "number"; onChange: (value: string) => void }) {
  return <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text-muted)" }}><span>{label}</span><input type={type} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} style={{ ...controlStyle, width: "100%" }} /></label>;
}

function SegmentedScope({ value, onChange }: { value: McpConfigScope; onChange: (scope: McpConfigScope) => void }) {
  return <div style={{ display: "flex", height: 30, overflow: "hidden", border: "1px solid var(--border)", borderRadius: 7 }}>
    {(["global", "project"] as McpConfigScope[]).map((scope) => <button key={scope} type="button" onClick={() => onChange(scope)} style={{ width: 76, border: "none", borderRight: scope === "global" ? "1px solid var(--border)" : "none", background: value === scope ? "var(--bg-selected)" : "none", color: value === scope ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>{scope}</button>)}
  </div>;
}

export function McpConfig({ cwd, sessionId, onReloaded }: { cwd: string; sessionId: string | null; onReloaded?: () => void }) {
  const isMobile = useIsMobile();
  const [scope, setScope] = useState<McpConfigScope>("project");
  const [data, setData] = useState<McpServersResponse | null>(null);
  const [status, setStatus] = useState<McpRuntimeStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<McpServerInput>(blank);
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/mcp/servers?cwd=${encodeURIComponent(cwd)}&scope=${scope}`, { cache: "no-store" });
    const payload = await response.json() as McpServersResponse & { error?: string };
    if (!response.ok || payload.error) throw new Error(payload.error ?? "加载 MCP 配置失败");
    setData(payload);
    setSelected((current) => current && payload.servers.some((server) => server.name === current) ? current : payload.servers[0]?.name ?? null);
  }, [cwd, scope]);

  const loadStatus = useCallback(async () => {
    if (!sessionId) { setStatus(null); return; }
    const response = await fetch(`/api/mcp/status?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    setStatus((await response.json() as { status: McpRuntimeStatus | null }).status);
  }, [sessionId]);

  useEffect(() => { void load().catch((value) => setError(value instanceof Error ? value.message : String(value))); }, [load]);
  useEffect(() => { void loadStatus(); const timer = window.setInterval(() => void loadStatus(), 3000); return () => window.clearInterval(timer); }, [loadStatus]);

  const servers = useMemo(() => (data?.servers ?? []).map((server) => {
    const live = status?.servers.find((item) => item.name === server.name);
    if (server.disabled) return { ...server, state: "disabled" as const, toolCount: 0 };
    return live ? { ...server, state: live.state, toolCount: live.toolCount } : server;
  }), [data?.servers, status]);
  // Runtime status refreshes every few seconds. Keep draft editing tied to the
  // persisted config instead, so polling cannot overwrite unsaved field edits.
  const configuredActive = data?.servers.find((server) => server.name === selected) ?? null;
  useEffect(() => { if (configuredActive && !isNew) setForm({ ...configuredActive }); }, [configuredActive, isNew]);

  const update = <K extends keyof McpServerInput>(key: K, value: McpServerInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const add = () => { setSelected(null); setForm(blank()); setIsNew(true); setNotice(null); };
  const edit = (server: McpServerSummary) => { setSelected(server.name); setForm({ ...server }); setIsNew(false); setNotice(null); };
  const savedPath = scope === "project" ? `${shortenPath(cwd)}/.mcp.json` : "~/.config/mcp/mcp.json";
  const buttonStyle = (primary = false, disabled = false): CSSProperties => ({ height: 32, boxSizing: "border-box", border: primary ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 5, background: primary ? "var(--accent)" : "var(--bg-panel)", color: primary ? "var(--accent-foreground, #fff)" : "var(--text)", padding: "0 10px", fontSize: 12, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 });

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/mcp/servers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope, action: isNew ? "create" : "update", previousName: isNew ? undefined : selected, server: { ...form, args: (form.args ?? []).filter(Boolean) } }) });
      const payload = await response.json() as McpServersResponse & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "保存失败");
      setData(payload); setSelected(form.name); setIsNew(false); setNotice("已保存。重载当前会话后生效。");
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setBusy(false); }
  };
  const reload = async () => {
    if (!sessionId) return;
    setBusy(true); setError(null); setNotice(null);
    try { await sendAgentCommand(sessionId, { type: "reload" }); onReloaded?.(); await loadStatus(); setNotice("当前会话已重载。"); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setBusy(false); }
  };
  const toggleDisabled = async () => {
    if (!selected || isNew || !configuredActive) return;
    const disabled = !configuredActive.disabled;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/mcp/servers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, scope, action: "set-disabled", previousName: selected, disabled }) });
      const payload = await response.json() as McpServersResponse & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "更新失败");
      setData(payload);
      setForm((current) => ({ ...current, disabled }));
      setNotice(disabled ? "已禁用。重载当前会话后停止加载该 Server。" : "已启用。重载当前会话后生效。");
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setBusy(false); }
  };
  const runManagedAction = async (server: HazeManagedMcpSummary, action: "update" | "uninstall" | "set-disabled", disabled?: boolean) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/organization-extensions/${encodeURIComponent(server.capabilityId)}/installation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: server.scope, action, type: "MCP", ...(disabled === undefined ? {} : { disabled }) }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "操作失败");
      await load();
      setNotice(action === "uninstall" ? "已卸载。重载当前会话后生效。" : action === "update" ? "已更新。重载当前会话后生效。" : disabled ? "已停用。重载当前会话后生效。" : "已启用。重载当前会话后生效。");
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); } finally { setBusy(false); }
  };

  return <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--chat-bg)", color: "var(--text)" }}>
    <div style={{ height: 42, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>MCP</span><code style={{ minWidth: 0, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{shortenPath(cwd)}</code>
      <button type="button" onClick={() => void load()} title="刷新配置" style={{ ...buttonStyle(), marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}><RefreshCwIcon size={13} /> 刷新</button>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
      <aside style={{ width: isMobile ? "100%" : sidebarWidth, maxHeight: isMobile ? "40vh" : undefined, display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)", borderRight: isMobile ? "none" : "1px solid var(--border)", borderBottom: isMobile ? "1px solid var(--border)" : "none" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {error && !data ? <NotificationNotice message={error} type="error" /> : null}
          {!error && servers.length === 0 ? <p style={{ padding: "10px 8px", margin: 0, fontSize: 11, color: "var(--text-dim)" }}>未找到 MCP Server</p> : null}
          {servers.map((server) => { const isSelected = !isNew && selected === server.name; return <button key={server.name} type="button" onClick={() => edit(server)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 7, padding: "8px", border: "none", borderRadius: 5, cursor: "pointer", textAlign: "left", background: isSelected ? "var(--bg-selected)" : "transparent", color: "var(--text)" }} onMouseEnter={(event) => { if (!isSelected) event.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(event) => { if (!isSelected) event.currentTarget.style.background = "transparent"; }}><span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: stateColor(server.state) }} /><span style={{ minWidth: 0, flex: 1 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: isSelected ? 600 : 400 }}>{server.name}</span><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2, fontSize: 10, color: "var(--text-dim)" }}>{server.transport === "http" ? "HTTP" : "Stdio"} · {server.disabled ? "已禁用" : `${server.toolCount} 工具`}</span></span></button>; })}
          {(data?.managedServers?.length ?? 0) > 0 ? <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}><p style={{ margin: "0 8px 6px", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.04em" }}>HAZE 受管 MCP</p>{data!.managedServers!.map((server) => <div key={server.capabilityId} style={{ padding: "8px", borderRadius: 5, background: "var(--bg-hover)", marginBottom: 4 }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: server.disabled ? "var(--text-dim)" : "var(--accent)" }} /><span title={server.name} style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontFamily: "var(--font-mono)" }}>{server.name}</span></div><span style={{ display: "block", margin: "3px 0 6px 13px", color: "var(--text-dim)", fontSize: 10 }}>HTTP · v{server.version} · {server.disabled ? "已停用" : "已启用"}</span><div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginLeft: 13 }}><button type="button" disabled={busy} onClick={() => void runManagedAction(server, "set-disabled", !server.disabled)} style={{ ...buttonStyle(false, busy), height: 25, padding: "0 7px", fontSize: 10 }}>{server.disabled ? "启用" : "停用"}</button><button type="button" disabled={busy} onClick={() => void runManagedAction(server, "update")} style={{ ...buttonStyle(false, busy), height: 25, padding: "0 7px", fontSize: 10 }}>更新</button><button type="button" disabled={busy} onClick={() => void runManagedAction(server, "uninstall")} style={{ ...buttonStyle(false, busy), height: 25, padding: "0 7px", fontSize: 10 }}>卸载</button></div></div>)}</div> : null}
        </div>
        <div style={{ padding: "8px 6px", borderTop: "1px solid var(--border)", flexShrink: 0 }}><button type="button" onClick={add} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", border: "none", borderRadius: 5, background: isNew ? "var(--bg-selected)" : "transparent", color: isNew ? "var(--accent)" : "var(--text-dim)", cursor: "pointer", fontSize: 12 }}><PlusIcon size={13} /> 添加 MCP Server</button></div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 20, background: "var(--chat-bg)" }}><div style={{ maxWidth: 660 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 14px" }}><h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{isNew ? "添加 MCP Server" : `编辑 ${selected}`}</h2>{!isNew && <button type="button" role="switch" aria-checked={!form.disabled} aria-label={form.disabled ? "启用 MCP Server" : "禁用 MCP Server"} disabled={busy} onClick={() => void toggleDisabled()} title={form.disabled ? "启用 MCP Server" : "禁用 MCP Server"} style={{ width: 42, height: 22, padding: 2, border: "none", borderRadius: 999, background: form.disabled ? "var(--border)" : "var(--accent)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.55 : 1, transition: "background var(--transition-ui)" }}><span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: form.disabled ? "translateX(0)" : "translateX(20px)", transition: "transform var(--transition-ui)", boxShadow: "0 1px 2px rgba(0,0,0,0.16)" }} /></button>} {!isNew && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{form.disabled ? "已禁用" : "已启用"}</span>}</div>
        <p style={{ margin: "0 0 16px", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{savedPath}</p>
        {!sessionId ? <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: 12 }}>选择或新建聊天会话后，才能查看真实连接状态和工具目录。</p> : null}
        {error && data ? <NotificationNotice message={error} type="error" /> : null}{notice ? <NotificationNotice message={notice} type="success" /> : null}
        <div className="mcp-config-form" style={{ display: "grid", gap: 14 }}>
          <Field label="名称" value={form.name} placeholder="例如 github" onChange={(value) => update("name", value)} />
          <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text-muted)" }}><span>传输方式</span><Combobox items={["Stdio（本地命令）", "HTTP"]} value={form.transport === "stdio" ? "Stdio（本地命令）" : "HTTP"} onValueChange={(value) => { if (value) setForm((current) => ({ ...blank(), name: current.name, transport: value === "HTTP" ? "http" : "stdio" })); }}><ComboboxInput aria-label="传输方式" placeholder="选择传输方式" /><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox></label>
          {form.transport === "stdio" ? <><Field label="命令" value={form.command} placeholder="npx" onChange={(value) => update("command", value)} /><label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text-muted)" }}><span>参数（每行一个）</span><textarea value={(form.args ?? []).join("\n")} onChange={(event) => update("args", event.target.value.split(/\r?\n/).filter(Boolean))} placeholder={"-y\n@modelcontextprotocol/server-github"} style={{ minHeight: 76, resize: "vertical", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", color: "var(--text)", padding: 9, fontFamily: "var(--font-mono)", fontSize: 12 }} /></label><Field label="工作目录（可选）" value={form.cwd} onChange={(value) => update("cwd", value)} /></> : <><Field label="HTTP URL" value={form.url} placeholder="https://example.com/mcp" onChange={(value) => update("url", value)} /><Field label="Bearer Token 环境变量（可选）" value={form.bearerTokenEnv} placeholder="GITHUB_TOKEN" onChange={(value) => update("bearerTokenEnv", value)} /></>}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", alignItems: "start", gap: 12 }}><label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text-muted)" }}><span>生命周期</span><Combobox items={["Lazy", "Eager", "Keep alive"]} value={form.lifecycle === "eager" ? "Eager" : form.lifecycle === "keep-alive" ? "Keep alive" : "Lazy"} onValueChange={(value) => { if (value) update("lifecycle", value === "Eager" ? "eager" : value === "Keep alive" ? "keep-alive" : "lazy"); }}><ComboboxInput aria-label="生命周期" placeholder="选择生命周期" /><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox><span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{lifecycleNote[form.lifecycle ?? "lazy"]}</span></label><Field label="空闲断开（分钟）" type="number" value={form.idleTimeout} onChange={(value) => update("idleTimeout", Number(value))} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingTop: 2 }}><SegmentedScope value={scope} onChange={(next) => { setScope(next); add(); }} /><button type="button" disabled={!sessionId || busy} onClick={() => void reload()} style={buttonStyle(false, !sessionId || busy)}>重载当前会话</button><button type="button" disabled={busy} onClick={() => void save()} style={buttonStyle(true, busy)}>保存配置</button></div>
        </div>
        {sessionId ? <p style={{ margin: "22px 0 0", paddingTop: 14, borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12 }}>当前会话：已缓存 {status?.totalTools ?? 0} 个工具 · {status ? `更新于 ${new Date(status.updatedAt).toLocaleTimeString()}` : "等待适配器状态"}</p> : null}
      </div></main>
    </div>
  </div>;
}
