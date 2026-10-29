"use client";

import { useCallback, useEffect, useState } from "react";
import { InfoIcon, RefreshCwIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { LabelTooltip } from "./LabelTooltip";
import styles from "./ModelsSettings.module.css";
import { SettingsCard } from "./SettingsLayout";

interface CatalogStatus {
  enabled: boolean;
  lastSuccessAt?: number;
  error?: boolean;
  offline: boolean;
}

export function PiCatalogSync({ settings = false }: { settings?: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/models-config/pi-catalog");
    if (!response.ok) throw new Error("Catalog status unavailable");
    setStatus(await response.json() as CatalogStatus);
  }, []);
  useEffect(() => { void load().catch(() => setFailed(true)); }, [load]);

  const update = async (body: Record<string, boolean>) => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/models-config/pi-catalog", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Catalog update failed");
      setStatus(await response.json() as CatalogStatus);
      window.dispatchEvent(new Event("eureka-models-updated"));
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };

  if (settings) return (
    <SettingsCard aria-busy={busy || !status && !failed}>
      <div className={styles.catalogRow}>
        <div>
          <div className={styles.catalogTitle}>{t("models.catalogAutoUpdate")}
            <LabelTooltip content={t("models.piCatalogDescription")} contentClassName="w-[420px] max-w-[calc(100vw-32px)] break-normal leading-5"><button type="button" className={styles.catalogInfo} aria-label={t("models.catalogInfo")}>
              <InfoIcon size={14} strokeWidth={1.6} aria-hidden="true" />
            </button></LabelTooltip>
          </div>
          <p>{t(status?.offline ? "models.piCatalogOffline" : "models.catalogDescription")}</p>
        </div>
        <button type="button" className={styles.catalogSwitch} role="switch" aria-checked={status?.enabled ?? false}
          aria-label={t("models.catalogAutoUpdate")} disabled={busy || !status || status.offline}
          onClick={() => { void update({ enabled: !status?.enabled }); }}><span /></button>
      </div>
      <div className={styles.catalogFooter}>
        <span>{status?.lastSuccessAt ? t("models.piCatalogLast", { time: new Date(status.lastSuccessAt).toLocaleString() }) : t(!status && !failed ? "common.loading" : "models.catalogNotUpdated")}</span>
        <button type="button" disabled={busy || !status?.enabled || status.offline} onClick={() => { void update({ refresh: true }); }}>
          <RefreshCwIcon size={14} strokeWidth={1.6} aria-hidden="true" />
          {t(busy ? "models.piCatalogBusy" : "models.catalogUpdateNow")}
        </button>
      </div>
      {(failed || status?.error) && <div className={styles.catalogError} role="alert">{t("models.piCatalogError")}</div>}
    </SettingsCard>
  );

  return (
    <section style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 7, fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", cursor: busy ? "not-allowed" : "pointer" }}>
          <input type="checkbox" checked={status?.enabled ?? false} disabled={busy || !status || status.offline}
            onChange={(event) => { void update({ enabled: event.target.checked }); }} />
          {t("models.piCatalogTitle")}
        </label>
        <button type="button" disabled={busy || !status?.enabled || status.offline}
          onClick={() => { void update({ refresh: true }); }}
          style={{ border: "1px solid var(--border)", borderRadius: 5, padding: "4px 10px", background: "var(--bg-panel)", color: "var(--text)", cursor: busy || !status?.enabled || status?.offline ? "not-allowed" : "pointer" }}>
          {t(busy ? "models.piCatalogBusy" : "models.piCatalogRefresh")}
        </button>
        {status?.lastSuccessAt && <span>{t("models.piCatalogLast", { time: new Date(status.lastSuccessAt).toLocaleString() })}</span>}
      </div>
      <span>{status?.offline ? t("models.piCatalogOffline") : t("models.piCatalogDescription")}</span>
      {(failed || status?.error) && <span role="alert" style={{ color: "#ef4444" }}>{t("models.piCatalogError")}</span>}
    </section>
  );
}
