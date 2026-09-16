"use client";

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  const { theme } = useTheme();

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
      document.documentElement.classList.remove("eureka-desktop");
      window.open = originalOpen;
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    // Theme state in useTheme is the only source of truth. Rust maps this
    // resolved value to the matching native Windows caption colors.
    void invoke("sync_native_titlebar", { theme }).catch(() => {});
  }, [theme]);

  return null;
}
