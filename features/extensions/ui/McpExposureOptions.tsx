"use client";

import { useId } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { McpToolExposure } from "@/lib/api-types";
import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";

export function McpExposureOptions({ value = "direct", onChange, disabled = false, allowHidden = false }: {
  value?: McpToolExposure;
  onChange: (value: McpToolExposure) => void;
  disabled?: boolean;
  allowHidden?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const options: McpToolExposure[] = ["direct", "deferred", "codemode", ...(allowHidden ? ["hidden" as const] : [])];
  return <div>
    <p className="text-sm font-medium text-[var(--text)]">{t("extensions.toolExposure")}</p>
    <RadioGroup aria-label={t("extensions.toolExposure")} value={value} disabled={disabled} onValueChange={mode => { if (options.includes(mode as McpToolExposure)) onChange(mode as McpToolExposure); }} className="mt-2 grid gap-1.5">
      {options.map(mode => <label key={mode} className={`flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${value === mode ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"}`}>
        <RadioGroupItem value={mode} aria-label={t(`extensions.exposure.${mode}`)} aria-describedby={`${id}-${mode}`} />
        <span className="shrink-0 text-sm font-medium text-[var(--text)]">{t(`extensions.exposure.${mode}`)}</span>
        <span id={`${id}-${mode}`} className="min-w-0 text-xs text-[var(--text-muted)]">{t(`extensions.exposure.${mode}Description`)}</span>
      </label>)}
    </RadioGroup>
  </div>;
}
