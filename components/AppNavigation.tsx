"use client";

import { type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { LabelTooltip } from "./LabelTooltip";
import { NavigationAutomationIcon } from "./NavigationAutomationIcon";
import { NavigationHomeIcon } from "./NavigationHomeIcon";
import { NavigationExtensionsIcon } from "./NavigationExtensionsIcon";
import styles from "./AppNavigation.module.css";

export type AppView = "chat" | "extensions" | "automation";

export function AppNavigation({ view, onNavigate, extensionsEnabled, mobile = false, children }: {
  view: AppView;
  onNavigate: (view: AppView) => void;
  extensionsEnabled: boolean;
  mobile?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const items = [
    { id: "chat" as const, label: t("sidebar.home"), disabled: false },
    { id: "extensions" as const, label: t("sidebar.extensionsCenter"), disabled: !extensionsEnabled },
    { id: "automation" as const, label: t("automation.navigation"), disabled: false },
  ];
  return (
    <nav className={mobile ? styles.drawer : styles.rail} aria-label={t("sidebar.navigation")} data-app-navigation>
      <div className={styles.items}>
        {items.map(({ id, label, disabled }) => (
          <LabelTooltip key={id} content={disabled ? t("workspace.selectProject") : label} side={mobile ? "bottom" : "right"}>
            <button
              type="button"
              className={styles.item}
              aria-label={label}
              aria-current={view === id ? "page" : undefined}
              aria-disabled={disabled || undefined}
              onClick={() => { if (!disabled) onNavigate(id); }}
            >
              {id === "chat" ? <NavigationHomeIcon selected={view === "chat"} className={styles.icon} /> : id === "extensions" ? <NavigationExtensionsIcon selected={view === "extensions"} className={styles.icon} /> : <NavigationAutomationIcon selected={view === "automation"} className={styles.icon} />}
              {mobile && <span>{label}</span>}
            </button>
          </LabelTooltip>
        ))}
      </div>
      {children}
    </nav>
  );
}
