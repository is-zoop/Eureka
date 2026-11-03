"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { LabelTooltip } from "./LabelTooltip";
import styles from "./AutomationApplication.module.css";

const MIN_CANVAS_WIDTH = 320;
const MIN_RESULTS_WIDTH = 280;
const DIVIDER_WIDTH = 12;
const STACKED_MAX_WIDTH = 720;
const MAX_RESULTS_WIDTH = 10000;

export function AutomationRunSplit({ ownerKey, preferenceScope="application", children }: { ownerKey: string; preferenceScope?:"application"|"preview"; children: [ReactNode, ReactNode] }) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null), widthRef = useRef(360);
  const syncRefs = useMemo(() => [container], []);
  const availableWidth = useCallback(() => container.current?.getBoundingClientRect().width ?? 1024, []);
  const getDefaultWidth = useCallback(() => Math.max(MIN_RESULTS_WIDTH, (availableWidth()-DIVIDER_WIDTH)*3/8), [availableWidth]);
  const getMaxWidth = useCallback(() => {
    const width = availableWidth();
    // The stacked layout does not consume the stored horizontal width.
    return width <= STACKED_MAX_WIDTH ? MAX_RESULTS_WIDTH : width - MIN_CANVAS_WIDTH - DIVIDER_WIDTH;
  }, [availableWidth]);
  const { reclampWidth, separatorProps, isResizing } = useResizablePanel({
    ariaLabel: t("automationRun.resizePanels"),
    cssVariable: "--automation-results-width",
    defaultWidth: 360,
    getDefaultWidth,
    followDefaultUntilResized: true,
    getMaxWidth,
    growthDirection: "left",
    maxWidth: MAX_RESULTS_WIDTH,
    minWidth: MIN_RESULTS_WIDTH,
    // Start with the new 5:3 default; preview preferences must not overwrite
    // the full-page width when its smaller container clamps the panels.
    storageKey: `eureka:automation:results-width:5-3:${preferenceScope}:${ownerKey}`,
    syncRefs,
    widthRef,
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientWidth > STACKED_MAX_WIDTH) reclampWidth(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reclampWidth]);

  return <div className={styles.runModules} ref={container}>
    {children[0]}
    <LabelTooltip content={t("automationRun.resizeHint")} disabled={isResizing}><div {...separatorProps} className={styles.panelDivider} data-resizing={isResizing} /></LabelTooltip>
    {children[1]}
  </div>;
}
