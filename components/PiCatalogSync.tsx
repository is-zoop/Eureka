"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface CatalogStatus {
  enabled: boolean;
  lastSuccessAt?: number;
  error?: boolean;
  offline: boolean;
}

export function PiCatalogSync() {
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
