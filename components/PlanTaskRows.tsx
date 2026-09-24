"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { EurekaPlanTodo } from "@/lib/plan-mode";

type TaskStatus = "completed" | "running" | "pending";

export function getTaskStatus(todo: EurekaPlanTodo, runningIndex: number | null): TaskStatus {
  if (todo.done) return "completed";
  return todo.index === runningIndex ? "running" : "pending";
}

function StatusIcon({ status, index }: { status: TaskStatus; index: number }) {
  if (status === "completed") return <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[#16a34a] text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg></span>;
  if (status === "running") return <span className="relative inline-grid size-[22px] shrink-0 place-items-center"><svg width="22" height="22" viewBox="0 0 24 24" className="absolute inset-0 motion-reduce:animate-none animate-[spin_1.1s_linear_infinite]" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="var(--border)" strokeWidth="2" /><circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="18 45" /></svg><span className="relative text-[10px] font-semibold tabular-nums text-[var(--text)]">{index}</span></span>;
  return <span className="grid size-[22px] shrink-0 place-items-center rounded-full border border-[var(--border)] text-[10px] font-medium tabular-nums text-[var(--text-muted)]">{index}</span>;
}

function Chevron({ open }: { open: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-200 motion-reduce:transition-none" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}

export function PlanTaskRows({ todos, isStreaming }: { todos: EurekaPlanTodo[]; isStreaming: boolean }) {
  const { t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const initializedRef = useRef(false);
  const completed = todos.filter((todo) => todo.done).length;
  const runningIndex = isStreaming ? todos.find((todo) => !todo.done)?.index ?? null : null;
  const previousCompletedRef = useRef(completed);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      previousCompletedRef.current = completed;
      return;
    }
    if (completed > previousCompletedRef.current && runningIndex !== null) {
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        const row = rowRefs.current.get(runningIndex);
        if (!container || !row) return;
        const rowTop = row.offsetTop;
        const rowBottom = rowTop + row.offsetHeight;
        if (rowTop >= container.scrollTop && rowBottom <= container.scrollTop + container.clientHeight) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        container.scrollTo({ top: Math.max(0, rowBottom - container.clientHeight), behavior: reducedMotion ? "auto" : "smooth" });
      });
    }
    previousCompletedRef.current = completed;
  }, [completed, runningIndex]);

  useEffect(() => {
    if (!todos.some((todo) => todo.index === openIndex)) setOpenIndex(null);
  }, [openIndex, todos]);

  return <section className="mb-2 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_10px_28px_rgba(15,23,42,0.08)]" aria-label={t("plan.taskList")}>
    <div className="flex h-9 items-center border-b border-[var(--border)] px-4"><span className="text-sm font-medium text-[var(--text)]">{t("plan.taskProgress", { completed, total: todos.length })}</span></div>
    <div ref={scrollRef} className="max-h-[138px] overflow-y-auto" aria-label={t("plan.taskList")}>
      {todos.map((todo) => {
        const status = getTaskStatus(todo, runningIndex);
        const open = openIndex === todo.index;
        const statusLabel = status === "completed" ? t("plan.taskCompleted") : status === "running" ? t("plan.taskRunning") : t("plan.taskPending");
        return <div key={todo.index} ref={(node) => { if (node) rowRefs.current.set(todo.index, node); else rowRefs.current.delete(todo.index); }} className="border-b border-[var(--border)] last:border-b-0">
          <button type="button" className="flex h-[46px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-[var(--bg-hover)]" aria-expanded={open} aria-label={t("plan.toggleTask", { task: todo.text, status: statusLabel })} onClick={() => setOpenIndex((current) => current === todo.index ? null : todo.index)}>
            <StatusIcon status={status} index={todo.index} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]">{todo.text}</span>
            {status === "completed" && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[#e8f8ef] px-2 text-[11px] font-medium text-[#15803d]">{statusLabel}</span>}
            <Chevron open={open} />
          </button>
          <div className="grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
            <div className="overflow-hidden"><div className="mx-4 mb-3 ml-[49px] border-l border-[var(--border)] pl-3"><p className="whitespace-pre-wrap text-sm font-medium leading-[1.7] text-[var(--text-muted)]">{todo.text}</p><p className="mt-1 text-[11px] font-medium" style={{ color: status === "completed" ? "#15803d" : status === "running" ? "var(--accent)" : "var(--text-muted)" }}>{statusLabel}</p></div></div>
          </div>
        </div>;
      })}
    </div>
  </section>;
}
