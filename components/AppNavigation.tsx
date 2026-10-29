"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { LabelTooltip } from "./LabelTooltip";
import styles from "./AppNavigation.module.css";

const GRID_ORIGINS = [[2.5, 2.5], [11.5, 2.5], [11.5, 11.5], [2.5, 11.5]] as const;

function GridSquares() {
  const groupRef = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const group = groupRef.current;
    const svg = group?.ownerSVGElement;
    if (!group || !svg) return;

    // Align each copy to physical pixels, including fractional Windows display scaling.
    // Keep its size and stroke identical so all four copies rasterize the same way.
    const align = () => {
      const bounds = svg.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = window.devicePixelRatio || 1;
      const scaleX = bounds.width / 20;
      const scaleY = bounds.height / 20;
      group.querySelectorAll("rect").forEach((square, index) => {
        const [x, y] = GRID_ORIGINS[index];
        square.setAttribute("x", String((Math.round((bounds.left + x * scaleX) * ratio) / ratio - bounds.left) / scaleX));
        square.setAttribute("y", String((Math.round((bounds.top + y * scaleY) * ratio) / ratio - bounds.top) / scaleY));
      });
    };

    let resolution: MediaQueryList;
    const watchResolution = () => {
      resolution?.removeEventListener("change", onResolutionChange);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", onResolutionChange);
    };
    function onResolutionChange() {
      align();
      watchResolution();
    }

    align();
    watchResolution();
    const observer = new ResizeObserver(align);
    observer.observe(svg);
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      resolution.removeEventListener("change", onResolutionChange);
      window.removeEventListener("resize", align);
    };
  }, []);

  return (
    <g ref={groupRef}>
      {GRID_ORIGINS.map(([x, y]) => <rect key={`${x}-${y}`} width="6" height="6" x={x} y={y} rx="0.833333" />)}
    </g>
  );
}

export function AppNavigation({ view, onNavigate, extensionsEnabled, mobile = false, children }: {
  view: "chat" | "extensions";
  onNavigate: (view: "chat" | "extensions") => void;
  extensionsEnabled: boolean;
  mobile?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const items = [
    { id: "chat" as const, label: t("sidebar.home"), disabled: false },
    { id: "extensions" as const, label: t("sidebar.extensionsCenter"), disabled: !extensionsEnabled },
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
              <svg className={styles.icon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox={id === "chat" ? "0 0 24 24" : "0 0 20 20"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {id === "chat" ? (
                  <>
                    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
                    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </>
                ) : (
                  <GridSquares />
                )}
              </svg>
              {mobile && <span>{label}</span>}
            </button>
          </LabelTooltip>
        ))}
      </div>
      {children}
    </nav>
  );
}
