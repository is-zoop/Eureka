"use client";

import { useEffect } from "react";

export function DesktopStartupReady({ page }: { page: "workspace" | "login" }) {
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const root = document.documentElement;
    root.dataset.eurekaStartupPage = page;
    return () => {
      if (root.dataset.eurekaStartupPage === page) delete root.dataset.eurekaStartupPage;
    };
  }, [page]);
  return null;
}
