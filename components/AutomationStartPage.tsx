"use client";
import { useI18n } from "@/hooks/useI18n";

import { ArrowUpRightIcon, PackageOpenIcon, PlusIcon } from "lucide-react";
import type { AutomationAppIndex, AutomationAppSummary } from "@/lib/automation-app";
import { AutomationAppIcon } from "./AutomationAppIcon";
import { Button } from "./ui/button";
import { AutomationIcon } from "./AutomationIcon";
import styles from "./AutomationStartPage.module.css";

export function AutomationStartPage({ apps, index, loading, importDisabled, onCreate, onImport, onOpen }: {
  apps: readonly AutomationAppSummary[];
  index?: Pick<AutomationAppIndex, "ownerKey" | "runtimeId">;
  loading: boolean;
  importDisabled: boolean;
  onCreate: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  return <div className={`${styles.page}${apps.length ? "" : ` ${styles.pageEmpty}`}`} aria-busy={loading}>
    <div className={styles.content}>
      <section className={styles.hero} aria-label={t("automationUi.create")}>
        <span className={styles.heroIcon}><AutomationIcon size={24} /></span>
        <p className={styles.description}>{t("automationUi.intro")}</p>
        <div className={styles.actions}>
          <Button type="button" size="sm" className="h-9 gap-2 text-[13px]" onClick={onCreate}><PlusIcon size={15} aria-hidden="true" />{t("automationUi.create")}</Button>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-2 text-[13px]" disabled={importDisabled} onClick={onImport}><PackageOpenIcon size={15} aria-hidden="true" />{t("automationUi.import")}</Button>
        </div>
      </section>
      {apps.length > 0 && <section className={styles.frequent} aria-label={t("automationUi.frequent")}>
        <h2 className={styles.sectionTitle}>{t("automationUi.frequent")}</h2>
        <ul className={styles.list}>{apps.map(app => <li key={app.id}>
          <button type="button" className={styles.app} onClick={() => onOpen(app.id)}>
            <span className={styles.appIcon}><AutomationAppIcon app={app} identity={index} size={36} /></span>
            <span className={styles.appCopy}><span className={styles.appName}>{app.displayName}</span>{app.description?.trim() && <span className={styles.appDescription}>{app.description}</span>}</span>
            <span className={styles.openLabel}>{t("automationUi.open")}</span><ArrowUpRightIcon size={14} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </li>)}</ul>
      </section>}
    </div>
  </div>;
}
