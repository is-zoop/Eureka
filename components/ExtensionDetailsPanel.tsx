"use client";

import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { LabelTooltip } from "./LabelTooltip";

export function ExtensionDetailsPanel({ name, icon, badge, tabs, tab, onTabChange, onClose, children, footer, dialogs }: {
  name: string; icon: ReactNode; badge?: ReactNode;
  tabs: { value: string; label: string; icon?: ReactNode }[];
  tab: string; onTabChange: (value: string) => void; onClose: () => void;
  children: ReactNode; footer?: ReactNode; dialogs?: ReactNode;
}) {
  const { t } = useI18n();
  return <div className="flex h-full min-h-0 flex-col bg-[var(--sidebar-bg)] text-[var(--text)]">
    <header className="shrink-0 border-b border-[var(--border)] bg-[var(--sidebar-bg)] p-4">
      <div className="flex items-start gap-3">{icon}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><LabelTooltip content={name}><h2 className="truncate text-sm font-semibold">{name}</h2></LabelTooltip>{badge}</div></div>
        <LabelTooltip content={t("common.close")}><Button variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}><XIcon size={16} aria-hidden="true" /></Button></LabelTooltip>
      </div>
      <Tabs value={tab} onValueChange={onTabChange} className="mt-4"><TabsList className="grid h-8 w-full" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>{tabs.map(item => <TabsTrigger key={item.value} value={item.value} className="gap-1 text-xs">{item.icon}{item.label}</TabsTrigger>)}</TabsList></Tabs>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--sidebar-bg)] p-4">{children}</main>
    {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--sidebar-bg)] p-4">{footer}</footer>}
    {dialogs}
  </div>;
}

export function ExtensionDetailField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="mt-1 truncate text-xs font-semibold text-[var(--text)]">{value || "-"}</p></div>;
}
