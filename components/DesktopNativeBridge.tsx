"use client";

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "@/hooks/useTheme";

function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Bridges web-only behavior to the native Eureka host. The window itself keeps
 * standard Windows decorations; this component never handles dragging or
 * caption buttons.
 */
export function DesktopNativeBridge() {
  const { preference } = useTheme();

  useEffect(() => {
    if (!isTauriDesktop()) return;
    document.documentElement.classList.add("eureka-desktop");

    // WebView2 can create a native child window for window.open("about:blank")
    // before Tauri's new-window callback receives the final external URL.
    // Keep same-origin documents in this WebView and open real external links
    // with the operating system instead.
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      if (!url) return null;
      try {
        const destination = new URL(String(url), window.location.href);
        if (destination.origin === window.location.origin) {
          window.location.assign(destination.href);
        } else if (destination.protocol === "https:" || destination.protocol === "http:") {
          void invoke("open_external_url", { url: destination.href });
        }
      } catch {
        // Ignore malformed URLs; this matches browsers refusing the navigation.
      }
      return null;
    }) as typeof window.open;

    return () => {
      // Keep this marker through Fast Refresh. A replacement desktop bridge
      // mounts immediately, while removing it in between makes the custom
      // frame briefly lose both its sizing and desktop-only styles.
      window.open = originalOpen;
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    // Keep `auto` as null so Tao follows future Windows system-theme changes
    // instead of freezing the currently resolved web theme.
    const nativeTheme = preference === "auto" ? null : preference;
    void getCurrentWindow().setTheme(nativeTheme)
      .catch((error) => {
        console.error("Failed to synchronize Eureka native titlebar theme:", error);
      });
  }, [preference]);

  return null;
}
