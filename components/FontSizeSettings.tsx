"use client";

import { useFontSize } from "@/hooks/useFontSize";
import { useI18n } from "@/hooks/useI18n";
import { FONT_SIZE_OPTIONS, isFontSize } from "@/lib/font-size-preference";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { RadioGroup } from "./ui/radio-group";

const previewSizes = { small: 13, medium: 14, large: 16 };

export function FontSizeSettings() {
  const { fontSize, setFontSize } = useFontSize();
  const { t } = useI18n();

  return (
    <section>
      <h2 id="font-size-label" className="mb-3 text-base font-semibold">{t("settings.fontSize")}</h2>
      <div>
        <p id="font-size-description" className="mb-3 text-xs text-[var(--text-muted)]">{t("settings.fontSizeDescription")}</p>
        <RadioGroup value={fontSize} onValueChange={(value) => { if (isFontSize(value)) setFontSize(value); }} aria-labelledby="font-size-label" aria-describedby="font-size-description" className="grid grid-cols-1 gap-2 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)] p-2 sm:grid-cols-3">
          {FONT_SIZE_OPTIONS.map((size) => (
            <RadioGroupPrimitive.Item key={size} id={`font-size-${size}`} value={size} className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] px-2 py-3 text-sm outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]" style={{ border: "none", background: fontSize === size ? "var(--bg-selected)" : undefined }}>
              <span>{t(`settings.fontSize.${size}`)}</span>
              <span className="text-xs text-[var(--text-muted)]">{previewSizes[size]}px</span>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroup>
        <div className="mt-4 rounded-[var(--radius-control)] bg-[var(--bg)] px-4 py-3" aria-label={t("settings.fontSizePreviewLabel")}>
          <div className="markdown-body">
            <h3>{t("settings.fontSizePreviewTitle")}</h3>
            <p>{t("settings.fontSizePreviewText")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
