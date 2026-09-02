"use client";

import { useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "./ui/button";
import type { EurekaPlanAnnotation, EurekaPlanState } from "@/lib/plan-mode";

type Props = {
  plan: EurekaPlanState;
  onClose: () => void;
  onUpdate: (annotations: EurekaPlanAnnotation[], generalNote: string) => Promise<unknown> | unknown;
  onReturnForRevision: () => Promise<unknown> | unknown;
  onApprove: () => Promise<unknown> | unknown;
  readOnly?: boolean;
};

function planBlocks(content: string): string[] {
  const paragraphs = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const blocks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (/^#{1,6}\s+/.test(paragraph)) {
      if (current) blocks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

export function PlanReviewPanel({ plan, onClose, onUpdate, onReturnForRevision, onApprove, readOnly = false }: Props) {
  const blocks = useMemo(() => planBlocks(plan.content), [plan.content]);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [generalNote, setGeneralNote] = useState(plan.generalNote);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingAnnotationNote, setEditingAnnotationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reviewing = plan.phase === "reviewing" && !readOnly;
  const completed = plan.todos.filter((todo) => todo.done).length;

  useEffect(() => {
    setGeneralNote(plan.generalNote);
  }, [plan.generalNote]);

  const persist = async (annotations = plan.annotations, nextGeneralNote = generalNote) => {
    await onUpdate(annotations, nextGeneralNote);
  };

  const addAnnotation = async () => {
    if (selectedBlock === null || !note.trim()) return;
    const annotation: EurekaPlanAnnotation = {
      id: crypto.randomUUID(), blockIndex: selectedBlock, quote: blocks[selectedBlock] ?? "", note: note.trim(), createdAt: new Date().toISOString(),
    };
    const annotations = [...plan.annotations, annotation];
    setNote("");
    await persist(annotations);
  };

  const removeAnnotation = async (id: string) => {
    await persist(plan.annotations.filter((annotation) => annotation.id !== id));
  };

  const saveAnnotationEdit = async () => {
    if (!editingAnnotationId || !editingAnnotationNote.trim()) return;
    await persist(plan.annotations.map((annotation) => annotation.id === editingAnnotationId
      ? { ...annotation, note: editingAnnotationNote.trim() }
      : annotation));
    setEditingAnnotationId(null);
    setEditingAnnotationNote("");
  };

  const withBusy = async (action: () => Promise<unknown> | unknown) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--sidebar-bg)] text-[var(--text)]">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border)] px-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{reviewing ? "计划评审" : plan.phase === "executing" ? "执行计划" : "查看计划"}</p><p className="text-[11px] text-[var(--text-muted)]">修订 {plan.revision || 1} · {reviewing ? "等待批准" : plan.phase === "executing" ? "正在执行" : "历史计划"}</p></div>
        <button type="button" onClick={onClose} aria-label="关闭计划评审" className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">×</button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {plan.content ? <div className="space-y-2">{blocks.map((block, index) => {
          const annotations = plan.annotations.filter((annotation) => annotation.blockIndex === index);
          const selected = selectedBlock === index;
          return <section key={`${index}-${block.slice(0, 24)}`} className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]">
            <button type="button" disabled={!reviewing} onClick={() => { setSelectedBlock(index); setNote(""); }} className="block w-full px-3 py-2 text-left disabled:cursor-default" style={{ background: selected ? "var(--bg-hover)" : "transparent" }}>
              <MarkdownBody className="text-sm leading-6">{block}</MarkdownBody>
            </button>
            {annotations.length > 0 && <div className="border-t border-[var(--border)] px-3 py-2">{annotations.map((annotation) => <div key={annotation.id} className="mb-2 rounded-md bg-[var(--bg-hover)] px-2 py-1.5 text-xs text-[var(--text-muted)]">{reviewing && editingAnnotationId === annotation.id ? <><textarea autoFocus value={editingAnnotationNote} onChange={(event) => setEditingAnnotationNote(event.target.value)} className="min-h-16 w-full resize-y rounded border border-[var(--border)] bg-[var(--bg)] p-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--text-muted)]" /><div className="mt-1.5 flex justify-end gap-2"><button type="button" onClick={() => { setEditingAnnotationId(null); setEditingAnnotationNote(""); }} className="text-[var(--text-dim)] hover:text-[var(--text)]">取消</button><button type="button" disabled={!editingAnnotationNote.trim() || busy} onClick={() => void withBusy(saveAnnotationEdit)} className="font-medium text-[var(--text)] disabled:opacity-40">保存</button></div></> : <div className="flex gap-2"><span className="min-w-0 flex-1 whitespace-pre-wrap">{annotation.note}</span>{reviewing && <span className="flex shrink-0 gap-2"><button type="button" onClick={() => { setEditingAnnotationId(annotation.id); setEditingAnnotationNote(annotation.note); }} className="text-[var(--text-dim)] hover:text-[var(--text)]">编辑</button><button type="button" onClick={() => void withBusy(() => removeAnnotation(annotation.id))} className="text-[var(--text-dim)] hover:text-[var(--text)]">删除</button></span>}</div>}</div>)}</div>}
            {reviewing && selected && <div className="border-t border-[var(--border)] p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium">为选中段落添加批注</div><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明需要调整的内容…" className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm outline-none focus:border-[var(--text-muted)]" /><div className="mt-2 flex justify-end"><Button size="sm" variant="outline" disabled={!note.trim() || busy} onClick={() => void withBusy(addAnnotation)}>添加批注</Button></div></div>}
          </section>;
        })}</div> : <p className="py-10 text-center text-sm text-[var(--text-muted)]">尚未提交计划。</p>}

        <section className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3"><label className="mb-2 block text-xs font-medium">总体说明</label><textarea value={generalNote} disabled={!reviewing} onChange={(event) => setGeneralNote(event.target.value)} onBlur={() => { if (reviewing) void persist(); }} placeholder={reviewing ? "可选：填写给 Agent 的整体反馈…" : "无"} className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm outline-none disabled:opacity-70 focus:border-[var(--text-muted)]" /></section>

        {plan.todos.length > 0 && <section className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3"><div className="mb-2 text-xs font-medium">执行进度 {completed}/{plan.todos.length}</div><div className="space-y-1.5">{plan.todos.map((todo) => <div key={todo.index} className="flex items-start gap-2 text-xs text-[var(--text-muted)]"><span className={todo.done ? "text-emerald-500" : "text-[var(--text-dim)]"}>{todo.done ? "✓" : "○"}</span><span className={todo.done ? "line-through opacity-70" : ""}>{todo.text}</span></div>)}</div></section>}
      </main>

      {reviewing && <footer className="flex shrink-0 gap-2 border-t border-[var(--border)] bg-[var(--sidebar-bg)] p-3"><Button variant="outline" className="flex-1" disabled={busy} onClick={() => void withBusy(async () => { await persist(); await onReturnForRevision(); })}>退回修改</Button><Button className="flex-1" disabled={busy} onClick={() => void withBusy(async () => { await persist(); await onApprove(); })}>批准并执行</Button></footer>}
    </div>
  );
}
