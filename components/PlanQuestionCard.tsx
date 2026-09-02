"use client";

import { useState } from "react";
import type { EurekaPlanQuestion } from "@/lib/plan-mode";

interface Props {
  question: EurekaPlanQuestion;
  onAnswer: (question: EurekaPlanQuestion, answer: { optionId?: string; customAnswer?: string }) => void;
  fullWidth?: boolean;
}

export function PlanQuestionCard({ question, onAnswer, fullWidth = false }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const answered = question.status === "answered";

  const submit = (answer: { optionId?: string; customAnswer?: string }) => {
    if (answered || submitting) return;
    setSubmitting(true);
    onAnswer(question, answer);
  };

  return (
    <section
      aria-label={`规划澄清：${question.title}`}
      className={`my-3 w-full ${fullWidth ? "" : "max-w-[640px]"} rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 shadow-sm`}
    >
      <div className="mb-1 text-xs font-semibold text-[var(--text-muted)]">规划澄清</div>
      <h3 className="text-sm font-semibold text-[var(--text)]">{question.title}</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{question.question}</p>

      <div className="mt-3 grid gap-2">
        {question.options.map((option) => {
          const selected = answered && question.answer?.optionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={answered || submitting}
              onClick={() => submit({ optionId: option.id })}
              className="rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default"
              style={{
                borderColor: selected ? "var(--text-dim)" : "var(--border)",
                background: selected ? "var(--bg-hover)" : "transparent",
                color: "var(--text)",
                cursor: answered || submitting ? "default" : "pointer",
              }}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{option.description}</span>
            </button>
          );
        })}
      </div>

      {answered && question.answer?.custom && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text)]">
          自定义回答：{question.answer.text}
        </div>
      )}

      {!answered && (
        <div className="mt-3">
          {!customOpen ? (
            <button type="button" onClick={() => setCustomOpen(true)} disabled={submitting} className="text-xs font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline">
              自定义回答
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                value={customAnswer}
                onChange={(event) => setCustomAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && customAnswer.trim()) submit({ customAnswer: customAnswer.trim() });
                  if (event.key === "Escape") setCustomOpen(false);
                }}
                placeholder="输入你的回答…"
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--text-dim)]"
              />
              <button type="button" disabled={!customAnswer.trim() || submitting} onClick={() => submit({ customAnswer: customAnswer.trim() })} className="rounded-md bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-45">
                提交
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
