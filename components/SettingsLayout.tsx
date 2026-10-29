"use client";

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

// All settings pages share these dimensions. Keep page-specific layout inside
// the content area; change settings typography and geometry here, not per page.
const settingsTokens = {
  "--radius-card": "9px",
  "--radius-control": "6px",
} as CSSProperties;

export function SettingsLayout({ title, description, actions, children }: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <div data-slot="settings-layout" className="@container/settings h-full min-h-0 w-full overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] bg-[var(--chat-bg)] text-[var(--text)]" style={settingsTokens}>
    <div data-slot="settings-content" className="mx-auto w-full max-w-[896px] px-[32px] py-[48px] @max-[640px]/settings:px-[20px] @max-[640px]/settings:py-[32px]">
      <header className="mb-[36px] flex items-center justify-between gap-[20px] @max-[460px]/settings:flex-wrap">
        <div className="min-w-0">
          <h1 className="m-0 text-[24px] font-semibold leading-[30px] tracking-[-0.02em]">{title}</h1>
          <p className="mb-0 mt-[8px] text-[13px] leading-[20px] text-[var(--text-muted)]">{description}</p>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 @max-[460px]/settings:ml-auto">{actions}</div>}
      </header>
      <div className="flex flex-col gap-[28px]">{children}</div>
    </div>
  </div>;
}

export function SettingsSection({ title, description, meta, titleId, descriptionId, children }: {
  title: string;
  description?: string;
  meta?: ReactNode;
  titleId?: string;
  descriptionId?: string;
  children: ReactNode;
}) {
  return <section aria-labelledby={titleId}>
    <header className="mb-[12px]">
      <div className="flex flex-wrap items-baseline gap-[8px]">
        <h2 id={titleId} className="m-0 text-[14px] font-semibold leading-[20px]">{title}</h2>
        {meta != null && <span className="text-[11px] leading-[20px] text-[var(--text-dim)]">{meta}</span>}
      </div>
      {description && <p id={descriptionId} className="mb-0 mt-[8px] text-[12px] leading-[18px] text-[var(--text-muted)]">{description}</p>}
    </header>
    {children}
  </section>;
}

export function SettingsCard({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div data-slot="settings-card" className={cn("overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-panel)]", className)} {...props} />;
}

export function SettingsRow({ label, description, htmlFor, descriptionId, children }: {
  label: string;
  description: string;
  htmlFor?: string;
  descriptionId?: string;
  children: ReactNode;
}) {
  const labelClassName = "block text-[13px] font-medium leading-[20px]";
  return <div className="flex flex-wrap items-center justify-between gap-x-[20px] gap-y-[10px] py-[14px]">
    <div className="min-w-0 flex-[1_1_220px]">
      {htmlFor ? <label className={labelClassName} htmlFor={htmlFor}>{label}</label> : <span className={labelClassName}>{label}</span>}
      <p id={descriptionId} className="mb-0 mt-[4px] text-[11px] leading-[18px] text-[var(--text-muted)]">{description}</p>
    </div>
    <div className="flex shrink-0 items-center">{children}</div>
  </div>;
}
