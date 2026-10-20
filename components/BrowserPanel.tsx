"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, GlobeIcon as Globe, PlusIcon as Plus, RefreshCwIcon as RefreshCw, XIcon as X } from "lucide-react";
import type { BrowserAction, BrowserEvent, BrowserState } from "@/lib/browser-types";

export function BrowserPanel({ sessionId, onHide }: { sessionId: string; onHide: () => void }) {
  const [state, setState] = useState<BrowserState>({ sessionId, tabs: [], activeTabId: null });
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef<string | null>(null);
  const sequence = useRef(0);
  const composing = useRef(false);
  const lastCompositionEnd = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastResize = useRef("");
  const lastMove = useRef(0);
  const alive = useRef(true);
  active.current = state.activeTabId;

  const command = useCallback((action: BrowserAction | { action: "close" }) => {
    const task = queue.current.catch(() => {}).then(async () => {
      if (!alive.current) return;
      const response = await fetch("/api/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...action, sessionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "浏览器操作失败");
      if (alive.current && result.state) setState(result.state);
    });
    queue.current = task.catch((e) => { if (alive.current) setError(e instanceof Error ? e.message : "浏览器操作失败"); });
    return task;
  }, [sessionId]);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    fetch(`/api/browser?sessionId=${encodeURIComponent(sessionId)}`, { signal: abort.signal }).then(async (res) => {
      const data = await res.json(); if (!res.ok) throw new Error(data.error); setState(data.state); setReady(data.ready);
    }).catch((e) => { if (!abort.signal.aborted) setError(e.message); });
    const source = new EventSource(`/api/browser/events?sessionId=${encodeURIComponent(sessionId)}&frames=1`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as BrowserEvent;
      if (event.type === "state") { setState(event.state); if (event.state.error) setError(event.state.error); return; }
      if (event.tabId !== active.current) return;
      const next = ++sequence.current;
      const image = new Image();
      image.onload = () => {
        if (!alive.current || next !== sequence.current || !canvas.current) return;
        const target = canvas.current;
        target.width = image.naturalWidth; target.height = image.naturalHeight;
        target.getContext("2d")?.drawImage(image, 0, 0);
      };
      image.src = `data:image/jpeg;base64,${event.data}`;
    };
    source.onerror = () => { setError("浏览器画面连接中断，正在尝试重连；请确认当前登录状态。"); };
    source.onopen = () => setError("");
    return () => { alive.current = false; abort.abort(); source.close(); };
  }, [sessionId]);

  const currentTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  useEffect(() => { setAddress(currentTab?.url === "about:blank" ? "" : currentTab?.url ?? ""); }, [currentTab?.url, currentTab?.id]);
  useEffect(() => {
    canvas.current?.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
    lastResize.current = "";
  }, [state.activeTabId]);
  useEffect(() => {
    const target = viewport.current;
    if (!target || !state.activeTabId) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const width = Math.min(2560, Math.max(240, Math.floor(target.clientWidth)));
        const height = Math.min(1600, Math.max(180, Math.floor(target.clientHeight)));
        const signature = `${state.activeTabId}:${width}:${height}`;
        if (signature === lastResize.current) return;
        lastResize.current = signature;
        void command({ action: "resize", tabId: state.activeTabId!, width, height }).catch(() => {});
      }, 150);
    });
    observer.observe(target);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [command, state.activeTabId]);

  const mouse = (event: React.MouseEvent | React.WheelEvent, kind: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel") => {
    if (!active.current || !canvas.current) return;
    if (kind === "mouseMoved" && Date.now() - lastMove.current < 35) return;
    lastMove.current = Date.now();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.current.width, (event.clientX - bounds.left) * canvas.current.width / bounds.width));
    const y = Math.max(0, Math.min(canvas.current.height, (event.clientY - bounds.top) * canvas.current.height / bounds.height));
    const wheel = event as React.WheelEvent;
    void command({ action: "mouse", tabId: active.current, kind, x, y, button: event.button === 2 ? "right" : event.button === 1 ? "middle" : "left", buttons: event.buttons, clickCount: Math.max(1, Math.min(3, event.detail || 1)), ...(kind === "mouseWheel" ? { deltaX: wheel.deltaX, deltaY: wheel.deltaY } : {}) }).catch(() => {});
  };
  const keyboard = (event: React.KeyboardEvent, kind: "keyDown" | "keyUp") => {
    if (event.key === "Enter" && Date.now() - lastCompositionEnd.current < 100) return;
    if (composing.current || event.nativeEvent.isComposing || !active.current || event.key === "Process" || event.key === "Unidentified") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    void command({ action: "key", tabId: active.current, kind, key: event.key, code: event.code, modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0) }).catch(() => {});
  };

  return <section className="browser-panel" aria-label="内置浏览器">
    <header className="browser-toolbar"><Globe size={16} /><strong>浏览器</strong>{currentTab?.loading && <span role="status">加载中…</span>}<span style={{ flex: 1 }} /><button title="关闭浏览器并清理网页登录状态" onClick={() => { void command({ action: "close" }).then(onHide).catch(() => {}); }}><X size={16} /></button><button onClick={onHide}>隐藏</button></header>
    <div className="browser-tabs">{state.tabs.map((tab) => <div key={tab.id} className={tab.id === state.activeTabId ? "browser-tab active" : "browser-tab"}><button title={tab.url} onClick={() => { void command({ action: "select-tab", tabId: tab.id }).catch(() => {}); }}>{tab.title}</button><button title="关闭标签页" onClick={() => { void command({ action: "close-tab", tabId: tab.id }).catch(() => {}); }}>×</button></div>)}<button title="新建标签页" onClick={() => { void command({ action: "new-tab" }).catch(() => {}); }}><Plus size={15} /></button></div>
    <form className="browser-toolbar" onSubmit={(event) => { event.preventDefault(); setError(""); const url = /^https?:\/\//i.test(address) ? address : `https://${address}`; void command(state.activeTabId ? { action: "navigate", tabId: state.activeTabId, url } : { action: "open", url }).catch(() => {}); }}>
      <button type="button" disabled={!state.activeTabId} title="后退" onClick={() => { void command({ action: "back", tabId: state.activeTabId! }).catch(() => {}); }}><ArrowLeft size={15} /></button>
      <button type="button" disabled={!state.activeTabId} title="前进" onClick={() => { void command({ action: "forward", tabId: state.activeTabId! }).catch(() => {}); }}><ArrowRight size={15} /></button>
      <button type="button" disabled={!state.activeTabId} title="刷新" onClick={() => { void command({ action: "reload", tabId: state.activeTabId! }).catch(() => {}); }}><RefreshCw size={15} /></button>
      <input aria-label="网页地址" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="输入网页地址" /><button type="submit" disabled={!address.trim()}>打开</button>
    </form>
    {ready === false && <div className="browser-notice">未安装浏览器运行时。请在 Eureka 服务端运行 <code>npm run browser:install</code>，然后重试。</div>}
    {error && <div className="browser-notice" role="status">{error}<button onClick={() => setError("")}>×</button></div>}
    <div ref={viewport} className="browser-viewport">
      {!state.activeTabId ? <div className="browser-empty">输入地址打开网页，或让插件打开选数页面。<br />网页登录状态仅在当前浏览器会话期间保留。</div> : <>
        <canvas ref={canvas} className="browser-canvas" />
        <textarea ref={input} className="browser-input" aria-label="网页交互区域，支持点击、滚动和输入" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          onMouseDown={(e) => { input.current?.focus(); mouse(e, "mousePressed"); }} onMouseUp={(e) => mouse(e, "mouseReleased")} onMouseMove={(e) => mouse(e, "mouseMoved")} onWheel={(e) => mouse(e, "mouseWheel")} onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => keyboard(e, "keyDown")} onKeyUp={(e) => keyboard(e, "keyUp")}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(e) => { composing.current = false; lastCompositionEnd.current = Date.now(); if (active.current && e.data) void command({ action: "text", tabId: active.current, text: e.data }).catch(() => {}); e.currentTarget.value = ""; }}
          onPaste={(e) => { e.preventDefault(); if (active.current) void command({ action: "text", tabId: active.current, text: e.clipboardData.getData("text/plain") }).catch(() => {}); }}
          onInput={(e) => { if (!composing.current) e.currentTarget.value = ""; }} />
      </>}
    </div>
  </section>;
}
