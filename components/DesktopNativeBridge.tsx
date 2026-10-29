"use client";

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "@/hooks/useTheme";
import { NAVIGATION_STATE_EVENT, type NavigationAvailability } from "@/lib/navigation-history";

function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Bridges web-only behavior to the native Eureka host. The caption lives in a
 * separate local WebView and stays available through content navigation.
 */
export function DesktopNativeBridge() {
  const { preference } = useTheme();

  useEffect(() => {
    if (!isTauriDesktop()) return;
    const syncNavigation = (event: Event) => {
      const state = (event as CustomEvent<NavigationAvailability>).detail;
      void invoke("set_desktop_navigation_state", state).catch((error) => {
        console.error("Failed to synchronize desktop navigation:", error);
      });
    };
    window.addEventListener(NAVIGATION_STATE_EVENT, syncNavigation);
    return () => window.removeEventListener(NAVIGATION_STATE_EVENT, syncNavigation);
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    document.documentElement.classList.add("eureka-desktop");
    document.documentElement.classList.add("eureka-native-titlebar");

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
    // Pass the preference so the native host and its local caption can
    // follow future Windows theme changes when set to auto.
    void invoke("set_desktop_theme", { preference })
      .catch((error) => {
        console.error("Failed to synchronize Eureka native titlebar theme:", error);
      });
  }, [preference]);

  return null;
}
