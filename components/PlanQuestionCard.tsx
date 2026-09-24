"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { EurekaPlanQuestion, EurekaPlanQuestionResponse } from "@/lib/plan-mode";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";

type QuestionDraft = { optionIds: string[]; customAnswer: string; skipped: boolean };

interface Props {
  questions: EurekaPlanQuestion[];
  onAnswer?: (questions: EurekaPlanQuestion[], answers: EurekaPlanQuestionResponse[]) => Promise<boolean>;
  readOnly?: boolean;
}

const AUTO_ADVANCE_MS = 440;
const SLIDE = "360ms cubic-bezier(0.22, 1, 0.36, 1)";

function Icon({ children }: { children: React.ReactNode }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>;
}

function RollingCounter({ value }: { value: string }) {
  const [previous, setPrevious] = useState(value);
  const [rolling, setRolling] = useState(false);
  useEffect(() => {
    if (value === previous) return;
    setRolling(true);
    const timer = window.setTimeout(() => { setPrevious(value); setRolling(false); }, 320);
    return () => window.clearTimeout(timer);
  }, [previous, value]);
  return (
    <span className="relative inline-grid h-[1em] overflow-hidden tabular-nums" aria-label={value}>
      <span className="col-start-1 row-start-1">{previous}</span>
      <span className="col-start-1 row-start-1 transition-transform duration-300 ease-out" style={{ transform: rolling ? "translateY(0)" : "translateY(110%)" }}>{value}</span>
    </span>
  );
}

function emptyDraft(): QuestionDraft {
  return { optionIds: [], customAnswer: "", skipped: false };
}

function isAnswered(draft: QuestionDraft): boolean {
  return draft.skipped || draft.optionIds.length > 0 || Boolean(draft.customAnswer.trim());
}

function responseFor(question: EurekaPlanQuestion, draft: QuestionDraft): EurekaPlanQuestionResponse {
  if (draft.skipped) return { questionId: question.id, skipped: true };
  if (draft.customAnswer.trim()) return { questionId: question.id, customAnswer: draft.customAnswer.trim() };
  return { questionId: question.id, optionIds: draft.optionIds };
}

function answerLabel(question: EurekaPlanQuestion, skippedLabel: string): string {
  if (!question.answer) return "";
  return question.answer.skipped ? skippedLabel : question.answer.text;
}

export function PlanQuestionCard({ questions, onAnswer, readOnly = false }: Props) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>();
  const [trackOffset, setTrackOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const measuredRef = useRef(false);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupKey = questions.map((question) => question.id).join(":");
  const answered = readOnly || questions.every((question) => question.status === "answered");
  const activeQuestion = questions[activeIndex];
  const activeDraft = activeQuestion ? drafts[activeQuestion.id] ?? emptyDraft() : emptyDraft();
  const last = activeIndex === questions.length - 1;

  useEffect(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setActiveIndex(0); setDrafts({}); setSubmitting(false); setReady(false); measuredRef.current = false;
  }, [groupKey]);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);
  useLayoutEffect(() => {
    const item = questionRefs.current[activeIndex];
    if (!item || answered) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setViewportHeight(item.offsetHeight); setTrackOffset(item.offsetTop); setAnimate(measuredRef.current && !reducedMotion);
    measuredRef.current = true; setReady(true);
  }, [activeIndex, activeDraft.customAnswer, activeDraft.optionIds.join(":"), activeDraft.skipped, answered, groupKey]);

  if (questions.length === 0) return null;
  if (answered) {
    return (
      <section aria-label={t("plan.question")} className="my-3 w-full max-w-none rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 shadow-sm">
        <div className="text-xs font-semibold text-[var(--text-muted)]">{t("plan.question")}</div>
        <div className="mt-3 space-y-3">
          {questions.map((question, index) => <div key={question.id} className={index > 0 ? "border-t border-[var(--border)] pt-3" : ""}>
            <div className="text-sm font-medium text-[var(--text)]">{question.question}</div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">{answerLabel(question, t("plan.questionSkipped"))}</div>
          </div>)}
        </div>
      </section>
    );
  }

  const updateDraft = (questionId: string, next: QuestionDraft) => setDrafts((current) => ({ ...current, [questionId]: next }));
  const submitGroup = async (nextDrafts: Record<string, QuestionDraft>) => {
    if (!onAnswer || submitting) return;
    setSubmitting(true);
    const accepted = await onAnswer(questions, questions.map((question) => responseFor(question, nextDrafts[question.id] ?? emptyDraft())));
    if (!accepted) setSubmitting(false);
  };
  const advance = (override?: QuestionDraft) => {
    if (!activeQuestion) return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const nextDraft = override ?? activeDraft;
    if (!isAnswered(nextDraft)) return;
    const nextDrafts = { ...drafts, [activeQuestion.id]: nextDraft };
    updateDraft(activeQuestion.id, nextDraft);
    if (last) { void submitGroup(nextDrafts); return; }
    setActiveIndex((index) => Math.min(index + 1, questions.length - 1));
  };
  const selectOption = (optionId: string) => {
    if (!activeQuestion || submitting) return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const single = activeQuestion.selection !== "multiple";
    const optionIds = single ? [optionId] : activeDraft.optionIds.includes(optionId) ? activeDraft.optionIds.filter((id) => id !== optionId) : [...activeDraft.optionIds, optionId];
    const next = { optionIds, customAnswer: "", skipped: false };
    updateDraft(activeQuestion.id, next);
    if (single && optionIds.length === 1) advanceTimer.current = setTimeout(() => advance(next), AUTO_ADVANCE_MS);
  };
  const skip = () => { if (!submitting) advance({ optionIds: [], customAnswer: "", skipped: true }); };

  return (
    <section aria-label={`${t("plan.question")}: ${activeQuestion?.title ?? ""}`} className="my-3 w-full max-w-none overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_12px_32px_rgba(30,30,25,0.09)]">
      <div className="p-3.5 sm:p-4">
        <div className="overflow-hidden" style={{ height: viewportHeight, transition: animate ? `height ${SLIDE}` : undefined }} aria-live="polite">
          <div style={{ display: "flex", flexDirection: "column", gap: 24, transform: `translate3d(0, ${-trackOffset}px, 0)`, transition: animate ? `transform ${SLIDE}` : undefined, willChange: "transform" }}>
            {questions.map((question, questionIndex) => {
              const active = questionIndex === activeIndex;
              if (!ready && !active) return null;
              const draft = drafts[question.id] ?? emptyDraft();
              const questionStyle: CSSProperties = { opacity: active ? 1 : 0, transition: animate ? `opacity ${SLIDE}` : undefined, pointerEvents: active ? undefined : "none" };
              return <div key={question.id} ref={(element) => { questionRefs.current[questionIndex] = element; }} aria-hidden={active ? undefined : true} style={questionStyle}>
                <div className="text-[14px] font-semibold leading-5 text-[var(--text)]">{question.title}</div>
                <p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">{question.question}</p>
                <div className="mt-2.5 space-y-1">
                  {question.options.map((option) => {
                    const selected = draft.optionIds.includes(option.id); const multi = question.selection === "multiple";
                    return <button key={option.id} type="button" aria-pressed={selected} tabIndex={active ? 0 : -1} disabled={submitting} onClick={() => selectOption(option.id)} className="flex w-full items-start gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-default">
                      <span
                        data-selected={selected ? "true" : "false"}
                        className={`plan-question-choice-control mt-0.5 flex size-4 shrink-0 items-center justify-center border-2 transition-colors ${multi ? "rounded-[4px]" : "rounded-full"} ${selected ? "border-[var(--text)] bg-[var(--text)] text-[var(--bg-panel)]" : "border-[var(--border)] text-transparent"}`}
                        style={isDark && !selected ? { borderColor: "#c8c8c8" } : undefined}
                      >
                        {multi ? <Icon><path d="m5 12 4 4L19 6" /></Icon> : <span className={`size-1.5 rounded-full bg-[var(--bg-panel)] transition-transform ${selected ? "scale-100" : "scale-0"}`} />}
                      </span>
                      <span className="min-w-0"><span className="block text-[13px] font-medium leading-5 text-[var(--text-dim)]">{option.label}</span><span className="block text-[11.5px] leading-4 text-[var(--text-muted)]">{option.description}</span></span>
                    </button>;
                  })}
                  <input value={draft.customAnswer} tabIndex={active ? 0 : -1} disabled={submitting} onChange={(event) => updateDraft(question.id, { optionIds: [], customAnswer: event.target.value, skipped: false })} onKeyDown={(event) => {
                    if (event.key === "Enter" && isAnswered({ ...draft, customAnswer: event.currentTarget.value })) { event.preventDefault(); advance({ optionIds: [], customAnswer: event.currentTarget.value, skipped: false }); }
                  }} placeholder={t("plan.answerPlaceholder")} aria-label={t("plan.customAnswer")} className="mt-1 w-full rounded-lg bg-[var(--bg-hover)] px-2.5 py-2 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:ring-1 focus:ring-[var(--text-dim)] disabled:cursor-default" />
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-3.5 py-2.5 sm:px-4">
        <div className="flex items-center gap-1 text-[12px] font-medium text-[var(--text-muted)]">
          <button type="button" aria-label={t("plan.previousQuestion")} disabled={activeIndex === 0 || submitting} onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))} className="flex size-5 items-center justify-center rounded-md transition-colors enabled:hover:bg-[var(--bg-hover)] disabled:opacity-30"><Icon><path d="m18 15-6-6-6 6" /></Icon></button>
          <RollingCounter value={`${activeIndex + 1}/${questions.length}`} />
          <button type="button" aria-label={t("plan.nextQuestion")} disabled={last || submitting} onClick={() => setActiveIndex((index) => Math.min(index + 1, questions.length - 1))} className="flex size-5 items-center justify-center rounded-md transition-colors enabled:hover:bg-[var(--bg-hover)] disabled:opacity-30"><Icon><path d="m6 9 6 6 6-6" /></Icon></button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={submitting} onClick={skip} className="rounded-full bg-[var(--bg-hover)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50">{t("plan.skipQuestion")}</button>
          <button type="button" disabled={!isAnswered(activeDraft) || submitting} onClick={() => advance()} className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-45">{last ? t("plan.submitAnswers") : t("plan.continueQuestion")}</button>
        </div>
      </div>
    </section>
  );
}
